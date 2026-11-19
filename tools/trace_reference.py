import math
# Regenerates src/assets/cat-{front,side,back}.svg from assets/reference/*.png.
# needs: pip install opencv-python-headless numpy
# usage: python tools/trace_reference.py <project_dir> [front|side|back ...]
import sys, cv2, numpy as np

PROJ = sys.argv[1]
BODY, SHADE, INK, EYE = "#2B2A26", "#1F1E1B", "#000000", "#F2C14E"
VIEW_H = 147  # ear tip → foot bottom, in viewBox units
TOP = 6

VIEWS = {
    "front": dict(head=[2, 3, 4, 7], body=8, tail=9, eyes=[3, 4], nose=7,
                  ears=(((480, 180), (262, 380)), ((920, 180), (1138, 380))),  # base lines: inner → outer
                  whisker_y=(640, 800), mouth=(630, 680, 770, 800)),
    "side": dict(head=[3, 4, 5, 8, 9], body=10, tail=11, eyes=[8], nose=9, far_leg=12,
                 whisker_box=(560, 650, 760, 800), mouth=(270, 700, 380, 780), leg_top=1470),
    "back": dict(head=[2], body=10, tail_cut=((858, 1404), (976, 1486)),
                 body_edge=((447, 1383), (580, 1612))),
}

K = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
dil = lambda m, r: cv2.dilate(m, K(r)) if r > 0 else m
ero = lambda m, r: cv2.erode(m, K(r)) if r > 0 else m
close = lambda m, r: cv2.morphologyEx(m, cv2.MORPH_CLOSE, K(r))


def fill_holes(m):
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(m)
    cv2.drawContours(out, cs, -1, 1, -1)
    return out


class View:
    def __init__(self, name, cfg):
        self.name, self.cfg = name, cfg
        im = cv2.imread(f"{PROJ}/assets/reference/{name}.png")
        self.g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        self.ink = (self.g < 14).astype(np.uint8)
        ys, xs = np.where(self.ink)
        self.y0 = ys.min()
        self.s = VIEW_H / (ys.max() - ys.min())
        self.cx = (xs.min() + xs.max()) / 2
        d = cv2.distanceTransform(self.ink, cv2.DIST_L2, 5)
        mx = (d == cv2.dilate(d, np.ones((3, 3)))) & (d > 1)
        self.w = 2 * float(np.median(d[mx]))  # outline width in ref px
        self.hw = int(round(self.w / 2))
        self.sw = round(self.w * self.s, 2)  # stroke width in units
        ink = self.ink.copy()
        if "tail_cut" in cfg:  # close the open tail outline so the tail becomes its own region
            cv2.line(ink, *cfg["tail_cut"], 1, int(self.w) + 2)
        self.ink2 = ink
        n, self.lab, st, cen = cv2.connectedComponentsWithStats((1 - ink).astype(np.uint8), connectivity=4)
        self.stats, self.cen = st, cen

    def U(self, x, y):
        return (x - self.cx) * self.s + 70, (y - self.y0) * self.s + TOP

    def reg(self, *ids):
        return np.isin(self.lab, ids).astype(np.uint8)

    # ---------- path helpers ----------
    def pts(self, c):
        return [self.U(float(p[0][0]), float(p[0][1])) for p in c]

    def smooth(self, P, closed=True, sharp=None):
        n = len(P)
        sharp = sharp or [False] * n
        f = lambda p: f"{p[0]:.1f} {p[1]:.1f}"
        if n < 3:
            return "M" + " L".join(f(p) for p in P)
        out = ["M" + f(P[0])]
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            p0 = P[(i - 1) % n] if closed or i > 0 else P[i]
            p1, p2 = P[i], P[(i + 1) % n]
            p3 = P[(i + 2) % n] if closed or i + 2 < n else p2
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            if sharp[i] or sharp[(i + 1) % n]:
                out.append(f"L{f(p2)}")
                continue
            out.append(f"C{f(c1)} {f(c2)} {f(p2)}")
        return "".join(out) + ("Z" if closed else "")

    def contours(self, m, eps=2.5, min_area=40):
        cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        return [cv2.approxPolyDP(c, eps, True) for c in cs if cv2.contourArea(c) >= min_area]

    def path(self, m, eps=2.5, min_area=40, sharp_below=None):
        out = []
        for c in self.contours(m, eps, min_area):
            sharp = [sharp_below is not None and p[0][1] >= sharp_below for p in c]
            out.append(self.smooth(self.pts(c), sharp=sharp))
        return "".join(out)

    def open_bottom_path(self, m, ycut):
        """Contour of m with the straight top edge at ycut left unstroked (path not closed)."""
        c = max(self.contours(m, 2.0), key=cv2.contourArea)[:, 0, :]
        top = c[:, 1] <= ycut + 1.5
        if top.all() or not top.any():
            return self.smooth(self.pts(c[:, None, :]))
        i = next(i for i in range(len(c)) if top[i - 1] and not top[i])  # first point after the top run
        c, top = np.roll(c, -i, 0), np.roll(top, -i)
        k = int(np.argmax(top))  # next top point
        P = [self.U(*map(float, p)) for p in [c[-1], *c[:k], c[k]]]
        return self.smooth(P, closed=False)

    def sil(self, m):  # region (inner edge of outline) → shape whose border is the outline centre
        return dil(m, self.hw)


