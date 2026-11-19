// Behaviour: a state machine that picks lazy actions, moves the window around the screen,
// and turns everything into one Frame per tick (dt-based).
import {
  BLINK, BREATH, CLICK, CURSOR, DRAG, EAR_TWITCH, GROOM, LOAF, LOOK, PHYS, REACT, SCHEDULE, SIT, SLEEP,
  SMOOTH, TAIL, WALK, WHISKER, WINDOW, YAWN,
} from "./config";
import type { Frame } from "./rig";
import { pickNext } from "./schedule";

export type View = "front" | "side" | "back";
type Act = keyof typeof SCHEDULE.weights;
type State = Act | "edge_look" | "sleep" | "wake" | "drag" | "fall" | "land" | "react" | "lookback";
export type Level = "info" | "success" | "warning" | "error";

const VIEW: Record<State, View> = {
  idle: "front", look_around: "front", walk: "side", edge_look: "front", sit: "front", groom: "side",
  yawn: "front", loaf: "back", sleep: "front", wake: "front", drag: "front", fall: "front", land: "front",
  react: "front", // "side" while rushing over (error)
  lookback: "side", // glance back over the shoulder from a loaf
};

// Posture targets; each state sets some, the rest fall back to REST, and all ease toward the target.
const REST = {
  crouch: 0, bodySX: 1, bodySY: 1, headX: 0, headY: 0, headRot: 0, lid: 0, pupilX: 0, pupilY: 0, browY: 0,
  earL: 0, earR: 0, tail0: 0, tail1: 0, tail2: 0, legL: 0, legR: 0, legSY: 1, armL: 0, armR: 0, paw: 0, pawRot: 0,
  mouthOpen: 0, sway: 1, walk: 0, tailPuff: 0, bristle: 0,
};
type Pose = typeof REST;
type Key = keyof Pose;
const FAST: Partial<Record<Key, number>> = {
  pupilX: SMOOTH.fast, pupilY: SMOOTH.fast, lid: 0.15, earL: SMOOTH.fast, earR: SMOOTH.fast, armR: 0.08, pawRot: 0.08,
  paw: 0.1, mouthOpen: 0.12, walk: 0.15, legL: SMOOTH.fast, legR: SMOOTH.fast, browY: SMOOTH.fast,
  tailPuff: 0.15, bristle: 0.1,
};

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (k: number) => (1 - Math.cos(Math.PI * clamp(k, 0, 1))) / 2;
const smoothstep = (x: number) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };

export interface Bounds { minX: number; maxX: number; groundY: number }
export interface Z { x: number; y: number; opacity: number; scale: number }
export interface Output {
  frame: Frame;
  view: View;
  flip: boolean; // side view faces left; true = mirrored to face right
  stage: { y: number; sx: number; sy: number }; // whole-cat bounce / squash, origin at the feet
  win: { x: number; y: number }; // window top-left, logical px
  zs: Z[];
  bubble: boolean; // the current notification's bubble should be on screen now
  bubbleSide: 1 | -1; // right of the head, or left when the cat is on the right half of the screen
}

