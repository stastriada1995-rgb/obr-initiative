import OBR from "@owlbear-rodeo/sdk";
import {
  ITEM_KEY, SKILLS_KEY, RES_KEY, STATS_KEY, SCENE_KEY, HISTORY_KEY, RESOURCES, CONDITIONS, DEFENSES,
  freshResources, conditionByKey, skillType, sortSkills, rechargeText, stats, uid,
} from "./constants.js";
import { blockReason, applySkill, recharge, tickRound, rollRecharges, isClickable, applyHp } from "./logic.js";
import { withTip, hideTip } from "./tooltip.js";
import "./style.css";

const $ = (id) => document.getElementById(id);
const listEl = $("list");

let items = []; // участники боя, отсортированные по инициативе
let sceneState = { round: 1, turnId: null };
let isGM = false;
let history = []; // снимки состояния перед каждой сменой хода (для «Назад»)
const HISTORY_LIMIT = 12;
const HISTORY_MAX_CHARS = 9000; // метаданные сцены ограничены ~16 КБ на всех
let pickerFor = null; // у кого открыт выбор состояния
let pickerRounds = "";
let hpFor = null; // у кого открыта панель хитов
const drawer = new Map(); // ручное открытие/закрытие шторки: id → true/false
let drawerTurn = null;

// ---------- данные ----------

const getName = (item) => item.text?.plainText || item.name || "Без имени";
const initOf = (item) => item.metadata[ITEM_KEY].initiative;
const isEmpty = (v) => v === null || v === undefined;

function sortItems(list) {
  return list.sort((a, b) => {
    const ia = initOf(a), ib = initOf(b);
    if (isEmpty(ia) !== isEmpty(ib)) return isEmpty(ia) ? 1 : -1; // без инициативы — в конец
    if (!isEmpty(ia) && ib !== ia) return ib - ia;
    const ba = stats(a).initBonus ?? 0, bb = stats(b).initBonus ?? 0; // ничья — у кого выше бонус
    if (ba !== bb) return bb - ba;
    return getName(a).localeCompare(getName(b));
  });
}

function updateTracked(itemIds, mutate) {
  return OBR.scene.items.updateItems(itemIds, (drafts) => {
    for (const d of drafts) {
      const data = d.metadata[ITEM_KEY];
      if (data) {
        data.conditions ??= [];
        mutate(data, d);
      }
    }
  });
}
const updateItem = (itemId, mutate) =>
  OBR.scene.items.updateItems([itemId], (drafts) => drafts.forEach(mutate));

async function saveScene(patch) {
  sceneState = { ...sceneState, ...patch };
  await OBR.scene.setMetadata({ [SCENE_KEY]: sceneState });
}

// ---------- история ходов ----------

function takeSnapshot() {
  const snap = { round: sceneState.round, turnId: sceneState.turnId, items: {} };
  for (const it of items) {
    const st = stats(it);
    snap.items[it.id] = {
      c: it.metadata[ITEM_KEY],
      s: (it.metadata[SKILLS_KEY] || []).map((x) => [x.id, x.used || 0, x.done ? 1 : 0, x.usedRound ?? null]),
      r: (it.metadata[RES_KEY] || []).map((x) => [x.id, x.current, x.spentRound ?? null]),
      h: [st.hp ?? null, st.hpTemp ?? 0],
    };
  }
  return snap;
}

async function pushHistory() {
  let next = [...history, takeSnapshot()].slice(-HISTORY_LIMIT);
  while (next.length > 1 && JSON.stringify(next).length > HISTORY_MAX_CHARS) next = next.slice(1);
  history = next;
  await OBR.scene.setMetadata({ [HISTORY_KEY]: history });
}

