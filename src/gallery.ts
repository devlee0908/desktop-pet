// Dev gallery: every behaviour running live with the real brain, rig and SVGs, one per card,
// each on a loop. Open http://localhost:1420/gallery.html while `npm run dev` / `tauri dev` runs.
import { createBrain, type Level, type View } from "./brain";
import { mountRig, type Rig } from "./rig";
import { WINDOW } from "./config";
import frontSvg from "./assets/cat-front.svg?raw";
import sideSvg from "./assets/cat-side.svg?raw";
import backSvg from "./assets/cat-back.svg?raw";

type Brain = ReturnType<typeof createBrain>;
interface Scenario {
  title: string;
  note: string;
  loop: number; // seconds before the scenario restarts
  x?: number; // starting window x (0 = screen centre)
  start?: (b: Brain) => void;
  drive?: (b: Brain, t: number, dt: number) => void; // per frame, t = seconds since start
}

const react = (level: Level): Pick<Scenario, "start"> => ({ start: (b) => b.react(level) });
const clicksAt = (times: number[]) => {
  const done = new Set<number>();
  return (b: Brain, t: number) => times.forEach((at, i) => { if (t >= at && !done.has(i)) { done.add(i); b.click(); } });
};

const SCENARIOS: { group: string; items: Scenario[] }[] = [
  { group: "기본", items: [
    { title: "idle", note: "숨쉬기 · 깜빡임 · 꼬리 · 수염", loop: 12 },
    { title: "look_around", note: "고개 좌우 + 동공", loop: 10, start: (b) => b.perform("look_around") },
    { title: "walk ←", note: "측면, 40px/s", loop: 8, start: (b) => b.perform("walk", -1) },
    { title: "walk →", note: "측면 좌우 반전", loop: 8, start: (b) => b.perform("walk", 1) },
    { title: "sit", note: "몸 낮추고 꼬리 감기", loop: 10, start: (b) => b.perform("sit") },
    { title: "groom", note: "측면, 앞발로 세수 3회", loop: 7, start: (b) => b.perform("groom") },
    { title: "yawn", note: "눈 감고 입 벌림, 귀 뒤로", loop: 5, start: (b) => b.perform("yawn") },
    { title: "loaf", note: "뒷모습, 꼬리 끝만 까딱", loop: 12, start: (b) => b.perform("loaf") },
    { title: "sleep", note: "느린 숨(5초), z", loop: 12, start: (b) => b.perform("sleep") },
  ] },
  { group: "상호작용 · 물리", items: [
    { title: "click (째려봄)", note: "2초마다 클릭", loop: 8, drive: clicksAt([1, 3, 5.2]) },
    { title: "3번 클릭 → 삐침", note: "간격 두고 3번", loop: 16, drive: clicksAt([0.5, 1.2, 1.9]) },
    { title: "drag", note: "좌우로 흔들며 들기", loop: 8, start: (b) => b.dragStart(),
      drive: (b, t) => b.dragTo(Math.sin(t * 2.2) * 140, -25) },
    { title: "drop → land", note: "놓기 · 착지 찌그러짐", loop: 4, start: (b) => { b.dragStart(); b.dragTo(0, -40); },
      drive: (b, t) => { if (t > 0.6 && b.state === "drag") b.dragEnd(); } },
  ] },
  { group: "알림 반응", items: [
    { title: "info", note: "귀 쫑긋 → 고개만", loop: 6, ...react("info") },
    { title: "success", note: "눈 살짝 크게 · 꼬리 쭉 · 초승달 반짝", loop: 6, ...react("success") },
    { title: "warning", note: "눈 동그랗게 · 꼬리 부풂", loop: 6, ...react("warning") },
    { title: "error (돌진)", note: "털 곤두섬 · 중앙으로 · 빨간 초승달", loop: 9, x: 260, ...react("error") },
    { title: "sleep → 알림", note: "화들짝 점프 · 멍 · 반응", loop: 9, start: (b) => { b.perform("sleep"); }, drive: (b, t) => { if (t > 2 && b.state === "sleep") b.react("info"); } },
    { title: "loaf → 알림", note: "고개만 돌려 뒤돌아봄", loop: 8, start: (b) => b.perform("loaf"), drive: (b, t) => { if (t > 1.5 && b.state === "loaf") b.react("warning"); } },
  ] },
];

const SVG: Record<View, string> = { front: frontSvg, side: sideSvg, back: backSvg };

function card(s: Scenario, parent: HTMLElement) {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `<div class="stage"><div class="scaler"><div class="cat"></div><div class="fx"></div></div></div><h3></h3><p></p><small></small>`;
  el.querySelector("h3")!.textContent = s.title;
  el.querySelector("p")!.textContent = s.note;
  parent.append(el);
  const cat = el.querySelector<HTMLElement>(".cat")!;
  const fx = el.querySelector<HTMLElement>(".fx")!;
  const status = el.querySelector("small")!;
  const views = {} as Record<View, HTMLElement>;
  const rigs = {} as Record<View, Rig>;
  for (const v of ["front", "side", "back"] as View[]) {
    views[v] = document.createElement("div");
    views[v].className = "view";
    cat.append(views[v]);
    rigs[v] = mountRig(views[v], SVG[v]);
  }
  let brain: Brain, t = 0;
  const reset = () => {
    brain = createBrain(rigs.front, { x: s.x ?? 0, y: 0 });
    brain.setBounds({ minX: -400, maxX: 400, groundY: 0 });
    for (let i = 0; i < 20; i++) brain.tick(1 / 60);
    t = 0;
    s.start?.(brain);
  };
  reset();
  return (dt: number) => {
    t += dt;
    if (t > s.loop) reset();
    s.drive?.(brain, t, dt);
    const out = brain.tick(dt);
    for (const v of ["front", "side", "back"] as View[]) {
      rigs[v].apply(out.frame);
      views[v].classList.toggle("on", v === out.view);
    }
    rigs.side.flip(out.flip);
    cat.style.transform = `translate(0, ${out.win.y}px) translateY(${out.stage.y}px) scale(${out.stage.sx}, ${out.stage.sy})`;
    fx.replaceChildren(...out.zs.map((z) => {
      const e = document.createElement("span");
      e.textContent = "z";
      e.style.cssText = `opacity:${Math.max(0, z.opacity)};transform:translate(${z.x - WINDOW.catLeft}px, ${z.y - WINDOW.catTop + 20}px) scale(${z.scale})`;
      return e;
    }));
    status.textContent = `${brain.state} · ${out.view}${out.flip ? " ↔" : ""}`;
  };
}

const root = document.getElementById("gallery")!;
const updaters: ((dt: number) => void)[] = [];
for (const { group, items } of SCENARIOS) {
  const h = document.createElement("h2");
  h.textContent = group;
  const grid = document.createElement("section");
  grid.className = "grid";
  root.append(h, grid);
  for (const s of items) updaters.push(card(s, grid));
}
// ?at=2.5 fast-forwards every card to that moment (handy for reviewing poses in screenshots)
const at = Number(new URLSearchParams(location.search).get("at")) || 0;
for (let k = 0; k < at * 60; k++) updaters.forEach((u) => u(1 / 60));
let last = performance.now();
requestAnimationFrame(function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updaters.forEach((u) => u(dt));
  requestAnimationFrame(loop);
});
