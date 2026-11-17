// Подсказка в стиле карточки навыка: название, строка с типом/стоимостью, описание.
// Источник содержимого: функция el._tip() → { title, meta, body, warn }.

let tip;
let current = null;

function ensure() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

function place(target) {
  const r = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  tip.style.maxWidth = `${Math.min(320, vw - 16)}px`;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const t = tip.getBoundingClientRect();
  let left = Math.min(Math.max(8, r.left), vw - t.width - 8);
  let top = r.bottom + 6;
  if (top + t.height > vh - 8) top = Math.max(8, r.top - t.height - 6); // не влезает снизу — сверху
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function show(target) {
  const data = target._tip?.();
  if (!data) return hide();
  ensure();
  const parts = [];
  tip.replaceChildren();
  const add = (cls, text) => {
    if (!text) return;
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    parts.push(d);
  };
  add("tip-title", data.title);
  add("tip-meta", data.meta);
  add("tip-body", data.body);
  add("tip-warn", data.warn);
  tip.append(...parts);
  tip.hidden = false;
  current = target;
  place(target);
}

export function hideTip() {
  if (tip) tip.hidden = true;
  current = null;
}
const hide = hideTip;

// Привязать подсказку к элементу
export function withTip(el, fn) {
  el._tip = fn;
  el.addEventListener("mouseenter", () => show(el));
  el.addEventListener("mouseleave", () => current === el && hide());
  el.addEventListener("focus", () => show(el));
  el.addEventListener("blur", () => current === el && hide());
  return el;
}

window.addEventListener("scroll", hide, true);
