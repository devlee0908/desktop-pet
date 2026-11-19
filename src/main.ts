import { getCurrentWindow, cursorPosition, primaryMonitor, availableMonitors, LogicalPosition, PhysicalPosition, type Monitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { CLICK, DRAG, FADE_MS, REACT, WINDOW } from "./config";
import { createBrain, type Bounds, type View, type Z } from "./brain";
import { mountRig } from "./rig";
import { rectFor } from "./screens";
import { dotLevel, stillWanted, type Stored } from "./unread";
import { createBubble, type Note } from "./bubble";
import frontSvg from "./assets/cat-front.svg?raw";
import sideSvg from "./assets/cat-side.svg?raw";
import backSvg from "./assets/cat-back.svg?raw";

const win = getCurrentWindow();
const css = document.documentElement.style;
css.setProperty("--win-w", `${WINDOW.width}px`);
css.setProperty("--win-h", `${WINDOW.height}px`);
css.setProperty("--cat-left", `${WINDOW.catLeft}px`);
css.setProperty("--cat-top", `${WINDOW.catTop}px`);
const stage = document.getElementById("stage")!;
const fx = document.getElementById("fx")!;
const views: Record<View, HTMLElement> = {
  front: document.getElementById("v-front")!,
  side: document.getElementById("v-side")!,
  back: document.getElementById("v-back")!,
};
for (const el of Object.values(views)) el.style.transition = `opacity ${FADE_MS}ms`;
const rigs = { front: mountRig(views.front, frontSvg), side: mountRig(views.side, sideSvg), back: mountRig(views.back, backSvg) };

// ---- desk coordinates: the one global space the brain moves the window in ----
// macOS: points, its native global space (Tauri reports monitors as points × that monitor's scale).
// Windows/Linux: the native global space is physical pixels, so use physical ÷ the primary monitor's
// scale, one constant — consistent even when monitors have different scales (e.g. 150% + 100%).
const IS_MAC = navigator.userAgent.includes("Mac");
const primary = await primaryMonitor();
const deskScale = IS_MAC ? 1 : primary?.scaleFactor ?? 1;
let winScale = await win.scaleFactor(); // scale of the monitor the window is on (polled)
/** CSS px inside the window → desk units (always 1 on macOS). */
const cssToDesk = () => (IS_MAC ? 1 : winScale / deskScale);
const toDesk = (physical: number, monitorScale: number) => physical / (IS_MAC ? monitorScale : deskScale);
function place(x: number, y: number) {
  return IS_MAC
    ? win.setPosition(new LogicalPosition(x, y))
    : win.setPosition(new PhysicalPosition(Math.round(x * deskScale), Math.round(y * deskScale)));
}

const workArea = (m: Monitor) => ({
  x: toDesk(m.workArea.position.x, m.scaleFactor), y: toDesk(m.workArea.position.y, m.scaleFactor),
  w: toDesk(m.workArea.size.width, m.scaleFactor), h: toDesk(m.workArea.size.height, m.scaleFactor),
});
function boundsOf(r: { x: number; y: number; w: number; h: number }): Bounds {
  const f = cssToDesk();
  return {
    minX: r.x - (WINDOW.catLeft + 15) * f, // let the cat's body reach the screen edge
    maxX: r.x + r.w - (WINDOW.catLeft + 140 - 15) * f,
    groundY: r.y + r.h - (WINDOW.catTop + 154) * f, // feet on the dock / taskbar / screen bottom
  };
}
/** Walkable range and floor of the monitor the cat is on (or nearest to). */
async function boundsHere(): Promise<Bounds | null> {
  const f = cssToDesk();
  const r = rectFor((await availableMonitors()).map(workArea), applied.x + (WINDOW.catLeft + 70) * f, applied.y + (WINDOW.catTop + 100) * f);
  return r ? boundsOf(r) : null;
}

const b0 = primary ? boundsOf(workArea(primary)) : { minX: 0, maxX: 1000, groundY: 600 };
const brain = createBrain(rigs.front, { x: b0.maxX - WINDOW.startMargin, y: b0.groundY });
brain.setBounds(b0);

// ---- drag (our own, so we know when it is released and can fall) ----
// Relative motion (movementX/Y), not screenX/Y: screen coordinates change base when the
// cursor crosses to another monitor, which would teleport the window.
let press: { dx: number; dy: number; wx: number; wy: number; dragging: boolean } | null = null;
let applied = { x: NaN, y: NaN };
stage.addEventListener("mousedown", (e) => {
  if (e.button === 0) press = { dx: 0, dy: 0, wx: applied.x, wy: applied.y, dragging: false };
});
window.addEventListener("mousemove", (e) => {
  if (!press) return;
  press.dx += e.movementX;
  press.dy += e.movementY;
  const { dx, dy } = press;
  if (!press.dragging && Math.hypot(dx, dy) > DRAG.threshold) {
    press.dragging = true;
    brain.dragStart();
  }
  if (press.dragging) brain.dragTo(press.wx + dx * cssToDesk(), press.wy + dy * cssToDesk()); // movementX/Y are CSS px
});
window.addEventListener("mouseup", async () => {
  if (!press) return;
  const p = press;
  press = null;
  if (!p.dragging) return click();
  const b = await boundsHere();
  if (b) brain.setBounds(b);
  brain.dragEnd();
});

// ---- MCP notifications (sidecar → Rust → "pet-mcp" event) ----
// One notification at a time: the cat reacts, then (when the brain says so) the bubble appears;
// closing it lets the next one in. While held or falling, notifications just wait.
const queue: Note[] = [];
let activeNote: Note | null = null;
let noteShown = false;
let nextAt = 0;
const badge = document.getElementById("queue")!;
const badgeCount = badge.querySelector("span")!;
const bubble = createBubble(document.getElementById("bubble")!, (byUser) => {
  // closed by the user = read; auto-closed may have been missed, so it stays unread (dot)
  if (byUser && activeNote) invoke("inbox_do", { action: { op: "read", ids: [activeNote.id] } }).catch(console.error);
  brain.dismiss();
  activeNote = null;
  nextAt = performance.now() + REACT.between * 1000;
  unreadDot.classList.remove("hold");
  updateBadge(1);
  updateDot();
});
function updateBadge(side: 1 | -1) {
  badgeCount.textContent = String(queue.length);
  badge.classList.toggle("on", queue.length > 0);
  badge.classList.toggle("left", side > 0); // the ear away from the bubble
  badge.classList.toggle("right", side < 0);
}
const reacting = () => brain.state === "react" || brain.state === "lookback";
function pumpNotifications(now: number, out: { bubble: boolean; bubbleSide: 1 | -1 }) {
  if (!activeNote && queue.length && brain.canReact() && now >= nextAt) {
    activeNote = queue.shift()!;
    noteShown = false;
    brain.react(activeNote.level);
    updateDot();
  } else if (activeNote && !noteShown && !reacting() && brain.canReact()) {
    brain.react(activeNote.level); // its reaction was interrupted (picked up, or a sulk); start over
  }
  if (activeNote && !noteShown && out.bubble) {
    noteShown = true;
    bubble.show(activeNote, out.bubbleSide);
    unreadDot.classList.add("hold");
  }
  updateBadge(out.bubbleSide);
}
type McpEvent =
  | { type: "notify"; notification: Note }
  | { type: "clear" }
  | { type: "state"; notifications: Stored[] }
  | { type: "ready"; port: number };

// Unread dot by the cat's head (rules in unread.ts): unread notifications, not counting the ones the
// cat is about to show (those are the queue badge). It stays until they are read or deleted.
const unreadDot = document.getElementById("unread")!;
let stored: Stored[] = [];
function updateDot() {
  const pending = new Set(queue.map((n) => n.id));
  if (activeNote) pending.add(activeNote.id);
  const level = dotLevel(stored, pending);
  unreadDot.classList.toggle("on", level !== null);
  if (level) unreadDot.style.background = `var(--lv-${level})`;
}
invoke<Stored[]>("inbox_state").then((list) => { stored = list; updateDot(); });

listen<McpEvent>("pet-mcp", ({ payload }) => {
  if (payload.type === "state") {
    stored = payload.notifications;
    // read or deleted in the inbox: don't show it later, and take down a bubble whose note is gone
    queue.splice(0, queue.length, ...stillWanted(queue, stored));
    if (activeNote && !stored.some((n) => n.id === activeNote!.id)) {
      if (bubble.isOpen) bubble.close();
      else { activeNote = null; brain.dismiss(); }
    }
    updateDot();
    return;
  }
  if (payload.type === "notify") {
    queue.push(payload.notification);
    updateDot();
  } else if (payload.type === "clear") {
    queue.length = 0;
    if (bubble.isOpen) bubble.close();
    else if (activeNote) { activeNote = null; brain.dismiss(); }
  }
});

// ---- clicks: double-click opens the inbox; a single click waits a beat so it isn't half a double ----
let clickTimer = 0;
function click() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = 0;
    invoke("open_inbox");
    return;
  }
  clickTimer = window.setTimeout(() => {
    clickTimer = 0;
    brain.click();
  }, CLICK.doubleMs);
}

