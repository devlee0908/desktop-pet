// node --experimental-strip-types tools/check_screens.ts
import assert from "node:assert";
import { rectFor } from "../src/screens.ts";

// This Mac: built-in 1512x949 work area under the menu bar, external 2560x1440 to the right,
// bottoms aligned (so the external's top is above y=0 in top-left coordinates).
const builtIn = { x: 0, y: 33, w: 1512, h: 949 };
const external = { x: 1512, y: -458, w: 2560, h: 1440 };
const screens = [builtIn, external];

assert.equal(rectFor(screens, 700, 800), builtIn, "cat on the built-in display");
assert.equal(rectFor(screens, 2500, 800), external, "cat low on the external display (the reported bug)");
assert.equal(rectFor(screens, 2500, -300), external, "cat high on the external display");
assert.equal(rectFor(screens, 1513, 900), external, "just past the seam");
assert.equal(rectFor(screens, 700, -200), builtIn, "above the built-in display: nearest is the built-in one");
assert.equal(rectFor(screens, 5000, 100), external, "off the right edge: nearest");
assert.equal(rectFor([], 0, 0), undefined);
console.log("screens ok");
