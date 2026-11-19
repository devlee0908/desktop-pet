// Notification inbox window. The sidecar owns the data; this window renders the list it
// broadcasts ("pet-mcp" state events) and sends actions back through the inbox_do command.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Level, Note } from "./bubble";
import catSvg from "./assets/cat-front.svg?raw";

type Stored = Note & { read: boolean };
const LEVELS: Level[] = ["info", "success", "warning", "error"];
const LEVEL_LABEL: Record<Level, string> = { info: "정보", success: "성공", warning: "경고", error: "오류" };
const NO_SOURCE = ""; // notifications sent without `source`

let notes: Stored[] = [];
let source: string | null = null; // null = all
let level: Level | null = null; // null = all
const open = new Set<string>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // never innerHTML: the text comes from outside
  return e;
};
const srcOf = (n: Stored) => n.source ?? NO_SOURCE;
const srcLabel = (s: string) => (s === NO_SOURCE ? "기타" : s);
const act = (action: object) => invoke("inbox_do", { action }).catch((e) => console.error(e));

function ago(iso: string): string {
  const t = Date.parse(iso), s = (Date.now() - t) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(t).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function visible(): Stored[] {
  return notes.filter((n) => (source === null || srcOf(n) === source) && (level === null || n.level === level));
}

function renderSources() {
  const groups = new Map<string, { unread: number; latest: string }>();
  for (const n of notes) {
    const g = groups.get(srcOf(n)) ?? { unread: 0, latest: n.receivedAt };
    if (!n.read) g.unread++;
    if (n.receivedAt > g.latest) g.latest = n.receivedAt;
    groups.set(srcOf(n), g);
  }
  if (source !== null && !groups.has(source)) source = null; // its last notification was removed
  const row = (key: string | null, name: string, unread: number) => {
    const b = el("button", "src" + (source === key ? " on" : ""));
    b.append(el("span", "name", name), el("span", "badge", unread ? String(unread) : ""));
    b.onclick = () => { source = key; render(); };
    return b;
  };
  const nav = $("sources");
  nav.replaceChildren(row(null, "모든 알림", notes.filter((n) => !n.read).length));
  [...groups.entries()].sort((a, b) => b[1].latest.localeCompare(a[1].latest))
    .forEach(([key, g]) => nav.append(row(key, srcLabel(key), g.unread)));
}

function renderLevels() {
  const chip = (key: Level | null, label: string) => {
    const b = el("button", "chip" + (level === key ? " on" : ""));
    if (key) {
      const dot = el("i");
      dot.style.background = `var(--${key})`;
      b.append(dot);
    }
    b.append(label);
    b.onclick = () => { level = key; render(); };
    return b;
  };
  $("levels").replaceChildren(chip(null, "전체"), ...LEVELS.map((l) => chip(l, LEVEL_LABEL[l])));
}

function renderList() {
  const list = visible();
  const heading = $("heading");
  heading.replaceChildren(source === null ? "모든 알림" : srcLabel(source), el("small", undefined, `${list.length}개`));
  ($("read-all") as HTMLButtonElement).disabled = !list.some((n) => !n.read);
  ($("clear") as HTMLButtonElement).disabled = list.length === 0;

  const box = $("list");
  if (!list.length) {
    const empty = el("div", "empty");
    const cat = el("div", "cat");
    cat.innerHTML = catSvg; // our own asset
    empty.append(cat, el("b", undefined, notes.length ? "조건에 맞는 알림이 없어요" : "조용하네요"),
      el("span", undefined, notes.length ? "필터를 바꿔 보세요." : "귀찮게 할 일이 하나도 없어요."));
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(...list.map((n) => {
    const item = el("article", "item" + (n.read ? "" : " unread") + (open.has(n.id) ? " open" : ""));
    const dot = el("i");
    dot.style.background = `var(--${n.level})`;
    dot.title = LEVEL_LABEL[n.level];
    item.append(dot, el("span", "title", n.title), el("span", "time", ago(n.receivedAt)), el("span", "msg", n.message));
    if (source === null) item.append(el("span", "tag", srcLabel(srcOf(n))));
    const del = el("button", "del", "×");
    del.title = "삭제";
    del.onclick = (e) => { e.stopPropagation(); act({ op: "delete", ids: [n.id] }); };
    item.append(del);
    item.onclick = () => {
      if (open.has(n.id)) open.delete(n.id); else open.add(n.id);
      if (!n.read) act({ op: "read", ids: [n.id] });
      render();
    };
    return item;
  }));
}

function render() {
  renderSources();
  renderLevels();
  renderList();
}

// bulk actions apply to exactly what is on screen
$("read-all").onclick = () => {
  const ids = visible().filter((n) => !n.read).map((n) => n.id);
  if (ids.length) act({ op: "read", ids });
};
const clearBtn = $("clear") as HTMLButtonElement;
let armed = 0;
clearBtn.onclick = () => {
  if (!armed) { // first click arms, second within 3s deletes
    clearBtn.classList.add("armed");
    clearBtn.textContent = "정말 지울까요?";
    armed = window.setTimeout(disarm, 3000);
    return;
  }
  disarm();
  act({ op: "delete", ids: visible().map((n) => n.id) });
};
function disarm() {
  clearTimeout(armed);
  armed = 0;
  clearBtn.classList.remove("armed");
  clearBtn.textContent = "지우기";
}

listen<{ type: string; notifications?: Stored[] }>("pet-mcp", ({ payload }) => {
  if (payload.type === "state" && payload.notifications) {
    notes = payload.notifications;
    render();
  }
});
notes = await invoke<Stored[]>("inbox_state");
render();
setInterval(renderList, 30_000); // keep "n분 전" fresh