// Keep the bounds on whichever monitor the cat is on (also covers displays being added or removed).
setInterval(async () => {
  if (press || Number.isNaN(applied.x)) return;
  const b = await boundsHere();
  if (b) brain.setBounds(b);
}, 2000);

// ---- click-through + global cursor (also drives pupil follow and the sleep timer) ----
// ponytail: polling, a native NSEvent monitor if the latency ever matters.
let ignoring = false;
setInterval(async () => {
  const [c, scale] = await Promise.all([cursorPosition(), win.scaleFactor()]);
  winScale = scale;
  // cursor comes back in physical pixels
  const k = IS_MAC ? scale : deskScale;
  const x = c.x / k, y = c.y / k;
  brain.setCursor(x, y);
  if (Number.isNaN(applied.x)) return;
  const el = document.elementFromPoint((x - applied.x) / cssToDesk(), (y - applied.y) / cssToDesk());
  const inside = press !== null || (el instanceof SVGElement && !(el instanceof SVGSVGElement)) || !!el?.closest("#bubble.on");
  if (inside === ignoring) {
    ignoring = !inside;
    await win.setIgnoreCursorEvents(ignoring);
  }
}, WINDOW.clickPollMs);

// ---- floating z ----
const zEls: HTMLElement[] = [];
function renderZ(zs: Z[]) {
  while (zEls.length < zs.length) {
    const s = document.createElement("span");
    s.className = "z";
    s.textContent = "z";
    fx.append(s);
    zEls.push(s);
  }
  zEls.forEach((el, i) => {
    const z = zs[i];
    el.style.opacity = z ? String(Math.max(0, z.opacity)) : "0";
    if (z) el.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
  });
}

// ---- game loop ----
let current: View = "front";
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const out = brain.tick(dt);
  rigs.front.apply(out.frame);
  rigs.side.apply(out.frame);
  rigs.back.apply(out.frame);
  if (out.view !== current) {
    views[current].classList.remove("on");
    views[out.view].classList.add("on");
    current = out.view;
  }
  rigs.side.flip(out.flip);
  stage.style.transform = `translateY(${out.stage.y}px) scale(${out.stage.sx}, ${out.stage.sy})`;
  // the dot and the queue badge ride along with jumps and landings (the individual `translate`
  // property, so it doesn't fight the scale-in transition on `transform`)
  unreadDot.style.translate = badge.style.translate = `0 ${out.stage.y}px`;
  renderZ(out.zs);
  pumpNotifications(now, out);
  const x = Math.round(out.win.x), y = Math.round(out.win.y);
  if (x !== applied.x || y !== applied.y) {
    applied = { x, y };
    place(x, y);
  }
  requestAnimationFrame(loop);
}
// A hidden window gets no animation frames, so place and show it before starting the loop.
applied = { x: Math.round(b0.maxX - WINDOW.startMargin), y: Math.round(b0.groundY) };
await place(applied.x, applied.y);
await win.show();
requestAnimationFrame(loop);
