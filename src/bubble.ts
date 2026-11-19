// Speech bubble beside the cat's head. One at a time; the queue lives in main.ts.
// Click: expand a clipped message, otherwise close. Auto-closes after BUBBLE.autoClose s, except errors.
import { BUBBLE } from "./config";

export type Level = "info" | "success" | "warning" | "error";
export interface Note { id: string; title: string; message: string; level: Level; source?: string; receivedAt: string }

/** onClose(byUser): true when the user closed it (× or a click), false for auto-close or close(). */
export function createBubble(el: HTMLElement, onClose: (byUser: boolean) => void) {
  const title = el.querySelector<HTMLElement>(".t")!;
  const message = el.querySelector<HTMLElement>(".m")!;
  const meta = el.querySelector<HTMLElement>(".s")!;
  const closeBtn = el.querySelector<HTMLElement>(".x")!;
  let timer = 0;
  let open = false;
  let level: Level = "info";

  const arm = () => {
    clearTimeout(timer);
    if (level !== "error") timer = window.setTimeout(() => close(), BUBBLE.autoClose * 1000);
  };

  function close(byUser = false) {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    el.classList.remove("on");
    onClose(byUser);
  }

  el.addEventListener("click", () => {
    const clipped = message.scrollHeight > message.clientHeight + 1;
    if (!el.classList.contains("open") && clipped) {
      el.classList.add("open");
      arm(); // fresh reading time
    } else close(true);
  });
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(true); });

  return {
    get isOpen() { return open; },
    show(n: Note, side: 1 | -1) {
      open = true;
      level = n.level;
      // textContent only: notification text comes from outside the app
      el.dataset.level = n.level;
      el.classList.toggle("left", side < 0);
      el.classList.toggle("right", side > 0);
      el.classList.remove("open");
      title.textContent = n.title;
      message.textContent = n.message;
      const time = new Date(n.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      meta.textContent = n.source ? `${n.source} · ${time}` : time;
      el.classList.add("on");
      arm();
    },
    close: () => close(),
  };
}
