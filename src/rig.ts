// Writes a resolved pose into one part-rigged SVG view. Parts a view lacks are skipped,
// so the same frame can be applied to front, side and back.

export interface Frame {
  bodyY: number; // px, positive = down
  bodySX: number;
  bodySY: number;
  headX: number;
  headY: number;
  headRot: number; // deg
  lid: number; // 0 = authored half-lid, 1 = closed, -1 = wide open (round eyes)
  pupilX: number;
  pupilY: number;
  browY: number;
  earL: number; // deg, negative = back/outward
  earR: number; // deg, positive = back/outward
  tail: [number, number, number]; // deg per segment
  tailY: number;
  legL: number;
  legR: number;
  legY: number;
  legSY: number;
  armL: number;
  armR: number;
  paw: number; // groom foreleg opacity (0 = the traced arm line shows instead)
  pawRot: number; // deg, groom foreleg swing about the shoulder (0 = raised to the mouth)
  mouthOpen: number; // 0..1
  whisker: number; // deg
  tailPuff: number; // 0..1 fur fluffed up: thicker tail
  bristle: number; // 0..1 hackles raised: spiky outline
  moonGlow: number; // 0..1 white sparkle on the chest crescent
  moonRed: number; // 0..1 crescent tinted red
}

export interface Rig {
  neck: number; // body pivot → head pivot, px
  legLen: number; // hip → floor, px
  apply(f: Frame): void;
  /** Mirror left↔right (side view walking right). */
  flip(on: boolean): void;
}

const FLOOR_Y = 153; // feet bottom in the 140x160 viewBox

export function mountRig(host: HTMLElement, svg: string): Rig {
  host.innerHTML = svg;
  const one = (sel: string) => host.querySelector<SVGGElement>(sel);
  const all = (sel: string) => [...host.querySelectorAll<SVGGElement>(sel)];
  const originY = (el: SVGGElement | null) => (el ? parseFloat(el.style.transformOrigin.split(" ")[1]) : 0);

  const body = one("#body");
  const head = one("#head");
  const eyelid = one("#eyelid");
  const pupil = one("#pupil");
  const brows = one("#brows");
  const earL = one("#ear-l");
  const earR = one("#ear-r");
  const mouth = one("#mouth");
  const mouthOpen = one("#mouth-open");
  const whiskerL = one("#whisker-l");
  const whiskerR = one("#whisker-r");
  const tail = [1, 2, 3].map((i) => all(`.tail-${i}`)); // outline + fill layers
  const legL = one("#leg-l");
  const legR = one("#leg-r");
  const armL = all(".arm-l");
  const armR = all(".arm-r"); // the traced arm line plus the groom foreleg layers
  const travel = Number(eyelid?.dataset.travel ?? 0);
  const opening = Number(eyelid?.dataset.open ?? 0);
  const lidLine = one(".lid-line");
  const fur = all(".fur");
  const moon = host.querySelector<SVGPathElement>(".moon");
  if (moon) moon.style.transformBox = "fill-box";
  if (moon) moon.style.transformOrigin = "center";
  // tail thickness: remember the traced widths; outline paths keep their ink rim when puffed
  const ink = Number(host.querySelector("svg > g")?.getAttribute("stroke-width") ?? 1);
  const tailShapes = tail.flat().flatMap((g) => [...g.children] as SVGElement[]).filter((e) => !(e instanceof SVGGElement))
    .map((e) => {
      const isCircle = e instanceof SVGCircleElement;
      const outline = !!e.closest(".tail-outline");
      const base = Number(e.getAttribute(isCircle ? "r" : "stroke-width"));
      const core = isCircle ? (outline ? base - ink : base) : (outline ? base - 2 * ink : base);
      return { e, isCircle, base, core };
    });
  let lastPuff = 0;
  // Mirroring is done inside the SVG: a negative CSS scale on the HTML container made WebKit stop
  // repainting the animated parts (legs froze when walking right).
  const root = host.querySelector<SVGGElement>("svg > g");
  let flipped = false;

  const set = (el: SVGElement | null, v: string) => {
    if (el) el.style.transform = v;
  };

  return {
    neck: originY(body) - originY(head),
    legLen: FLOOR_Y - originY(legR ?? legL),
    flip(on) {
      if (on === flipped || !root) return;
      flipped = on;
      if (on) root.setAttribute("transform", "translate(140 0) scale(-1 1)"); // mirror around x = 70
      else root.removeAttribute("transform");
    },
    apply(f) {
      set(body, `translateY(${f.bodyY}px) scale(${f.bodySX}, ${f.bodySY})`);
      set(head, `translate(${f.headX}px, ${f.headY}px) rotate(${f.headRot}deg)`);
      set(eyelid, `translateY(${f.lid >= 0 ? Math.min(1, f.lid) * travel : Math.max(-1, f.lid) * opening}px)`);
      // the lid edge fades out as the eye opens all the way, leaving the round eye outline
      if (lidLine) lidLine.style.opacity = String(Math.min(1, Math.max(0, (f.lid + 1) / 0.4)));
      set(pupil, `translate(${f.pupilX}px, ${f.pupilY}px)`);
      set(brows, `translateY(${f.browY}px)`);
      set(earL, `rotate(${f.earL}deg)`);
      set(earR, `rotate(${f.earR}deg)`);
      if (mouth) mouth.style.opacity = String(1 - Math.min(1, f.mouthOpen * 4));
      set(mouthOpen, `scale(${f.mouthOpen})`);
      set(whiskerL, `rotate(${f.whisker}deg)`);
      set(whiskerR, `rotate(${-f.whisker}deg)`);
      tail.forEach((layers, i) => {
        const v = (i === 0 ? `translateY(${f.tailY}px) ` : "") + `rotate(${f.tail[i]}deg)`;
        layers.forEach((g) => set(g, v));
      });
      const leg = (a: number) => `translateY(${f.legY}px) rotate(${a}deg) scaleY(${f.legSY})`;
      set(legL, leg(f.legL));
      set(legR, leg(f.legR));
      // arms live inside #body and inherit its offset; only the paw (drawn above the head) needs it added
      armL.forEach((g) => set(g, `rotate(${f.armL}deg)`));
      armR.forEach((g) => {
        const isPaw = g.classList.contains("paw");
        set(g, isPaw ? `translateY(${f.bodyY}px) rotate(${f.pawRot}deg)` : `rotate(${f.armR}deg)`);
        g.style.opacity = String(isPaw ? f.paw : 1 - f.paw); // one arm at a time
      });

      if (Math.abs(f.tailPuff - lastPuff) > 0.002) {
        lastPuff = f.tailPuff;
        const k = 0.6 * f.tailPuff;
        for (const s of tailShapes) s.e.setAttribute(s.isCircle ? "r" : "stroke-width", String(s.base + s.core * k));
      }
      fur.forEach((g) => {
        g.style.opacity = String(f.bristle);
        g.style.transform = `scale(${0.9 + 0.1 * f.bristle})`;
      });
      if (moon) {
        const red = f.moonRed, glow = f.moonGlow;
        moon.style.fill = red > 0.01 ? `rgb(${Math.round(255 - 31 * red)}, ${Math.round(255 - 153 * red)}, ${Math.round(255 - 153 * red)})` : ""; // white → #E06666
        moon.style.transform = `scale(${1 + 0.18 * glow})`;
        moon.style.filter = glow > 0.01 ? `drop-shadow(0 0 ${2.5 * glow}px rgba(255,255,255,${glow}))` : "";
      }
    },
  };
}
