// node --experimental-strip-types tools/check_unread.ts — unread-dot / queue scenarios
import assert from "node:assert";
import { dotLevel, stillWanted, type Stored } from "../src/unread.ts";

const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 9, min)).toISOString();
const n = (id: string, level: Stored["level"], min: number, read = false): Stored =>
  ({ id, title: id, message: "m", level, receivedAt: at(min), read });
const none = new Set<string>();

// B: shown and auto-closed, still unread → dot in its level colour
assert.equal(dotLevel([n("a", "info", 1)], none), "info");
// A: the user closed the bubble → marked read → no dot
assert.equal(dotLevel([n("a", "info", 1, true)], none), null);
// D/E: waiting in the queue (or about to be shown) → badge only, no dot
assert.equal(dotLevel([n("a", "info", 1), n("b", "error", 2)], new Set(["a", "b"])), null);
assert.equal(dotLevel([n("a", "info", 1), n("b", "error", 2)], new Set(["b"])), "info");
// F: opening the inbox doesn't touch read flags, so an unread notification keeps its dot;
// reading it there (click or 모두 읽음) is what clears it
assert.equal(dotLevel([n("a", "warning", 1)], none), "warning");
assert.equal(dotLevel([n("a", "warning", 1, true)], none), null);
// L: colour is the most serious unread level
assert.equal(dotLevel([n("a", "info", 1), n("b", "error", 2), n("c", "success", 3)], none), "error");
assert.equal(dotLevel([n("a", "info", 1), n("b", "error", 2, true)], none), "info");
// J: everything cleared → no dot
assert.equal(dotLevel([], none), null);

// H: queued notifications read or deleted in the inbox are dropped from the queue
const q = [n("a", "info", 1), n("b", "info", 2), n("c", "info", 3)];
assert.deepEqual(stillWanted(q, [n("a", "info", 1), n("b", "info", 2, true)]).map((x) => x.id), ["a"]);
assert.deepEqual(stillWanted(q, []).map((x) => x.id), []);
assert.deepEqual(stillWanted(q, q).map((x) => x.id), ["a", "b", "c"]);
console.log("unread ok");
