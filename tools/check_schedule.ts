// node --experimental-strip-types tools/check_schedule.ts
import assert from "node:assert";
import { pickNext } from "../src/schedule.ts";

const weights = { idle: 40, look_around: 15, walk: 20, sit: 10, groom: 7, yawn: 5, loaf: 3 };
type K = keyof typeof weights;

// never 3 in a row, even with an rng that always lands on "idle"
const always0 = () => 0;
const h: K[] = [];
for (let i = 0; i < 50; i++) h.push(pickNext(weights, h, 2, always0));
for (let i = 2; i < h.length; i++) assert.ok(!(h[i] === h[i - 1] && h[i] === h[i - 2]), `3x ${h[i]} at ${i}`);

// proportions stay close to the weights over a long run
const n = 200_000, count: Record<string, number> = {};
const hist: K[] = [];
for (let i = 0; i < n; i++) {
  const k = pickNext(weights, hist, 2);
  hist.push(k);
  if (hist.length > 4) hist.shift();
  count[k] = (count[k] ?? 0) + 1;
}
for (const [k, w] of Object.entries(weights)) {
  const share = count[k] / n;
  // idle loses a little share to the no-triple rule; everything else gains a little
  assert.ok(Math.abs(share - w / 100) < 0.06, `${k}: ${share.toFixed(3)} vs ${w / 100}`);
}
console.log("schedule ok", Object.fromEntries(Object.entries(count).map(([k, c]) => [k, (c / n).toFixed(3)])));