export function createBrain(rig: { neck: number; legLen: number }, start: { x: number; y: number }) {
  let t = 0;
  let state: State = "idle";
  let st = 0; // time in state
  // per-state scratch data
  let d: Record<string, any> = { until: rand(SCHEDULE.minGap, SCHEDULE.maxGap) };
  const history: Act[] = [];
  const pose: Pose = { ...REST };
  let bounds: Bounds = { minX: -Infinity, maxX: Infinity, groundY: start.y };
  let ground = start.y; // current floor: where it was last put down (never below the screen floor)
  const win = { ...start };
  let prevX = win.x;
  let vx = 0;
  let vy = 0;
  let facing = -1;
  let lastActivity = 0;
  let cursor: { x: number; y: number } | null = null;
  let glareUntil = -1;
  let clicks: number[] = [];
  let breathPhase = 0;
  let breathPeriod = BREATH.period;
  let walkPhase = 0;
  let landT = -10;
  let landAmp = 0;
  const zs: { born: number; dx: number }[] = [];
  let zNext = 0;
  let twitch = { next: rand(EAR_TWITCH.minGap, EAR_TWITCH.maxGap), start: -10, side: 1 };

  // ---- blink: queue of [duration, closedness] steps ----
  let blinkSteps: [number, number][] = [];
  let blinkStart = 0, blinkFrom = 0, blinkVal = 0;
  let nextBlink = rand(BLINK.minGap, BLINK.maxGap);
  function blink() {
    if (!blinkSteps.length && t >= nextBlink) {
      const b = BLINK;
      const slow: [number, number][] = [[b.slowClose, 1], [b.slowHold, 1], [b.slowOpen, 0]];
      blinkSteps = Math.random() < b.slowChance ? [...slow, [b.slowPause, 0], ...slow] : [[b.close, 1], [b.hold, 1], [b.open, 0]];
      blinkStart = t; blinkFrom = blinkVal;
    }
    if (blinkSteps.length) {
      const [dur, to] = blinkSteps[0];
      const k = Math.min(1, (t - blinkStart) / dur);
      blinkVal = blinkFrom + (to - blinkFrom) * ease(k);
      if (k >= 1) {
        blinkSteps.shift(); blinkStart = t; blinkFrom = to;
        if (!blinkSteps.length) nextBlink = t + rand(BLINK.minGap, BLINK.maxGap);
      }
    }
    return blinkVal;
  }

  // ---- state transitions ----
  function go(s: State, data: Record<string, any> = {}) {
    state = s; st = 0; d = data;
  }
  function act(a: Act) {
    switch (a) {
      case "idle":
        return go("idle", { until: rand(SCHEDULE.minGap, SCHEDULE.maxGap) });
      case "look_around": {
        const turns: { dir: number; hold: number }[] = [];
        let dir = Math.random() < 0.5 ? -1 : 1;
        const n = Math.round(rand(LOOK.turnsMin, LOOK.turnsMax));
        for (let i = 0; i < n; i++, dir = -dir) turns.push({ dir: dir * rand(0.6, 1), hold: rand(LOOK.holdMin, LOOK.holdMax) });
        turns.push({ dir: 0, hold: 0.6 });
        return go("look_around", { turns, i: 0, seg: 0 });
      }
      case "walk":
        return walk();
      case "sit":
        return go("sit", { dur: rand(SIT.minDur, SIT.maxDur) });
      case "groom":
        return go("groom");
      case "yawn":
        return go("yawn", { then: "idle" });
      case "loaf":
        return loaf(false);
    }
  }
  function walk(dir?: number) {
    const room = (s: number) => (s < 0 ? win.x - bounds.minX : bounds.maxX - win.x);
    if (dir === undefined) {
      dir = Math.random() < 0.5 ? -1 : 1;
      if (room(dir) < WALK.minDist && room(-dir) > room(dir)) dir = -dir;
    }
    facing = dir;
    go("walk", { dir, dist: rand(WALK.minDist, WALK.maxDist), done: 0, v: 0 });
  }
  function loaf(sulk: boolean) {
    go("loaf", {
      dur: sulk ? rand(LOAF.sulkMin, LOAF.sulkMax) : rand(LOAF.minDur, LOAF.maxDur),
      flickAt: t + rand(LOAF.flickGapMin, LOAF.flickGapMax), flickStart: -10,
    });
  }

  // ---- external events ----
  function activity() {
    lastActivity = t;
    if (state === "sleep") go("wake");
    if (state === "yawn") d.then = "idle";
  }

  /** Would moving to x in direction dir take the cat (further) past the edge of its monitor? */
  const outward = (x: number, dir: number) => (dir < 0 && x < bounds.minX) || (dir > 0 && x > bounds.maxX);

  // ---- notification reactions ----
  const center = () => (Number.isFinite(bounds.minX) ? (bounds.minX + bounds.maxX) / 2 : win.x);
  const bubbleSide = (): 1 | -1 => (win.x > center() + 1 ? -1 : 1);
  function phase(p: string) { d.phase = p; d.pt = 0; }

  function reaction(dt: number): Partial<Pose> {
    d.pt += dt;
    const R = REACT, side = bubbleSide();
    const look = { headRot: side * R.look.headRot, headX: side * R.look.headX, pupilX: side * R.look.pupilX, pupilY: R.look.pupilY };
    const ears = { earL: R.perk, earR: -R.perk };
    const angry = { bristle: 1, earL: -R.error.ears, earR: R.error.ears, browY: 1, tailPuff: 0.6 };
    switch (d.phase) {
      case "startle": // woken: a little jump with round eyes
        if (d.pt >= R.startle) phase("daze");
        return { lid: -1, ...ears, pupilX: 0, pupilY: 0, sway: 0.1 };
      case "daze": // ...then a blank stare before anything else
        if (d.pt >= R.daze) phase(d.level === "error" ? errorStart() : "level");
        return { lid: -0.6, pupilX: 0, pupilY: 0, sway: 0, crouch: 0.3 };
      case "level": {
        if (d.pt >= R.bubbleAt[d.level as Exclude<Level, "error">]) d.bubble = true;
        if (d.level === "success") { // pleased, and pretending not to be
          const [a, b, c] = R.success.tail;
          return { lid: R.success.lid, tail0: a, tail1: b, tail2: c, sway: 0.15, earL: R.perk * 0.6, earR: -R.perk * 0.6,
                   pupilX: side * 1.6, pupilY: -0.8 };
        }
        if (d.level === "warning") return { lid: R.warning.lid, tailPuff: R.warning.puff, ...ears, ...look, headRot: side * 2, sway: 0.4 };
        // info: ears first, then a turn of the head; the body doesn't bother
        return d.pt < 0.35 ? { ...ears, sway: 0.2 } : { ...ears, ...look, sway: 0.2 };
      }
      case "bristle": // error: hackles up first...
        if (d.pt >= R.error.bristleLead) { facing = Math.sign(center() - win.x) || 1; phase("rush"); }
        return angry;
      case "rush": { // ...then a quick trot to the middle of the screen
        const remaining = Math.abs(center() - win.x);
        const k = Math.min(smoothstep(d.pt / R.error.rushEase), smoothstep(remaining / (R.error.rushSpeed * R.error.rushEase * 0.5)));
        d.v = Math.max(R.error.rushSpeed * k, 10);
        const stepX = Math.min(remaining, d.v * dt);
        if (outward(win.x + facing * stepX, facing)) { phase("alarm"); return angry; }
        win.x += facing * stepX;
        if (remaining - stepX < 1) phase("alarm");
        return { ...angry, walk: Math.min(1.2, d.v / WALK.speed), tail0: WALK.tail[0], tail1: WALK.tail[1], sway: 0.2 };
      }
      case "alarm":
        if (d.pt >= R.bubbleAt.error) d.bubble = true;
        return { ...angry, pupilX: side * 1.8, pupilY: -0.6, sway: 0.5 };
    }
    return {};
  }
  const errorStart = () => (Math.abs(center() - win.x) > REACT.error.centerTolerance ? "bristle" : "alarm");

  // ---- per-state update: advances the state and returns its posture targets ----
  function update(dt: number): Partial<Pose> {
    switch (state) {
      case "idle":
        if (t - lastActivity > SLEEP.afterIdle) { go("yawn", { then: "sleep" }); return {}; }
        if (st >= d.until) {
          const next = pickNext(SCHEDULE.weights, history, SCHEDULE.maxRepeat);
          history.push(next);
          if (history.length > 8) history.shift();
          act(next);
        }
        return {};

      case "look_around": {
        const turn = d.turns[d.i];
        d.seg += dt;
        if (d.seg >= LOOK.turn + turn.hold) {
          d.i++; d.seg = 0;
          if (d.i >= d.turns.length) act("idle");
        }
        return { headRot: turn.dir * LOOK.headRot, headX: turn.dir * LOOK.headX, pupilX: turn.dir * LOOK.pupilX, pupilY: 0 };
      }

      case "walk": {
        const remaining = d.dist - d.done;
        const k = Math.min(smoothstep(st / WALK.ease), smoothstep(remaining / (WALK.speed * WALK.ease * 0.5)));
        d.v = Math.max(WALK.speed * k, 4); // floor so the ease-out always arrives
        const v = d.v; // act("idle") below replaces d, so keep the speed for this frame's pose
        const nx = win.x + d.dir * v * dt;
        // Stop at the edge only when stepping further out, and never snap back inside: if the bounds
        // just changed (another monitor) the cat simply walks back in from where it is.
        if (outward(nx, d.dir)) {
          go("edge_look", { dir: -d.dir });
        } else {
          win.x = nx;
          d.done += v * dt;
          if (d.dist - d.done <= 0.5) act("idle");
        }
        return { walk: v / WALK.speed, tail0: WALK.tail[0], tail1: WALK.tail[1], tail2: WALK.tail[2], sway: 0.25 };
      }

      case "edge_look":
        if (st >= WALK.edgeLook) walk(d.dir);
        return { pupilX: 0, pupilY: 0, headRot: 2 };

      case "sit":
        if (t - lastActivity > SLEEP.afterIdle) go("yawn", { then: "sleep" });
        else if (st >= d.dur) act("idle");
        return { crouch: 1, tail0: SIT.tail[0], tail1: SIT.tail[1], tail2: SIT.tail[2], sway: 0.3, headY: 0.5 };

      case "groom": {
        const R = GROOM.raise, S = GROOM.strokeDur, N = GROOM.strokes;
        if (st >= R * 2 + N * S) { act("idle"); return {}; }
        const up = st < R ? ease(st / R) : st < R + N * S ? 1 : 1 - ease((st - R - N * S) / R);
        const stroke = st > R && st < R + N * S ? Math.sin(((st - R) / S) * TAU) : 0;
        return {
          // The foreleg is drawn raised: it swings up from the shoulder, crossfading with the traced arm
          // early in the swing; each stroke nudges the whole leg.
          pawRot: (up - 1) * GROOM.swing + GROOM.wipe * stroke, paw: smoothstep((up - 0.1) / 0.2),
          headRot: up * (GROOM.headTilt + 3 * stroke), lid: up * 0.95, crouch: GROOM.crouch, sway: 0.3,
        };
      }

      case "yawn": {
        const { open, hold, close } = YAWN;
        if (st >= open + hold + close) {
          if (d.then === "sleep") go("sleep"); else act("idle");
          return {};
        }
        const m = st < open ? ease(st / open) : st < open + hold ? 1 : 1 - ease((st - open - hold) / close);
        return { mouthOpen: m, lid: 1, earL: -YAWN.ears * m, earR: YAWN.ears * m, headY: -1.5 * m, bodySY: 1 + 0.02 * m, crouch: d.then === "sleep" ? 0.6 : 0 };
      }

      case "loaf":
        if (st >= d.dur) { act("idle"); return {}; }
        if (t >= d.flickAt) { d.flickStart = t; d.flickAt = t + rand(LOAF.flickGapMin, LOAF.flickGapMax); }
        return { crouch: 1, sway: 0.08 };

      case "sleep":
        if (t >= zNext) { zs.push({ born: t, dx: rand(-3, 3) }); zNext = t + SLEEP.zEvery; }
        return { crouch: 1, lid: 1, headY: 2.5, headRot: 4, sway: 0.15, earL: -4, earR: 4 };

      case "wake": {
        if (st >= SLEEP.wakeDur) { act("idle"); return {}; }
        const k = st / SLEEP.wakeDur;
        return { lid: 1 - ease(k), crouch: 1 - ease(k), bodySY: 1 + 0.03 * Math.sin(Math.PI * k), headY: 2.5 * (1 - ease(k)) };
      }

      case "drag": {
        // hanging limbs trail behind the motion: moving right swings them left (positive rotation)
        const swing = clamp(vx * DRAG.legSwing, -DRAG.legSwingMax, DRAG.legSwingMax);
        const tailSwing = clamp(vx * DRAG.tailSwing, -DRAG.tailSwingMax, DRAG.tailSwingMax);
        return {
          legSY: DRAG.legStretch, legL: swing, legR: swing * 0.8, lid: DRAG.lid, browY: DRAG.brow,
          earL: -DRAG.ears, earR: DRAG.ears, tail0: DRAG.tail[0] + tailSwing, tail1: DRAG.tail[1] + tailSwing * 0.5, tail2: DRAG.tail[2],
          sway: 0.3, bodySY: 1.03, armL: 4, armR: -4, headRot: clamp(vx * 0.01, -4, 4),
        };
      }

      case "fall":
        vy += PHYS.gravity * dt;
        win.y += vy * dt;
        if (win.y >= ground) {
          win.y = ground;
          landAmp = clamp(vy / 1400, 0.35, 1);
          landT = t;
          go("land");
        }
        return { legSY: 1.08, lid: 0.3, tail0: -20, tail1: -10, sway: 0.2, armL: 6, armR: -6 };

      case "land":
        if (st >= PHYS.landDur) act("idle");
        return { lid: 0.25 };

      case "react":
        return reaction(dt);

      case "lookback": // from a loaf: just turn the head back, still sulking
        if (st >= REACT.bubbleAt.lookback) d.bubble = true;
        return { crouch: 1, sway: 0.08, headRot: -4 };
    }
  }

  return {
    get state() { return state; },
    setBounds(b: Bounds) { bounds = b; },
    setCursor(x: number, y: number) {
      if (cursor && Math.hypot(x - cursor.x, y - cursor.y) > 1) activity();
      cursor = { x, y };
    },
    click() {
      if (state === "drag" || state === "fall") return;
      activity();
      if (state === "walk" || state === "groom") act("idle");
      glareUntil = t + CLICK.glare;
      clicks = [...clicks.filter((c) => t - c < CLICK.comboWindow), t];
      if (clicks.length >= CLICK.comboCount) { clicks = []; glareUntil = -1; loaf(true); }
    },
    dragStart() { activity(); vx = 0; go("drag"); },
    /** Do an action right now (gallery, future commands). dir picks the walking direction. */
    perform(name: Act | "sleep", dir?: number) {
      lastActivity = t;
      if (name === "sleep") go("sleep");
      else if (name === "walk") walk(dir);
      else act(name);
    },
    /** Can a notification be shown now? Not while held, falling or landing (it waits in the queue). */
    canReact() { return state !== "drag" && state !== "fall" && state !== "land"; },
    /** Start reacting to a notification; Output.bubble turns true when its bubble should appear. */
    react(level: Level) {
      lastActivity = t;
      if (state === "loaf") {
        facing = bubbleSide();
        go("lookback", { level, resume: Math.max(2, d.dur - st), bubble: false });
        return;
      }
      const woken = state === "sleep" || state === "wake";
      go("react", { level, pt: 0, bubble: false, phase: woken ? "startle" : level === "error" ? errorStart() : "level" });
    },
    /** The bubble was closed: drop the reaction (a sulk resumes where it left off). */
    dismiss() {
      if (state === "lookback") {
        const remaining = d.resume;
        loaf(false);
        d.dur = remaining;
      }
      else if (state === "react") act("idle");
    },
    dragTo(x: number, y: number) { win.x = x; win.y = y; },
    dragEnd() {
      // stays roughly where it was put down: a short drop onto the new floor
      ground = Math.min(win.y + PHYS.perchDrop, bounds.groundY);
      if (win.y < ground - 1) { vy = 0; go("fall"); }
      else { win.y = ground; act("idle"); }
    },

    tick(dt: number): Output {
      t += dt; st += dt;
      vx += ((win.x - prevX) / Math.max(dt, 1e-3) - vx) * Math.min(1, dt * 10);
      prevX = win.x;

      // ---- targets: rest ← cursor follow ← state ← glare ----
      const target: Pose = { ...REST };
      const view: View = state === "react" && d.phase === "rush" ? "side" : VIEW[state];
      if (cursor && view === "front") {
        // ponytail: eye position uses CSS offsets; off by the DPI ratio on a Windows monitor whose scale differs from the primary's
        const ex = win.x + WINDOW.catLeft + 62, ey = win.y + WINDOW.catTop + 58;
        const dx = cursor.x - ex, dy = cursor.y - ey, dist = Math.hypot(dx, dy);
        if (dist < CURSOR.followRadius && dist > 1) {
          const k = Math.min(1, dist / CURSOR.saturate);
          target.pupilX = (dx / dist) * k * CURSOR.pupilX;
          target.pupilY = (dy / dist) * k * CURSOR.pupilY;
        }
      }
      Object.assign(target, update(dt));
      if (t < glareUntil && view === "front" && state !== "react") {
        target.earL = -CLICK.ears; target.earR = CLICK.ears;
        target.lid = Math.max(target.lid, CLICK.lid); target.browY = CLICK.brow;
        if (cursor) {
          const ex = win.x + WINDOW.catLeft + 62, ey = win.y + WINDOW.catTop + 58;
          const a = Math.atan2(cursor.y - ey, cursor.x - ex);
          target.pupilX = Math.cos(a) * CURSOR.pupilX; target.pupilY = Math.sin(a) * CURSOR.pupilY;
        }
      }
      for (const k of Object.keys(pose) as Key[]) {
        // a non-number target would stick in the smoothed pose forever (frozen legs); ignore it
        if (!Number.isFinite(target[k])) continue;
        pose[k] += (target[k] - pose[k]) * (1 - Math.exp(-dt / (FAST[k] ?? SMOOTH.default)));
      }

      // ---- procedural layers on top of the posture ----
      breathPeriod += ((state === "sleep" ? BREATH.sleepPeriod : BREATH.period) - breathPeriod) * Math.min(1, dt);
      breathPhase += (dt / breathPeriod) * TAU;
      const breath = (ph: number) => ((1 - Math.cos(ph)) / 2) * BREATH.scaleY;
      const br = breath(breathPhase);
      const brHead = breath(breathPhase - (BREATH.headDelay / breathPeriod) * TAU);
      const stepPeriod = state === "react" && d.phase === "rush" ? REACT.error.stepPeriod : WALK.stepPeriod;
      walkPhase += (dt / stepPeriod) * TAU * (pose.walk > 0.02 ? 1 : 0);
      const step = Math.sin(walkPhase) * pose.walk;

      let earL = pose.earL, earR = pose.earR;
      if (state === "idle" || state === "sit") {
        if (t >= twitch.next) twitch = { next: t + rand(EAR_TWITCH.minGap, EAR_TWITCH.maxGap), start: t, side: Math.random() < 0.5 ? -1 : 1 };
        const k = (t - twitch.start) / EAR_TWITCH.dur;
        if (k < 1) {
          const v = EAR_TWITCH.amp * Math.sin(k * TAU); // one quick flick
          if (twitch.side < 0) earL -= Math.abs(v); else earR += Math.abs(v);
        }
      }

      const tailSway = (i: number) => pose.sway * TAIL.amps[i] * Math.sin((TAU * t) / TAIL.period - i * TAIL.lag);
      let flick = 0;
      if (state === "loaf") {
        const k = (t - d.flickStart) / LOAF.flickDur;
        if (k >= 0 && k < 1) flick = LOAF.flickAmp * Math.sin(Math.PI * k);
      }
      flick += WALK.tipFlick * pose.walk * Math.sin(walkPhase / 2);

      const legScale = (1 - SIT.legSquash * pose.crouch) * pose.legSY;
      const bodyY = rig.legLen * (1 - legScale);
      // no blinking while closed or wide-eyed
      const lid = pose.lid > 0.9 || pose.lid < -0.05 ? pose.lid : Math.max(pose.lid, blink());

      // chest crescent: a 0.6s sparkle on success, a red blink while alarmed
      let moonGlow = 0, moonRed = 0;
      if (state === "react" && d.level === "success" && d.phase === "level") {
        const k = (d.pt - REACT.success.glowAt) / REACT.success.glowDur;
        if (k > 0 && k < 1) moonGlow = Math.sin(Math.PI * k);
      }
      if (state === "react" && d.level === "error" && d.phase !== "startle" && d.phase !== "daze") {
        moonRed = Math.sin(TAU * REACT.error.blinkHz * t) > 0 ? 1 : 0.2;
      }

      const frame: Frame = {
        bodyY,
        bodySX: pose.bodySX,
        bodySY: pose.bodySY * (1 + br),
        headX: pose.headX,
        headY: pose.headY + bodyY - (pose.bodySY * (1 + brHead) - 1) * rig.neck,
        headRot: pose.headRot,
        lid,
        pupilX: pose.pupilX,
        pupilY: pose.pupilY,
        browY: pose.browY,
        earL,
        earR,
        tail: [pose.tail0 + tailSway(0), pose.tail1 + tailSway(1), pose.tail2 + tailSway(2) + flick],
        tailY: bodyY * 0.8,
        legL: pose.legL + WALK.legAmp * step,
        legR: pose.legR - WALK.legAmp * step,
        legY: bodyY,
        legSY: legScale,
        armL: pose.armL,
        armR: pose.armR,
        // the foreleg only shows while actually folded (≥ ~95°), whatever the easing is doing
        paw: pose.paw,
        pawRot: pose.pawRot,
        mouthOpen: pose.mouthOpen,
        whisker: WHISKER.amp * Math.sin((TAU * t) / WHISKER.period),
        tailPuff: pose.tailPuff,
        bristle: pose.bristle,
        moonGlow,
        moonRed,
      };

      // ---- whole-cat squash / bounce ----
      let sx = 1, sy = 1;
      const lk = t - landT;
      if (lk < PHYS.landDur * 1.5) {
        const e = landAmp * Math.exp(-PHYS.springK * lk) * Math.cos(PHYS.springW * lk);
        sy = 1 - (1 - PHYS.squashY) * e;
        sx = 1 + (PHYS.squashX - 1) * e;
      } else if (state === "fall") {
        sy = PHYS.fallStretch; sx = 2 - PHYS.fallStretch;
      }
      let jump = 0;
      if (state === "react" && d.phase === "startle") jump = REACT.startleJump * Math.sin(Math.PI * Math.min(1, d.pt / REACT.startle));

      // ---- floating z ----
      for (let i = zs.length - 1; i >= 0; i--) if (t - zs[i].born > SLEEP.zLife) zs.splice(i, 1);
      const zOut = zs.map(({ born, dx }) => {
        const k = (t - born) / SLEEP.zLife;
        return {
          x: WINDOW.catLeft + 96 + dx + k * 10 + Math.sin(k * 6) * 2,
          y: WINDOW.catTop + 18 - k * SLEEP.zRise,
          opacity: k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85,
          scale: 0.6 + 0.6 * k,
        };
      });

      return {
        frame, view, flip: view === "side" && facing > 0,
        stage: { y: -WALK.bounce * Math.abs(step) - jump, sx, sy },
        win: { x: win.x, y: win.y }, zs: zOut,
        bubble: (state === "react" || state === "lookback") && d.bubble === true,
        bubbleSide: bubbleSide(),
      };
    },
  };
}
