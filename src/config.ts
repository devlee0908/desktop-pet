// All tunable numbers. Times in seconds, angles in degrees, distances in px.
// Personality: chic and lazy — everything slow, small and a little reluctant.

export const WINDOW = {
  width: 600, // keep in sync with src-tauri/tauri.conf.json
  height: 300,
  catLeft: 230, // where the 140x160 cat box sits inside the window (room for a bubble on either side)
  catTop: 120, // room above for the speech bubble and floating "z"
  startMargin: 24, // gap from the right edge at launch
  clickPollMs: 50, // click-through hit-test + cursor poll
};

export const BREATH = { period: 3.5, sleepPeriod: 5, scaleY: 0.025, headDelay: 0.15 };

export const BLINK = {
  minGap: 3,
  maxGap: 7,
  close: 0.09,
  hold: 0.05,
  open: 0.14,
  slowChance: 0.2, // "slow eye kiss": two slow blinks
  slowClose: 0.35,
  slowHold: 0.3,
  slowOpen: 0.45,
  slowPause: 0.25,
};

export const TAIL = { period: 4, amps: [6, 10, 14], lag: 0.7 };
export const WHISKER = { period: 2.8, amp: 2 };

// Posture changes ease toward their target with this time constant: lazy, never snappy.
export const SMOOTH = { default: 0.4, fast: 0.12 };

export const SCHEDULE = {
  minGap: 4,
  maxGap: 10,
  weights: { idle: 40, look_around: 15, walk: 20, sit: 10, groom: 7, yawn: 5, loaf: 3 },
  maxRepeat: 2, // never the same action 3 times in a row
};

export const LOOK = { headRot: 4, headX: 1.5, pupilX: 2.6, turnsMin: 2, turnsMax: 3, holdMin: 1, holdMax: 2.5, turn: 1.2 };

export const WALK = {
  speed: 40,
  ease: 0.7, // ease-in / ease-out time
  minDist: 120,
  maxDist: 420,
  stepPeriod: 0.6,
  legAmp: 18,
  bounce: 2,
  tail: [-15, -5, 0], // raised
  tipFlick: 12,
  edgeLook: 1.6,
};

export const SIT = { legSquash: 0.45, minDur: 8, maxDur: 16, tail: [30, 75, 65] };
// the raised foreleg swings up from the shoulder; strokes nudge it (wipe) and nod the head
export const GROOM = { raise: 0.8, strokes: 3, strokeDur: 0.9, swing: -14, wipe: 6, headTilt: -6, crouch: 0.6 };
export const YAWN = { open: 1.0, hold: 0.7, close: 0.8, ears: 9 };
export const LOAF = { minDur: 8, maxDur: 16, sulkMin: 14, sulkMax: 24, flickAmp: 16, flickDur: 0.35, flickGapMin: 1.2, flickGapMax: 3 };
export const SLEEP = { afterIdle: 300, zEvery: 1.8, zLife: 3.2, zRise: 36, wakeDur: 2.5 };
export const EAR_TWITCH = { minGap: 8, maxGap: 22, dur: 0.3, amp: 8 };

export const CURSOR = { followRadius: 200, saturate: 60, pupilX: 2.6, pupilY: 1.6 };
export const CLICK = {
  glare: 0.5, ears: 9, lid: 0.25, brow: 1,
  doubleMs: 280, // two clicks within this = double-click (opens the inbox)
  comboWindow: 2.5, comboCount: 3, // three separate clicks within this = sulk (loaf)
};

export const DRAG = {
  threshold: 4, lid: 0.4, brow: 0.8, ears: 6, legStretch: 1.12,
  legSwing: 0.03, legSwingMax: 12, // deg per px/s of drag speed
  tail: [92, 57, 13], // hangs limp, angled slightly out from the hip
  tailSwing: 0.04, tailSwingMax: 20,
};
export const PHYS = { gravity: 1800, squashY: 0.85, squashX: 1.12, springK: 6, springW: 15, landDur: 0.8, fallStretch: 1.05, perchDrop: 10 };

export const FADE_MS = 150; // view crossfade

// MCP notify reaction: a lazy glance up at the bubble; annoyed ears for warnings/errors.
// Reactions to MCP notify, by level. Same chic cat throughout: the stronger the level, the more it shows.
export const REACT = {
  startle: 0.45, startleJump: 14, daze: 1.1, // woken by a notification: jump, stare blankly, then react
  perk: 5, // ears forward (deg)
  look: { headRot: 5, headX: 1.8, pupilX: 2.6, pupilY: -1 }, // turning toward the bubble
  bubbleAt: { info: 0.8, success: 0.55, warning: 0.4, error: 0.15, lookback: 0.6 }, // s into the reaction
  success: { lid: -0.35, tail: [-23, 12, -7], glowAt: 0.15, glowDur: 0.6 }, // tail tall and straight, beside the body
  warning: { lid: -1, puff: 1 }, // eyes fully open, tail fluffed
  error: { ears: 9, bristleLead: 0.5, rushSpeed: 120, rushEase: 0.25, stepPeriod: 0.34, blinkHz: 2, centerTolerance: 30 },
  between: 0.6, // pause before the next queued notification
};
export const BUBBLE = { autoClose: 8 }; // seconds; error bubbles stay until clicked