def fur(v, m, spacing=4.0, height=2.8):
    """Spiky outline around mask m (units): alternating base points on the contour and tips pushed outward."""
    c = max(cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea)
    P = np.array([v.U(float(x), float(y)) for x, y in c[:, 0, :]])
    seg = np.hypot(*np.diff(np.vstack([P, P[:1]]), axis=0).T)
    L = np.r_[0, np.cumsum(seg)]
    n = int(L[-1] / (spacing / 2)) // 2 * 2
    area = 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])
    rng = np.random.default_rng(7)
    out = []
    for i in range(n):
        s_ = L[-1] * i / n
        j = min(np.searchsorted(L, s_, side="right") - 1, len(P) - 1)
        a, b = P[j], P[(j + 1) % len(P)]
        tx, ty = (b - a) / (np.hypot(*(b - a)) or 1)
        nx, ny = (ty, -tx) if area > 0 else (-ty, tx)  # outward normal (y points down)
        k = (s_ - L[j]) / (seg[j] or 1)
        x, y = a + (b - a) * k
        if i % 2:
            h = height * rng.uniform(0.7, 1.25)
            x, y = x + nx * h, y + ny * h
        out.append((x, y))
    cx, cy = P.mean(0)
    d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in out) + "Z"
    return (f'<g class="fur" style="transform-origin:{cx:.1f}px {cy:.1f}px;opacity:0">'
            f'<path d="{d}" stroke-linejoin="miter" stroke-miterlimit="8"/></g>')