async function undoTurn() {
  const snap = history[history.length - 1];
  if (!snap) return;
  const ids = Object.keys(snap.items);
  const existing = new Set((await OBR.scene.items.getItems(ids)).map((i) => i.id));
  const live = ids.filter((id) => existing.has(id));
  if (live.length) {
    await OBR.scene.items.updateItems(live, (drafts) => {
      for (const d of drafts) {
        const saved = snap.items[d.id];
        d.metadata[ITEM_KEY] = saved.c;
        const sk = new Map(saved.s.map(([id, ...rest]) => [id, rest]));
        if (d.metadata[SKILLS_KEY])
          d.metadata[SKILLS_KEY] = d.metadata[SKILLS_KEY].map((x) => {
            if (!sk.has(x.id)) return x;
            const [used, done, usedRound] = sk.get(x.id);
            const n = { ...x, used };
            if (done) n.done = true; else delete n.done;
            if (usedRound === null || usedRound === undefined) delete n.usedRound; else n.usedRound = usedRound;
            return n;
          });
        const rs = new Map(saved.r.map(([id, ...rest]) => [id, rest]));
        if (d.metadata[RES_KEY])
          d.metadata[RES_KEY] = d.metadata[RES_KEY].map((x) => {
            if (!rs.has(x.id)) return x;
            const [current, spentRound] = rs.get(x.id);
            const n = { ...x, current };
            if (spentRound === null || spentRound === undefined) delete n.spentRound; else n.spentRound = spentRound;
            return n;
          });
        if (saved.h && d.metadata[STATS_KEY]) {
          d.metadata[STATS_KEY] = { ...d.metadata[STATS_KEY], hp: saved.h[0], hpTemp: saved.h[1] };
        }
      }
    });
  }
  history = history.slice(0, -1);
  sceneState = { ...sceneState, round: snap.round, turnId: snap.turnId };
  await OBR.scene.setMetadata({ [HISTORY_KEY]: history, [SCENE_KEY]: sceneState });
}

// ---------- ходы ----------

// Действие и бонусное — только в свой ход. Пока бой не начат — без ограничений. ГМ: Shift+клик.
function offTurn(item, typeOrPip) {
  if (!sceneState.turnId || item.id === sceneState.turnId) return false;
  return typeOrPip === "action" || typeOrPip === "bonus";
}
const gmOverride = (e) => isGM && e.shiftKey;

// Начало хода: броски перезарядки навыков этого существа
async function startTurn(itemId) {
  if (!itemId) return;
  const results = [];
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) results.push(...rollRecharges(d));
  });
  const it = items.find((i) => i.id === itemId);
  for (const r of results) {
    OBR.notification.show(
      `${it ? getName(it) : ""}: «${r.name}» к${r.die} → ${r.roll} — ${r.ok ? "перезарядилось" : "не перезарядилось"} (нужно ${r.range})`,
      r.ok ? "SUCCESS" : "DEFAULT"
    );
  }
}

async function newRound(record = true) {
  if (record) await pushHistory();
  const round = sceneState.round + 1;
  await updateTracked(items.map((i) => i.id), (data, draft) => {
    Object.assign(data, freshResources());
    data.conditions = data.conditions
      .map((c) => (c.rounds ? { ...c, rounds: c.rounds - 1 } : c))
      .filter((c) => isEmpty(c.rounds) || c.rounds > 0);
    tickRound(draft, round);
  });
  const first = items[0]?.id ?? null;
  await saveScene({ round, turnId: first });
  await startTurn(first);
}

async function nextTurn() {
  if (!items.length) return;
  const idx = items.findIndex((i) => i.id === sceneState.turnId);
  await pushHistory();
  if (idx === items.length - 1) return newRound(false); // конец раунда
  const next = items[idx === -1 ? 0 : idx + 1].id;
  await saveScene({ turnId: next });
  await startTurn(next);
}

async function resetCombat() {
  if (!confirm("Сбросить бой: раунд 1, все Д/Б/Р восстановлены?")) return;
  await pushHistory();
  await updateTracked(items.map((i) => i.id), (data, draft) => {
    Object.assign(data, freshResources());
    recharge(draft, ["round", "round2", "roll"]);
  });
  await saveScene({ round: 1, turnId: null });
}

function rest(types) {
  return OBR.scene.items.updateItems(items.map((i) => i.id), (drafts) => drafts.forEach((d) => recharge(d, types)));
}

function rollInitiative(targets) {
  const lines = [];
  return updateTracked(targets.map((i) => i.id), (data, draft) => {
    const bonus = draft.metadata[STATS_KEY]?.initBonus ?? 0;
    const d20 = 1 + Math.floor(Math.random() * 20);
    data.initiative = d20 + bonus;
    lines.push(`${getName(draft)}: к20 (${d20}) ${bonus >= 0 ? "+" : "−"} ${Math.abs(bonus)} = ${d20 + bonus}`);
  }).then(() => {
    if (lines.length === 1) OBR.notification.show(`🎲 ${lines[0]}`);
    else if (lines.length) OBR.notification.show(`🎲 Брошена инициатива: ${lines.length}`);
  });
}

