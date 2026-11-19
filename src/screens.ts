// Which monitor is the cat on? Pure geometry on logical (point) rectangles, so it can be tested.

export interface Rect { x: number; y: number; w: number; h: number }

/** The rect containing (x, y), or the nearest one if the point is between/off all of them. */
export function rectFor(rects: Rect[], x: number, y: number): Rect | undefined {
  const dist = (r: Rect) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
  return rects.reduce<Rect | undefined>((best, r) => (!best || dist(r) < dist(best) ? r : best), undefined);
}