def skeleton(m):
    """Zhang–Suen thinning."""
    img = m.copy().astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P = [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
            B = sum(P)
            A = sum(((P[i] == 0) & (P[(i + 1) % 8] == 1)) for i in range(8))
            if step == 0:
                c = (P[0] * P[2] * P[4] == 0) & (P[2] * P[4] * P[6] == 0)
            else:
                c = (P[0] * P[2] * P[6] == 0) & (P[0] * P[4] * P[6] == 0)
            rm = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                img[rm] = 0
                changed = True
        if not changed:
            return img


def tail_centerline(v, tail, base_hint):
    f = 4
    small = cv2.resize(tail, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_NEAREST)
    sk = skeleton(small)
    ys, xs = np.where(sk)
    pts = set(zip(xs.tolist(), ys.tolist()))
    nb = lambda p: [(p[0] + dx, p[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and (p[0] + dx, p[1] + dy) in pts]
    ends = [p for p in pts if len(nb(p)) == 1]
    # longest path between endpoints (BFS from each end)
    def bfs(s):
        prev, q, seen = {s: None}, [s], {s}
        for p in q:
            for n in nb(p):
                if n not in seen:
                    seen.add(n); prev[n] = p; q.append(n)
        last = q[-1]
        path = []
        while last is not None:
            path.append(last); last = prev[last]
        return path[::-1]
    best = max((bfs(e) for e in ends), key=len)
    if np.hypot(best[0][0] * f - base_hint[0], best[0][1] * f - base_hint[1]) > np.hypot(best[-1][0] * f - base_hint[0], best[-1][1] * f - base_hint[1]):
        best = best[::-1]
    P = np.array(best, float) * f + f / 2
    # resample evenly
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    t = np.linspace(0, d[-1], 13)
    P = np.c_[np.interp(t, d, P[:, 0]), np.interp(t, d, P[:, 1])]
    dist = cv2.distanceTransform(tail, cv2.DIST_L2, 5)
    r = [dist[int(y), int(x)] for x, y in P]
    return P, r


def build(name):
    v = View(name, VIEWS[name])
    c = v.cfg
    sw, hw = v.sw, v.hw
    out = []
    A = out.append

    # ---------- masks ----------
    if "tail" in c:
        tail = v.reg(c["tail"])
        body_reg = v.reg(c["body"])
    else:  # back: tail split out by the synthetic cut line
        probe = v.lab[1533, 600]
        tail = (v.lab == probe).astype(np.uint8)
        body_reg = v.reg(c["body"])
        if body_reg[1533, 600]:
            body_reg = np.zeros_like(body_reg)
        # body = largest non-head, non-tail, non-bg region below the head
        ids = [i for i in range(1, len(v.stats)) if i not in (1, probe, *c["head"]) and v.stats[i, 4] > 100000]
        body_reg = v.reg(*ids)
        (ax, ay), (bx, by) = c["body_edge"]
        yy, xx = np.mgrid[: tail.shape[0], : tail.shape[1]]
        right = (((bx - ax) * (yy - ay) - (by - ay) * (xx - ax)) < 0) & (yy >= ay)
        body_reg = fill_holes(close(body_reg | (tail & right), 31))

    head_reg = fill_holes(close(v.reg(*c["head"]), 27))
    head_sil = v.sil(head_reg)
    body_full = fill_holes(close(body_reg, 21)) if "tail" in c else body_reg
    body_sil = v.sil(body_full)

    # crotch / leg cut
    if "leg_top" in c:
        crotch = c["leg_top"]
    else:
        ys = np.where(body_sil.any(1))[0]
        crotch = None
        for y in range(ys.max(), ys.min(), -1):
            row = body_sil[y]
            runs = np.count_nonzero(np.diff(np.r_[0, row, 0]) == 1)
            if runs >= 2:
                crotch = y
            elif crotch is not None:
                break
    leg_top = crotch + 1
    torso = body_sil.copy(); torso[crotch + 40:] = 0  # deep overlap: swinging legs never expose a gap
    if name == "side":
        # In the reference the lower body and both legs are one stubby block. Close the torso with a
        # rounded belly just under the hips instead, so the legs below can swing on their own.
        torso = body_sil.copy(); torso[crotch:] = 0
        xs = np.where(torso[crotch - 1])[0]
        cv2.ellipse(torso, (int((xs.min() + xs.max()) / 2), crotch - 1), (int((xs.max() - xs.min()) / 2), 34), 0, 0, 180, 1, -1)
    legs = body_sil.copy(); legs[:leg_top] = 0
    n, ll = cv2.connectedComponents(legs)
    legs = sorted([(ll == i).astype(np.uint8) for i in range(1, n) if (ll == i).sum() > 2000],
                  key=lambda m: np.where(m)[1].mean())

    # ---------- tail tube ----------
    tail_svg = ""
    if tail.any():
        base_hint = v.cen[c["body"]] if "tail" in c else (980, 1470)
        P, r = tail_centerline(v, tail, base_hint)
        P, r = P[2:], r[2:]  # skeleton stub at the broad base is unreliable
        tip_r = max(r[-3:])
        # extend the base back along the tangent so the pivot sits hidden inside the body
        U = [v.U(*p) for p in P]
        dx, dy = U[0][0] - U[1][0], U[0][1] - U[1][1]
        if name == "side":
            # sprout sideways from the hip like the reference, so the tube's round end never shows below it
            into = 1 if v.U(np.where(body_sil.any(0))[0].mean(), 0)[0] > U[0][0] else -1
            U = [(U[0][0] + into * 6, U[0][1])] + U
        else:
            U = [(U[0][0] + dx * 2, U[0][1] + dy * 2)] + U
        r = [r[0]] + list(r)
        cuts = [0, 4, 8, len(U) - 1]
        wm = 2 * float(np.median(r[cuts[1]:])) * v.s  # the visible base pinches between body and arm; use the main width
        fills = [round(wm, 2)] * 3  # one width: a step would show as a bump when the tail bends
        def seg_path(a, b):
            Q = U[a:b + 1]
            return v.smooth(Q, closed=False)
        # Two parallel hierarchies with the same pivots: every outline first, then every fill,
        # so joints never show a seam. cat.ts rotates everything with class tail-N.
        tx, ty = U[-1]
        tr = tip_r * v.s
        outl, fill = [], []
        for k in range(3):
            a_, b_ = cuts[k], cuts[k + 1]
            d = seg_path(a_, b_)
            ox, oy = U[a_]
            outw = round(fills[k] + 2 * v.w * v.s, 2)
            o = f'<path d="{d}" fill="none" stroke-width="{outw}"/>'
            f_ = f'<path d="{d}" fill="none" stroke="{BODY}" stroke-width="{fills[k]}"/>'
            if k == 2:
                o += f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="{tr + v.w * v.s:.1f}" stroke="none" fill="{INK}"/>'
                f_ += f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="{tr:.1f}" stroke="none"/>'
            outl.append((k, ox, oy, o)); fill.append((k, ox, oy, f_))
        def nest(items, i, with_id):
            k, ox, oy, body = items[i]
            inner = nest(items, i + 1, with_id) if i + 1 < 3 else ""
            idattr = f'id="tail-{k + 1}" ' if with_id else ""
            return f'<g {idattr}class="tail-{k + 1}" style="transform-origin:{ox:.1f}px {oy:.1f}px">{body}{inner}</g>'
        tail_svg = '<g class="tail-outline">' + nest(outl, 0, False) + "</g>" + nest(fill, 0, True)
        tail_ink = dil(tail, int(v.w) + 4)
    else:
        tail_ink = np.zeros_like(v.ink)

    shade = ((v.g >= 14) & (v.g < 37)).astype(np.uint8)
    shade = cv2.morphologyEx(shade, cv2.MORPH_OPEN, K(2))

    # ---------- body ----------
    def to_u_y(y): return (y - v.y0) * v.s + TOP
    bxs = np.where(body_sil.any(0))[0]
    bcx = (bxs.min() + bxs.max()) / 2
    bo = v.U(bcx, crotch)
    body = [f'<g id="body" style="transform-origin:{bo[0]:.1f}px {bo[1]:.1f}px">',
            f'<path d="{v.path(torso, 2.0, sharp_below=None if name == "side" else crotch - 6)}"/>']  # straight under the legs: no spline overshoot
    if name in ("front", "side"):  # alarmed fur goes behind the torso (above the hips only)
        upper = torso.copy(); upper[crotch - 8:] = 0
        body.insert(1, fur(v, upper))
    sh_b = shade & ero(body_full, 2) & (1 - tail_ink)
    sh_b[crotch:] = 0
    if sh_b.sum() > 500:
        body.append(f'<path d="{v.path(sh_b, 3, 300)}" fill="{SHADE}" stroke="none"/>')
    moon = ((v.g > 200).astype(np.uint8) & ero(body_full, 1))
    if moon.sum() > 500:
        body.append(f'<path class="moon" d="{v.path(moon, 1.5, 300)}" fill="#FFFFFF" stroke="none"/>')
    inner = v.ink & ero(close(body_reg, 31), int(v.w)) & (1 - tail_ink)
    inner[crotch - 10:] = 0
    n, il, st, _ = cv2.connectedComponentsWithStats(inner)
    comps = [(il == i).astype(np.uint8) for i in range(1, n) if st[i, 4] > 400]
    arms = {}
    if name == "side":
        if comps:
            arms["arm-r"] = max(comps, key=np.sum)
    else:
        for m in comps:
            k = "arm-l" if np.where(m)[1].mean() < bcx else "arm-r"
            arms[k] = m if k not in arms else (arms[k] | m)
    for k, m in sorted(arms.items()):
        ys, xs = np.where(m)
        i = np.argmin(ys)
        ox, oy = v.U(xs[i], ys[i])
        body.append(f'<g id="{k}" class="{k}" style="transform-origin:{ox:.1f}px {oy:.1f}px">'
                    f'<path d="{v.path(m, 1.2, 50)}" fill="{INK}" stroke="none"/></g>')
    paw = ""
    if name == "side" and "arm-r" in arms:
        # Groom foreleg, drawn above the head and hidden until grooming, in its raised pose: one chunky
        # shape from the shoulder, round elbow pointing down, up to a mitten paw at the mouth. Forearm and
        # paw are a single outline (the paw is just the rounded, slightly wider end), so they move as one.
        ys, xs = np.where(arms["arm-r"])
        top = v.U(xs[np.argmin(ys)], ys.min())
        S = (top[0] - 13, top[1] + 7)  # shoulder at the front of the chest
        E, P = (S[0] - 13, S[1] + 7), (S[0] - 25, S[1] - 21)  # elbow (curve control), paw tip
        def pt(t):  # quadratic S -> E -> P (E is the control point, so the bend stays round)
            u = 1 - t
            return (u*u*S[0] + 2*u*t*E[0] + t*t*P[0], u*u*S[1] + 2*u*t*E[1] + t*t*P[1])
        def width(t):  # 16 at the shoulder, 11 at the wrist (t=.72), swelling to 13 at the paw
            return 16 - 5 * t / .72 if t < .72 else 11 + 2 * math.sin((t - .72) / .28 * math.pi / 2)
        n, C, L, R = 32, [], [], []
        for i in range(n + 1):
            t = i / n
            (x0, y0), (x1, y1) = pt(max(0, t - .01)), pt(min(1, t + .01))
            dx, dy = x1 - x0, y1 - y0; m = math.hypot(dx, dy); h = width(t) / 2
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            L.append((cx - dy/m*h, cy + dx/m*h)); R.append((cx + dy/m*h, cy - dx/m*h)); C.append((cx, cy))
        def cap(c, a_, b_):  # half circle around c from point a_ to point b_, bulging away from the limb
            ang, rr = math.atan2(a_[1] - c[1], a_[0] - c[0]), math.hypot(a_[0] - c[0], a_[1] - c[1])
            out = []
            for sg in (1, -1):
                pts = [(c[0] + rr*math.cos(ang + sg*math.pi*k/10), c[1] + rr*math.sin(ang + sg*math.pi*k/10)) for k in range(1, 10)]
                mid = pts[4]
                out.append((math.hypot(mid[0] - b_[0], mid[1] - b_[1]) + 0, pts))
            # the right half circle is the one whose middle lies farther from the limb's interior
            inner = C[2] if c == C[0] else C[-3]
            return max(out, key=lambda o: math.hypot(o[1][4][0] - inner[0], o[1][4][1] - inner[1]))[1]
        poly = R[::-1] + cap(C[0], R[0], L[0]) + L + cap(C[-1], L[-1], R[-1])
        limb = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in poly) + "Z"
        # toe creases on the paw end
        tx, ty = C[-4]; ux, uy = (P[0] - tx), (P[1] - ty); um = math.hypot(ux, uy); ux, uy = ux/um, uy/um
        toes = "".join(f'<path d="M{tx + ux*1.5 - uy*o:.1f} {ty + uy*1.5 + ux*o:.1f}l{ux*3.2:.1f} {uy*3.2:.1f}" fill="none" stroke-width="{sw*0.7:.2f}"/>'
                       for o in (-2.2, 2.2))
        paw = (f'<g id="paw"><g class="arm-r paw" style="transform-origin:{S[0]:.1f}px {S[1]:.1f}px;opacity:0">'
               f'<path d="{limb}"/>{toes}</g></g>')
    body.append("</g>")

    leg_svg = []
    names = ["leg-l", "leg-r"] if len(legs) == 2 else ["leg-r"]
    far = ""
    if name == "side":
        # split the block: front part = near leg (drawn over the body), back part = far leg (shaded, behind)
        block = legs[0]
        xs = np.where(block)[1]
        # each leg takes ~75% of the block: chunky like the reference, overlapping at rest
        mid, ov = (xs.min() + xs.max()) // 2, int(0.25 * (xs.max() - xs.min()))
        front, back = block.copy(), block.copy()
        front[:, mid + ov:] = 0
        back[:, :mid - ov] = 0
        legs = [front]
        bx = np.where(back)[1]
        ox, oy = v.U(bx.mean(), crotch)
        far = (f'<g id="leg-l" style="transform-origin:{ox:.1f}px {oy:.1f}px">'
               f'<path d="{v.open_bottom_path(back, leg_top)}" fill="{SHADE}" stroke-linecap="butt"/></g>')
    for nm, m in zip(names, legs):
        xs = np.where(m)[1]
        ox, oy = v.U(xs.mean(), crotch)
        leg_svg.append(f'<g id="{nm}" style="transform-origin:{ox:.1f}px {oy:.1f}px">'
                       f'<path d="{v.open_bottom_path(m, leg_top)}" stroke-linecap="butt"/></g>')

    # ---------- head ----------
    hys, hxs = np.where(head_sil)
    hcx = (hxs.min() + hxs.max()) / 2
    ho = v.U(hcx, hys.max())
    sh_h = shade & ero(head_reg, 2)
    for e in c.get("eyes", []) + ([c["nose"]] if "nose" in c else []):
        sh_h &= 1 - dil(v.reg(e), 6)
    if "ears" in c:
        # Ears and head draw the SAME traced head (outline + shading), each through a clip:
        # the head excludes the ear wedges, each ear shows only its wedge and its clip rotates
        # with it. At 0° this is pixel-identical to the plain trace; rotated, the outline stays
        # one smooth curve, so no seams or spurs.
        content = (f'<path d="{v.path(head_sil, 2.0)}"/>'
                   + (f'<path d="{v.path(sh_h, 3, 300)}" fill="{SHADE}" stroke="none"/>' if sh_h.sum() > 500 else ""))
        poly_d = lambda P: "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in P) + "Z"
        wedges = []
        for k, (inner, outer) in zip(("ear-l", "ear-r"), c["ears"]):
            I, O = v.U(*inner), v.U(*outer)
            L = float(np.hypot(O[0] - I[0], O[1] - I[1]))
            Oe = (O[0] + (O[0] - I[0]) / L * 20, O[1] + (O[1] - I[1]) / L * 20)  # past the outline
            pivot = ((I[0] + O[0]) / 2, (I[1] + O[1]) / 2)  # mid-base: splits the small rotation error
            wedges.append((k, pivot, [I, Oe, (Oe[0], -60), (I[0], -60)]))
        def head_hole(P):  # the head keeps a ~2px strip at the inner edge, overlapping the ear there
            (ix_, iy_), (ex, ey) = P[0], P[1]
            L_ = float(np.hypot(ex - ix_, ey - iy_))
            I2 = (ix_ + (ex - ix_) / L_ * 2.0, iy_ + (ey - iy_) / L_ * 2.0)
            return poly_d([I2, P[1], P[2], (I2[0], -60)])
        not_ears = "M-60 -60H220V240H-60Z" + "".join(head_hole(P) for _, _, P in wedges)
        head = [f'<g id="head" style="transform-origin:{ho[0]:.1f}px {ho[1] - 2:.1f}px">',
                f'<clipPath id="{name}-head-clip"><path d="{not_ears}" clip-rule="evenodd"/></clipPath>',
                f'<g clip-path="url(#{name}-head-clip)">{content}</g>']
        # fill-only backing near each ear base: hides any sliver a rotated ear opens up there
        band = "".join(poly_d([P[0], P[1], (P[1][0], P[1][1] - 9), (P[0][0], P[0][1] - 9)]) for _, _, P in wedges)
        head.append(f'<clipPath id="{name}-earbase-clip"><path d="{band}"/></clipPath>'
                    f'<g clip-path="url(#{name}-earbase-clip)"><path d="{v.path(head_sil, 2.0)}" stroke="none"/>'
                    + (f'<path d="{v.path(sh_h, 3, 300)}" fill="{SHADE}" stroke="none"/>' if sh_h.sum() > 500 else "") + "</g>")
        for k, pv, P in wedges:
            # overlap the head a hair on both cut edges so the seam never shows
            inward = 0.6 if k == "ear-l" else -0.6
            I, Oe = P[0], P[1]
            P = [(I[0] + inward, I[1] + 0.6), (Oe[0], Oe[1] + 0.6), (Oe[0], -60), (I[0] + inward, -60)]
            head.append(f'<g id="{k}" style="transform-origin:{pv[0]:.1f}px {pv[1]:.1f}px">'
                        f'<clipPath id="{name}-{k}-clip"><path d="{poly_d(P)}"/></clipPath>'
                        f'<g clip-path="url(#{name}-{k}-clip)">{content}</g></g>')
    else:
        head = [f'<g id="head" style="transform-origin:{ho[0]:.1f}px {ho[1] - 2:.1f}px">',
                f'<path d="{v.path(head_sil, 2.0)}"/>']
        if sh_h.sum() > 500:
            head.append(f'<path d="{v.path(sh_h, 3, 300)}" fill="{SHADE}" stroke="none"/>')

    if name in ("front", "side"):
        head.insert(1, fur(v, head_sil, spacing=4.4, height=2.6))

    hin = v.ink & head_reg
    used = np.zeros_like(hin)
    feats = {}
    eye_parts = None
    if c.get("eyes"):
        O_all = np.zeros_like(hin)
        F_all = np.zeros_like(hin)  # full (wide-open) eye: the traced opening plus a dome above the lid
        cap_h = []
        for e in c["eyes"]:
            ys, xs = np.where(v.reg(e))
            hull = cv2.convexHull(np.c_[xs, ys].astype(np.int32))
            O = np.zeros_like(hin); cv2.fillPoly(O, [hull], 1)
            O_all |= O
            oy, ox = np.where(O)
            h = int(0.6 * (oy.max() - oy.min()))
            cap_h.append(h)
            F = O.copy()
            cv2.ellipse(F, (int((ox.min() + ox.max()) / 2), int(oy.min() + 0.15 * (oy.max() - oy.min()))),
                        (int((ox.max() - ox.min()) / 2), h), 0, 180, 360, 1, -1)
            fy, fx = np.where(F)
            fh = cv2.convexHull(np.c_[fx, fy].astype(np.int32))
            cv2.fillPoly(F_all, [fh], 1)
        eye_zone = dil(O_all, int(v.w * 2.5))
        used |= eye_zone & hin
        pupil = v.ink & ero(O_all, 3)
        n, pl, st, _ = cv2.connectedComponentsWithStats(pupil)
        pupil = np.isin(pl, [i for i in range(1, n) if st[i, 4] > 200]).astype(np.uint8)
        # In the reference the pupil merges into the lid line; extend it straight up under the lid
        # so no sliver of yellow shows between them.
        ys, xs = np.where(pupil)
        up = np.zeros_like(pupil)
        for x in np.unique(xs):
            up[: ys[xs == x].min() + 1, x] = 1
        pupil |= up & dil(O_all, int(v.w))
        # round top on each pupil so a wide-open eye shows an oval, not a flat-topped stripe
        n, pl, st, cen = cv2.connectedComponentsWithStats(pupil)
        for i in range(1, n):
            x, y, w_, h_ = st[i, :4]
            cv2.ellipse(pupil, (int(x + w_ / 2), int(y)), (int(w_ / 2), int(w_ * 0.55)), 0, 180, 360, 1, -1)
        pupil &= dil(F_all, 2)
        Osil = dil(F_all, hw)
        clip = dil(F_all, int(v.w * 1.6))
        lids, lines, outl = [], [], []
        top_y, bot_y = [], []
        for cnt in v.contours(dil(O_all, hw), 1.5, 200):  # the lid line follows the traced (half-lid) opening
            p = cnt[:, 0, :]
            li, ri = np.argmin(p[:, 0]), np.argmax(p[:, 0])
            ch1 = np.r_[p[li:ri + 1]] if li < ri else np.r_[p[li:], p[:ri + 1]]
            ch2 = np.r_[p[ri:li + 1]] if ri < li else np.r_[p[ri:], p[:li + 1]]
            topc = ch1 if ch1[:, 1].mean() < ch2[:, 1].mean() else ch2[::-1]
            if topc[0, 0] > topc[-1, 0]:
                topc = topc[::-1]
            T = [v.U(float(x), float(y)) for x, y in topc]
            ytop = min(t[1] for t in T) - 40  # taller than the lid travel
            lids.append("M%.1f %.1f" % (T[0][0] - 3, T[0][1]) + "".join("L%.1f %.1f" % t for t in T)
                        + "L%.1f %.1fL%.1f %.1fL%.1f %.1fZ" % (T[-1][0] + 3, T[-1][1], T[-1][0] + 3, ytop, T[0][0] - 3, ytop))
            lines.append(v.smooth(T, closed=False))
            top_y.append(p[:, 1].min()); bot_y.append(p[:, 1].max())
        travel = round(float(np.mean(np.array(bot_y) - np.array(top_y))) * v.s * 1.05, 1)
        opening = round(float(np.mean(cap_h)) * v.s + 1.5, 1)  # lift that reveals the whole dome
        eye_parts = dict(O=v.path(Osil, 1.5, 200), clip=v.path(clip, 1.5, 200), pupil=v.path(pupil, 1.2, 100),
                         lid="".join(lids), line="".join(lines), travel=travel, open=opening)
    if "nose" in c:
        nz = dil(v.reg(c["nose"]), int(v.w * 1.4))
        feats["nose"] = (v.path(v.sil(v.reg(c["nose"])), 1.5, 50), v.path(hin & nz & (1 - used), 1.2, 30))
        used |= nz & hin
    if "mouth" in c:
        x0, y0, x1, y1 = c["mouth"]
        m = hin & (1 - used); mm = np.zeros_like(m); mm[y0:y1, x0:x1] = 1
        feats["mouth"] = v.path(m & mm, 1.2, 30)
        used |= m & mm
        ys, xs = np.where(m & mm)
        mx, my = v.U((xs.min() + xs.max()) / 2, ys.min())
        feats["mouth_open"] = (mx, my)
    # whiskers
    wsk = {}
    if "whisker_y" in c:
        y0, y1 = c["whisker_y"]
        band = dil(head_reg, int(v.w) + 2) & (1 - head_reg)
        m = v.ink & (1 - band) & (1 - used)
        m[:y0] = 0; m[y1:] = 0
        m &= (1 - ero(head_reg, 0)) | hin
        hx0, hx1 = np.where(head_reg.any(0))[0][[0, -1]]
        mid = (hx0 + hx1) / 2
        for side_, sel in (("whisker-l", np.arange(m.shape[1]) < mid), ("whisker-r", np.arange(m.shape[1]) >= mid)):
            mm = m.copy(); mm[:, ~sel] = 0
            # keep only strokes reaching outside the head
            n, wl, st, _ = cv2.connectedComponentsWithStats(mm)
            keep = [i for i in range(1, n) if st[i, 4] > 150]
            mm = np.isin(wl, keep).astype(np.uint8)
            used |= mm & hin
            ys, xs = np.where(mm)
            if len(xs):
                i = np.argmin(np.abs(xs - mid))
                wsk[side_] = (v.U(xs[i], ys[i]), v.path(mm, 1.2, 30))
    if "whisker_box" in c:
        x0, y0, x1, y1 = c["whisker_box"]
        mm = hin & (1 - used); box = np.zeros_like(mm); box[y0:y1, x0:x1] = 1; mm &= box
        used |= mm
        ys, xs = np.where(mm)
        i = np.argmin(xs)
        wsk["whisker-l"] = (v.U(xs[i], ys[i]), v.path(mm, 1.2, 30))
    # brows + leftover head lines
    rest = hin & (1 - used) & ero(head_reg, 1)
    n, rl, st, _ = cv2.connectedComponentsWithStats(rest)
    brows, lines_h = np.zeros_like(rest), np.zeros_like(rest)
    eye_top = min(np.where(v.reg(e))[0].min() for e in c["eyes"]) if c.get("eyes") else 0
    for i in range(1, n):
        if st[i, 4] < 150: continue
        m = (rl == i).astype(np.uint8)
        cy = st[i, 1] + st[i, 3] / 2
        compact = st[i, 4] / (st[i, 2] * st[i, 3]) > 0.45
        if c.get("eyes") and cy < eye_top and cy > eye_top - 220 and compact:
            brows |= m
        else:
            lines_h |= m
    if lines_h.any():
        head.append(f'<path d="{v.path(lines_h, 1.2, 50)}" fill="{INK}" stroke="none"/>')
    if brows.any():
        head.append(f'<g id="brows" fill="{INK}" stroke="none"><path d="{v.path(brows, 1.2, 50)}"/></g>')
    if eye_parts:
        e = eye_parts
        cid = f"{name}-eye-clip"
        head.append(f'<clipPath id="{cid}"><path d="{e["clip"]}"/></clipPath>'
                    f'<g id="eyes"><path d="{e["O"]}" fill="{EYE}" stroke="none"/>'
                    f'<g clip-path="url(#{cid})">'
                    f'<g id="pupil" fill="{INK}" stroke="none"><path d="{e["pupil"]}"/></g>'
                    f'<path d="{e["O"]}" fill="none"/>'
                    f'<g id="eyelid" data-travel="{e["travel"]}" data-open="{e["open"]}"><path d="{e["lid"]}" stroke="none"/>'
                    f'<path class="lid-line" d="{e["line"]}" fill="none"/></g></g></g>')
    if "nose" in feats:
        fill_d, ink_d = feats["nose"]
        head.append(f'<g id="nose"><path d="{fill_d}" fill="{SHADE}" stroke="none"/>'
                    f'<path d="{ink_d}" fill="{INK}" stroke="none"/></g>')
    if "mouth" in feats:
        head.append(f'<g id="mouth" fill="{INK}" stroke="none"><path d="{feats["mouth"]}"/></g>')
        if name == "front":  # yawn: scaled from 0 by the rig
            mx, my = feats["mouth_open"]
            head.append(f'<g id="mouth-open" style="transform-origin:{mx:.1f}px {my:.1f}px;transform:scale(0)">'
                        f'<ellipse cx="{mx:.1f}" cy="{my + 3.6:.1f}" rx="4" ry="4.8" fill="{INK}" stroke="none"/></g>')
    if wsk:
        head.append('<g id="whiskers" fill="#000000" stroke="none">' + "".join(
            f'<g id="{k}" style="transform-origin:{o[0]:.1f}px {o[1]:.1f}px"><path d="{d}"/></g>'
            for k, (o, d) in sorted(wsk.items())) + "</g>")
    head.append("</g>")

    # ---------- assemble ----------
    lx = [np.where(m)[1] for m in legs]
    gx = v.U(np.mean(np.concatenate(lx)) if lx else bcx, 0)[0]
    ground = f'<ellipse class="ground" cx="{gx:.1f}" cy="154.5" rx="30" ry="3" fill="#000" fill-opacity=".12" stroke="none" pointer-events="none"/>'
    order = {
        "front": [ground, tail_svg, *body, *leg_svg, *head],
        "side": [ground, tail_svg, far, *body, *leg_svg, *head, paw],
        "back": [ground, *body, *leg_svg, *head, tail_svg],
    }[name]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 160" width="140" height="160">\n'
           f'<!-- traced from assets/reference/{name}.png; parts pivot on their inline transform-origin -->\n'
           f'<g fill="{BODY}" stroke="{INK}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round">\n'
           + "\n".join(x for x in order if x) + "\n</g>\n</svg>\n")
    open(f"{PROJ}/src/assets/cat-{name}.svg", "w").write(svg)
    print(name, f"s={v.s:.4f} w={v.w:.1f}px stroke={sw} crotch={crotch} legs={len(legs)} arms={sorted(arms)} "
          f"whiskers={sorted(wsk)} travel={eye_parts and eye_parts['travel']} bytes={len(svg)}")


for nm in sys.argv[2:] or VIEWS:
    build(nm)