function addCondition(itemId, key) {
  const rounds = parseInt(pickerRounds, 10);
  updateTracked([itemId], (data) => {
    const existing = data.conditions.find((c) => c.key === key);
    if (existing) {
      if (conditionByKey(key)?.leveled) existing.level = Math.min(6, (existing.level || 1) + 1);
      if (rounds > 0) existing.rounds = rounds;
      return;
    }
    const c = { id: uid(), key };
    if (conditionByKey(key)?.leveled) c.level = 1;
    if (rounds > 0) c.rounds = rounds;
    data.conditions.push(c);
  });
}

async function centerOn(itemId) {
  try {
    const [bounds, scale, width, height] = await Promise.all([
      OBR.scene.items.getItemBounds([itemId]),
      OBR.viewport.getScale(),
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    await OBR.viewport.animateTo({
      scale,
      position: { x: width / 2 - bounds.center.x * scale, y: height / 2 - bounds.center.y * scale },
    });
  } catch (e) {
    console.warn("Не удалось показать токен", e);
  }
}

// ---------- отрисовка: мелкие элементы ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderInitiative(item) {
  const box = el("div", "init-box");
  const v = initOf(item);
  if (!isGM) {
    box.append(el("div", "init readonly", isEmpty(v) ? "—" : String(v)));
    return box;
  }
  const init = el("input", "init");
  init.type = "text";
  init.inputMode = "numeric";
  init.placeholder = "—";
  init.value = isEmpty(v) ? "" : v;
  init.dataset.initId = item.id;
  init.addEventListener("focus", () => init.select());
  init.addEventListener("change", () => {
    const raw = init.value.trim();
    const n = parseInt(raw, 10);
    updateTracked([item.id], (d) => (d.initiative = raw === "" || isNaN(n) ? null : n));
  });
  init.addEventListener("keydown", (e) => e.key === "Enter" && init.blur());

  const bonus = stats(item).initBonus ?? 0;
  const roll = el("button", "roll", "к20");
  withTip(roll, () => ({ title: "Бросить инициативу", meta: `к20 ${bonus >= 0 ? "+" : "−"} ${Math.abs(bonus)}` }));
  roll.onclick = () => rollInitiative([item]);
  box.append(init, roll);
  return box;
}

function renderConditionChip(item, c) {
  const def = conditionByKey(c.key);
  if (!def) return null;
  let label = `${def.icon} ${def.name}`;
  if (c.level) label += ` ${c.level}`;
  if (c.rounds) label += ` · ${c.rounds}р`;
  const chip = el(isGM ? "button" : "span", "chip cond", label);
  withTip(chip, () => ({
    title: def.name + (c.level ? `, уровень ${c.level}` : ""),
    meta: c.rounds ? `Осталось раундов: ${c.rounds}` : "",
    body: def.desc,
  }));
  if (!isGM) return chip;
  chip.addEventListener("click", () =>
    updateTracked([item.id], (d) => (d.conditions = d.conditions.filter((x) => x.id !== c.id)))
  );
  if (def.leveled) {
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      updateTracked([item.id], (d) => {
        const x = d.conditions.find((x) => x.id === c.id);
        if (!x) return;
        if ((x.level || 1) <= 1) d.conditions = d.conditions.filter((y) => y.id !== c.id);
        else x.level -= 1;
      });
    });
  }
  return chip;
}

function renderDefenseChips(item) {
  const st = stats(item);
  return DEFENSES.filter((d) => st[d.key]?.trim()).map((d) => {
    const chip = el("span", `chip def def-${d.key}`, `${d.short}: ${st[d.key].trim()}`);
    withTip(chip, () => ({ title: d.label, body: st[d.key].trim() }));
    return chip;
  });
}

function renderResourceChip(item, r) {
  const chip = el("button", "chip resource" + (r.current <= 0 ? " used" : ""), `◆ ${r.name} ${r.current}/${r.max}`);
  withTip(chip, () => ({ title: r.name, meta: `${r.current} из ${r.max} · ${rechargeText(r)}` }));
  const change = (delta) =>
    updateItem(item.id, (d) => {
      d.metadata[RES_KEY] = (d.metadata[RES_KEY] || []).map((x) =>
        x.id !== r.id
          ? x
          : {
              ...x,
              current: Math.max(0, Math.min(x.max, x.current + delta)),
              ...(delta < 0 ? { spentRound: sceneState.round } : {}),
            }
      );
    });
  chip.addEventListener("click", () => change(-1));
  chip.addEventListener("contextmenu", (e) => { e.preventDefault(); change(1); });
  return chip;
}

function renderSkillChip(item, s) {
  const t = skillType(s.type);
  const resources = item.metadata[RES_KEY] || [];
  const clickable = isClickable(s);
  const blocked = clickable ? blockReason(s, item.metadata[ITEM_KEY], resources) : null;
  const locked = offTurn(item, t.key);
  const chip = el(clickable ? "button" : "span",
    `chip skill t-${t.key}` + (s.spell ? " spell" : "") + (blocked ? " used" : "") +
    (locked ? " locked" : "") + (clickable ? "" : " static"));
  chip.append(el("span", "", (s.spell ? "✦ " : "") + s.name));
  if (s.cost?.resId && resources.some((x) => x.id === s.cost.resId))
    chip.append(el("span", "count", ` ◆${s.cost.amount || 1}`));
  if (s.max) chip.append(el("span", "count", ` ${s.max - (s.used || 0)}/${s.max}`));

  withTip(chip, () => {
    const meta = [t.label + (s.spell ? ", заклинание" : "")];
    if (s.cost?.resId) {
      const r = resources.find((x) => x.id === s.cost.resId);
      if (r) meta.push(`${s.cost.amount || 1} × ${r.name} (${r.current}/${r.max})`);
    }
    if (s.max) meta.push(`заряды ${s.max - (s.used || 0)}/${s.max} · ${rechargeText(s)}`);
    return {
      title: s.name,
      meta: meta.join(" · "),
      body: s.desc || "",
      warn: locked ? "Не ход этого персонажа" : blocked ? `Недоступно: ${blocked}` : "",
    };
  });

  if (!clickable) return chip;
  chip.addEventListener("click", (e) => {
    if (locked && !gmOverride(e)) return;
    if (!blocked) updateItem(item.id, (d) => applySkill(d, s.id, 1, sceneState.round));
  });
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (locked && !gmOverride(e)) return;
    updateItem(item.id, (d) => applySkill(d, s.id, -1, sceneState.round));
  });
  return chip;
}

function renderStatsLine(item) {
  const st = stats(item);
  const line = el("button", "stats-line" + (hpFor === item.id ? " on" : ""));
  if (st.hpMax != null) {
    const hp = st.hp ?? st.hpMax;
    const r = Math.max(0, Math.min(1, hp / Math.max(1, st.hpMax)));
    const bar = el("span", "mini-bar");
    const fill = el("span", "mini-fill");
    fill.style.width = `${r * 100}%`;
    fill.style.background = r > 0.5 ? "var(--hp-ok)" : r > 0.25 ? "var(--hp-mid)" : "var(--hp-low)";
    bar.append(fill);
    line.append(bar, el("span", "hp-text", `${hp}/${st.hpMax}`));
    if (st.hpTemp) line.append(el("span", "hp-temp", `+${st.hpTemp}`));
  } else {
    line.append(el("span", "hp-none", "♥ —"));
  }
  if (st.ac != null) line.append(el("span", "ac", `🛡 ${st.ac}`));
  withTip(line, () => ({ title: "Хиты и КД", meta: "Урон, лечение, временные хиты" }));
  line.onclick = (e) => {
    e.stopPropagation();
    hpFor = hpFor === item.id ? null : item.id;
    render();
  };
  return line;
}

function renderHpPanel(item) {
  const st = stats(item);
  const box = el("div", "hp-panel");
  const row1 = el("div", "hp-row");
  const amount = el("input", "hp-amount");
  amount.type = "number";
  amount.min = 0;
  amount.placeholder = "0";
  amount.dataset.hpFor = item.id;
  const act = (kind) => {
    const n = parseInt(amount.value, 10);
    if (!(n > 0)) return amount.focus();
    updateItem(item.id, (d) => applyHp(d, kind, n));
    amount.value = "";
  };
  amount.addEventListener("keydown", (e) => e.key === "Enter" && act("damage"));
  const dmg = el("button", "hp-btn dmg", "Урон");
  const heal = el("button", "hp-btn heal", "Лечение");
  const temp = el("button", "hp-btn temp", "Врем. хиты");
  dmg.onclick = () => act("damage");
  heal.onclick = () => act("heal");
  temp.onclick = () => act("temp");
  row1.append(amount, dmg, heal, temp);

  const row2 = el("div", "hp-row fields");
  const field = (label, key, value) => {
    const l = el("label", "", label);
    const i = el("input");
    i.type = "number";
    i.value = value ?? "";
    i.placeholder = "—";
    i.dataset.statFor = `${item.id}:${key}`;
    i.addEventListener("change", () => {
      const v = i.value.trim() === "" ? null : parseInt(i.value, 10);
      updateItem(item.id, (d) => {
        const s = { ...(d.metadata[STATS_KEY] || {}) };
        s[key] = isNaN(v) ? null : v;
        if (key === "hpMax" && s.hp == null && v != null) s.hp = v;
        d.metadata[STATS_KEY] = s;
      });
    });
    l.append(i);
    return l;
  };
  row2.append(
    field("Хиты", "hp", st.hp ?? st.hpMax),
    field("Макс", "hpMax", st.hpMax),
    field("Врем.", "hpTemp", st.hpTemp || null),
    field("КД", "ac", st.ac),
  );
  box.append(row1, row2);
  return box;
}

function renderPicker(item) {
  const box = el("div", "picker");
  const head = el("div", "picker-head");
  const label = el("label", "", "Длительность, раундов ");
  const rounds = el("input", "rounds");
  rounds.type = "number";
  rounds.min = 1;
  rounds.placeholder = "∞";
  rounds.value = pickerRounds;
  rounds.dataset.roundsFor = item.id;
  rounds.addEventListener("input", () => (pickerRounds = rounds.value));
  label.append(rounds);
  const close = el("button", "ghost icon", "✕");
  close.onclick = () => { pickerFor = null; render(); };
  head.append(label, close);
  const grid = el("div", "picker-grid");
  for (const def of CONDITIONS) {
    const b = el("button", "chip", `${def.icon} ${def.name}`);
    withTip(b, () => ({ title: def.name, body: def.desc }));
    b.onclick = () => addCondition(item.id, def.key);
    grid.append(b);
  }
  box.append(head, grid);
  return box;
}

// ---------- строка участника ----------

function isOpen(item) {
  return drawer.has(item.id) ? drawer.get(item.id) : item.id === sceneState.turnId;
}

function renderRow(item) {
  const data = item.metadata[ITEM_KEY];
  const active = item.id === sceneState.turnId;
  const li = el("li", "row" + (active ? " active" : "") + (item.visible === false ? " hidden-token" : ""));
  const main = el("div", "row-main");

  const who = el("div", "who");
  const face = el("button", "face");
  if (item.image?.url) {
    const img = el("img");
    img.src = item.image.url;
    img.alt = "";
    face.append(img);
  }
  face.append(el("span", "name", getName(item)));
  face.addEventListener("click", () => OBR.player.select([item.id]));
  face.addEventListener("dblclick", () => centerOn(item.id));
  who.append(face);
  main.append(renderInitiative(item), who);

  if (isGM) {

    const res = el("div", "res");
    for (const r of RESOURCES) {
      const available = data[r.key] !== false;
      const locked = offTurn(item, r.key);
      const b = el("button", `pip pip-${r.key}` + (available ? "" : " used") + (locked ? " locked" : ""), r.short);
      withTip(b, () => ({
        title: r.label,
        meta: available ? "Доступно" : "Потрачено",
        warn: locked ? "Не ход этого персонажа" : "",
      }));
      b.addEventListener("click", (e) => {
        if (locked && !gmOverride(e)) return;
        updateTracked([item.id], (d) => (d[r.key] = d[r.key] === false));
      });
      res.append(b);
    }

    const add = el("button", "add" + (pickerFor === item.id ? " on" : ""), "+");
    withTip(add, () => ({ title: "Добавить состояние" }));
    add.onclick = () => { pickerFor = pickerFor === item.id ? null : item.id; render(); };

    const defenses = renderDefenseChips(item);
    const resources = (item.metadata[RES_KEY] || []).filter((r) => r.show).map((r) => renderResourceChip(item, r));
    const skills = sortSkills(item.metadata[SKILLS_KEY] || []).map((s) => renderSkillChip(item, s));
    const drawerItems = [...defenses, ...resources, ...skills];

    const toggle = el("button", "toggle" + (isOpen(item) ? " open" : ""));
    toggle.append(el("span", "chev"));
    toggle.disabled = !drawerItems.length;
    if (drawerItems.length) withTip(toggle, () => ({ title: isOpen(item) ? "Свернуть навыки" : "Показать навыки" }));
    toggle.onclick = () => { drawer.set(item.id, !isOpen(item)); render(); };
    main.append(res, add, toggle);
    li.append(main);

    const conditions = (data.conditions || []).map((c) => renderConditionChip(item, c)).filter(Boolean);
    const status = el("div", "tags conds");
    status.append(renderStatsLine(item), ...conditions);
    li.append(status);
    if (hpFor === item.id) li.append(renderHpPanel(item));
    if (pickerFor === item.id) li.append(renderPicker(item));
    if (drawerItems.length && isOpen(item)) {
      const d = el("div", "tags drawer");
      d.append(...drawerItems);
      li.append(d);
    }
  } else {
    li.append(main);
    const conditions = (data.conditions || []).map((c) => renderConditionChip(item, c)).filter(Boolean);
    if (conditions.length) {
      const c = el("div", "tags conds");
      c.append(...conditions);
      li.append(c);
    }
  }
  return li;
}

function visibleItems() {
  return isGM ? items : items.filter((i) => i.visible !== false);
}

function render() {
  hideTip();
  if (drawerTurn !== sceneState.turnId) { drawer.clear(); drawerTurn = sceneState.turnId; } // новый ход — шторки по умолчанию
  $("round").textContent = sceneState.round;
  $("prev-turn").disabled = history.length === 0;
  const shown = visibleItems();
  $("empty").hidden = shown.length > 0;
  document.body.classList.toggle("is-gm", isGM);
  if (pickerFor && !items.some((i) => i.id === pickerFor)) pickerFor = null;
  if (hpFor && !items.some((i) => i.id === hpFor)) hpFor = null;

  // сохранить фокус и ввод в поле, которое сейчас редактируется
  const f = document.activeElement;
  const ds = f?.dataset || {};
  const focusKey = ds.initId ? `[data-init-id="${ds.initId}"]`
    : ds.roundsFor ? `[data-rounds-for="${ds.roundsFor}"]`
    : ds.hpFor ? `[data-hp-for="${ds.hpFor}"]`
    : ds.statFor ? `[data-stat-for="${ds.statFor}"]`
    : null;
  const typed = focusKey ? f.value : null;

  listEl.replaceChildren(...shown.map(renderRow));

  if (focusKey) {
    const n = listEl.querySelector(focusKey);
    if (n) { n.value = typed; n.focus(); }
  }
}

// ---------- подписки ----------

function onItems(all) {
  items = sortItems(all.filter((i) => i.metadata[ITEM_KEY] !== undefined));
  render();
}

async function setupScene() {
  onItems(await OBR.scene.items.getItems());
  const meta = await OBR.scene.getMetadata();
  sceneState = { round: 1, turnId: null, ...(meta[SCENE_KEY] || {}) };
  history = meta[HISTORY_KEY] || [];
  render();
}

function applyTheme(theme) {
  const root = document.documentElement.style;
  root.setProperty("--head-bg", theme.background.paper);
}

OBR.onReady(async () => {
  isGM = (await OBR.player.getRole()) === "GM";
  OBR.player.onChange((p) => {
    const gm = p.role === "GM";
    if (gm !== isGM) { isGM = gm; render(); }
  });
  try { applyTheme(await OBR.theme.getTheme()); OBR.theme.onChange(applyTheme); } catch { /* тема по умолчанию */ }

  $("next-turn").addEventListener("click", nextTurn);
  $("next-round").addEventListener("click", () => newRound());
  $("prev-turn").addEventListener("click", undoTurn);
  $("reset").addEventListener("click", resetCombat);
  $("short-rest").addEventListener("click", () => rest(["round", "round2", "roll", "short"]));
  $("long-rest").addEventListener("click", () => rest(["round", "round2", "roll", "short", "long"]));
  $("roll-all").addEventListener("click", () => {
    const empty = items.filter((i) => isEmpty(initOf(i)));
    if (empty.length) rollInitiative(empty);
    else if (items.length && confirm("У всех уже есть инициатива. Перебросить всем?")) rollInitiative(items);
  });
  document.addEventListener("click", (e) => {
    if (hpFor && !e.target.closest(".hp-panel") && !e.target.closest(".stats-line")) { hpFor = null; render(); }
  });

  OBR.scene.items.onChange(onItems);
  OBR.scene.onMetadataChange((meta) => {
    sceneState = { round: 1, turnId: null, ...(meta[SCENE_KEY] || {}) };
    history = meta[HISTORY_KEY] || [];
    render();
  });
  OBR.scene.onReadyChange((ready) => {
    if (ready) setupScene();
    else { items = []; render(); }
  });
  if (await OBR.scene.isReady()) setupScene();
  else render();
});
