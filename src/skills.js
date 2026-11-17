import OBR from "@owlbear-rodeo/sdk";
import {
  SKILLS_KEY, RES_KEY, STATS_KEY, SKILLS_POPOVER, RECHARGE, SKILL_TYPES, SKILL_ORDER, DEFENSES, DICE,
  skillType, sortSkills, rechargeText, rollRange, uid,
} from "./constants.js";
import { parseImport, applyImport, exportData } from "./importer.js";
import "./style.css";

const $ = (id) => document.getElementById(id);
const itemId = new URLSearchParams(location.search).get("item");

let skills = [];
let resources = [];
let st = {};
let editingSkill = null;
let editingRes = null;
let selectedType = "action";

const GROUP_LABELS = {
  passive: "Пассивки", reaction: "Реакции", free: "Свободные действия",
  action: "Действия", bonus: "Бонусные действия",
};

function fillSelect(sel, options) {
  sel.replaceChildren(
    ...options.map(([value, label]) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    })
  );
}
fillSelect($("f-recharge"), RECHARGE.map((r) => [r.key, r.label]));
fillSelect($("r-recharge"), RECHARGE.filter((r) => !r.skillOnly).map((r) => [r.key, r.label]));
fillSelect($("f-die"), DICE.map((d) => [d, `к${d}`]));

function save(patch) {
  return OBR.scene.items.updateItems([itemId], (items) => {
    for (const it of items) Object.assign(it.metadata, patch);
  });
}
function saveStats(patch) {
  return OBR.scene.items.updateItems([itemId], (items) => {
    for (const it of items) it.metadata[STATS_KEY] = { ...(it.metadata[STATS_KEY] || {}), ...patch };
  });
}

// ---------- характеристики и защиты ----------

const STAT_FIELDS = ["ac", "hp", "hpMax", "hpTemp", "initBonus"];
for (const key of STAT_FIELDS) {
  $(`s-${key}`).addEventListener("change", (e) => {
    const raw = e.target.value.trim();
    const v = raw === "" ? null : parseInt(raw, 10);
    const patch = { [key]: isNaN(v) ? null : v };
    if (key === "hpMax" && v != null && st.hp == null) patch.hp = v; // новые хиты — полные
    saveStats(patch);
  });
}
$("s-showBar").addEventListener("change", (e) => saveStats({ showBar: e.target.checked }));

for (const d of DEFENSES) {
  const label = document.createElement("label");
  label.textContent = d.label;
  const input = document.createElement("input");
  input.id = `d-${d.key}`;
  input.placeholder = d.key.endsWith("Cond") ? "напр. отравление, испуг" : "напр. огонь, яд";
  input.addEventListener("change", () => saveStats({ [d.key]: input.value.trim() }));
  label.append(input);
  $("defenses").append(label);
}

function renderStats() {
  for (const key of STAT_FIELDS) {
    const i = $(`s-${key}`);
    if (document.activeElement !== i) i.value = st[key] ?? "";
  }
  $("s-showBar").checked = !!st.showBar;
  for (const d of DEFENSES) {
    const i = $(`d-${d.key}`);
    if (document.activeElement !== i) i.value = st[d.key] || "";
  }
}

// ---------- ресурсы ----------

function resetResForm() {
  editingRes = null;
  $("res-form").reset();
  $("r-max").value = 3;
  $("r-recharge").value = "long";
  $("r-submit").textContent = "Добавить ресурс";
  $("r-cancel").hidden = true;
}

function renderResources() {
  $("res-empty").hidden = resources.length > 0;
  $("resources").replaceChildren(
    ...resources.map((r) => {
      const li = document.createElement("li");
      li.className = "res-item";
      li.innerHTML = `
        <div class="res-name"><b></b><span class="meta"></span></div>
        <button class="ghost icon minus" title="−1">−</button>
        <span class="val">${r.current}/${r.max}</span>
        <button class="ghost icon plus" title="+1">+</button>
        <button class="ghost icon edit" title="Изменить">✎</button>
        <button class="ghost icon del" title="Удалить">🗑</button>`;
      li.querySelector("b").textContent = r.name;
      li.querySelector(".meta").textContent = rechargeText(r) + (r.show ? " · в трекере" : "");
      const set = (cur) => save({ [RES_KEY]: resources.map((x) => (x.id === r.id ? { ...x, current: cur } : x)) });
      li.querySelector(".minus").onclick = () => set(Math.max(0, r.current - 1));
      li.querySelector(".plus").onclick = () => set(Math.min(r.max, r.current + 1));
      li.querySelector(".edit").onclick = () => {
        editingRes = r.id;
        $("r-name").value = r.name;
        $("r-max").value = r.max;
        $("r-recharge").value = r.recharge === "roll" ? "long" : r.recharge;
        $("r-show").checked = !!r.show;
        $("r-submit").textContent = "Сохранить";
        $("r-cancel").hidden = false;
        $("r-name").focus();
      };
      li.querySelector(".del").onclick = () => {
        if (!confirm(`Удалить ресурс «${r.name}»?`)) return;
        save({
          [RES_KEY]: resources.filter((x) => x.id !== r.id),
          [SKILLS_KEY]: skills.map((s) => (s.cost?.resId === r.id ? { ...s, cost: null } : s)),
        });
      };
      return li;
    })
  );
  const current = $("f-cost").value;
  fillSelect($("f-cost"), [["", "— нет —"], ...resources.map((r) => [r.id, r.name])]);
  $("f-cost").value = resources.some((r) => r.id === current) ? current : "";
  syncForm();
}

$("res-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("r-name").value.trim();
  if (!name) return;
  const max = Math.max(1, parseInt($("r-max").value, 10) || 1);
  const data = { name, max, recharge: $("r-recharge").value, show: $("r-show").checked };
  const next = editingRes
    ? resources.map((r) => (r.id === editingRes ? { ...r, ...data, current: Math.min(r.current, max) } : r))
    : [...resources, { id: uid(), current: max, ...data }];
  save({ [RES_KEY]: next });
  resetResForm();
});
$("r-cancel").onclick = resetResForm;

// ---------- форма навыка ----------

for (const t of SKILL_TYPES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `type-btn t-${t.key}`;
  b.dataset.type = t.key;
  b.textContent = t.label;
  b.onclick = () => setType(t.key);
  $("f-type").append(b);
}
function setType(key) {
  selectedType = key;
  for (const b of $("f-type").children) b.classList.toggle("on", b.dataset.type === key);
}
$("f-spell").addEventListener("change", () => $("f-type").classList.toggle("spell", $("f-spell").checked));

function syncForm() {
  $("f-amount").disabled = !$("f-cost").value;
  const roll = $("f-recharge").value === "roll";
  $("roll-row").hidden = !roll;
  if (roll) {
    const die = parseInt($("f-die").value, 10);
    const min = Math.min(parseInt($("f-rollMin").value, 10) || die, die);
    $("f-rollMin").max = die;
    $("roll-hint").textContent = `В начале хода бросается к${die}: ${rollRange({ rollDie: die, rollMin: min })} — перезарядка`;
  }
}
["f-cost", "f-recharge", "f-die", "f-rollMin"].forEach((id) => $(id).addEventListener("input", syncForm));

function resetForm() {
  editingSkill = null;
  $("form").reset();
  $("f-amount").value = 1;
  $("f-recharge").value = "long";
  $("f-die").value = "6";
  $("f-rollMin").value = 5;
  $("f-type").classList.remove("spell");
  setType("action");
  syncForm();
  $("form-title").textContent = "Новый навык";
  $("f-submit").textContent = "Добавить";
  $("f-cancel").hidden = true;
}

function startEdit(s) {
  editingSkill = s.id;
  $("f-name").value = s.name;
  $("f-desc").value = s.desc || "";
  setType(skillType(s.type).key);
  $("f-spell").checked = !!s.spell;
  $("f-type").classList.toggle("spell", !!s.spell);
  $("f-cost").value = s.cost?.resId || "";
  $("f-amount").value = s.cost?.amount || 1;
  $("f-max").value = s.max || "";
  $("f-recharge").value = s.recharge || "long";
  $("f-die").value = String(s.rollDie || 6);
  $("f-rollMin").value = s.rollMin || 5;
  syncForm();
  $("form-title").textContent = `Редактирование: ${s.name}`;
  $("f-submit").textContent = "Сохранить";
  $("f-cancel").hidden = false;
  $("f-name").focus();
  $("f-name").scrollIntoView({ block: "center", behavior: "smooth" });
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("f-name").value.trim();
  if (!name) return;
  const maxRaw = parseInt($("f-max").value, 10);
  const resId = $("f-cost").value;
  const recharge = $("f-recharge").value;
  const data = {
    name,
    desc: $("f-desc").value.trim(),
    type: selectedType,
    spell: $("f-spell").checked,
    cost: resId ? { resId, amount: Math.max(1, parseInt($("f-amount").value, 10) || 1) } : null,
    max: maxRaw > 0 ? maxRaw : null,
    recharge,
  };
  if (recharge === "roll") {
    data.rollDie = parseInt($("f-die").value, 10) || 6;
    data.rollMin = Math.min(Math.max(1, parseInt($("f-rollMin").value, 10) || data.rollDie), data.rollDie);
    if (!data.max) data.max = 1; // перезарядка броском имеет смысл только с зарядами
  }
  const next = editingSkill
    ? skills.map((s) => (s.id === editingSkill ? { ...s, ...data, used: Math.min(s.used || 0, data.max || 0) } : s))
    : [...skills, { id: uid(), used: 0, ...data }];
  save({ [SKILLS_KEY]: next });
  resetForm();
});
$("f-cancel").onclick = resetForm;

// ---------- список навыков по группам ----------

function costText(s) {
  const parts = [];
  if (s.cost?.resId) {
    const r = resources.find((x) => x.id === s.cost.resId);
    if (r) parts.push(`${s.cost.amount || 1} ${r.name}`);
  }
  if (s.max) parts.push(`${s.max - (s.used || 0)}/${s.max} · ${rechargeText(s)}`);
  return parts.join(" · ");
}

function renderSkills() {
  $("empty").hidden = skills.length > 0;
  const sorted = sortSkills(skills);
  const groups = SKILL_ORDER.map((key) => [key, sorted.filter((s) => skillType(s.type).key === key)])
    .filter(([, list]) => list.length);
  $("skills").replaceChildren(
    ...groups.map(([key, list]) => {
      const g = document.createElement("div");
      g.className = "skill-group";
      const h = document.createElement("div");
      h.className = "group-label";
      h.textContent = GROUP_LABELS[key];
      const ul = document.createElement("ul");
      ul.className = "skill-list";
      ul.append(
        ...list.map((s) => {
          const t = skillType(s.type);
          const li = document.createElement("li");
          li.className = `skill t-${t.key}` + (s.spell ? " spell" : "") + (s.id === editingSkill ? " editing" : "");
          li.innerHTML = `
            <div class="skill-head">
              <span class="type-dot"></span>
              <b></b>
              <span class="meta"></span>
              <button class="ghost icon edit" title="Изменить">✎</button>
              <button class="ghost icon del" title="Удалить">🗑</button>
            </div>
            <div class="skill-desc"></div>`;
          li.querySelector("b").textContent = (s.spell ? "✦ " : "") + s.name;
          li.querySelector(".meta").textContent = costText(s);
          li.querySelector(".skill-desc").textContent = s.desc || "";
          li.querySelector(".edit").onclick = () => startEdit(s);
          li.querySelector(".del").onclick = () => {
            if (confirm(`Удалить навык «${s.name}»?`)) save({ [SKILLS_KEY]: skills.filter((x) => x.id !== s.id) });
          };
          return li;
        })
      );
      g.append(h, ul);
      return g;
    })
  );
}

$("reset-all").onclick = () => {
  if (!confirm("Восстановить все навыки и ресурсы этого персонажа?")) return;
  save({
    [SKILLS_KEY]: skills.map((x) => {
      const n = { ...x, used: 0 };
      delete n.done;
      return n;
    }),
    [RES_KEY]: resources.map((x) => ({ ...x, current: x.max })),
  });
};

// ---------- импорт / экспорт ----------

function showIO(mode) {
  $("io-panel").hidden = false;
  $("io-import-actions").hidden = mode !== "import";
  $("io-status").textContent = "";
  $("io-status").className = "io-status";
}
function ioStatus(text, kind) {
  $("io-status").textContent = text;
  $("io-status").className = `io-status ${kind}`;
}
$("io-import").onclick = () => {
  showIO("import");
  $("io-text").value = "";
  $("io-text").readOnly = false;
  $("io-text").focus();
};
$("io-export").onclick = async () => {
  showIO("export");
  const text = exportData(resources, skills);
  $("io-text").value = text;
  $("io-text").readOnly = true;
  $("io-text").select();
  try {
    await navigator.clipboard.writeText(text);
    ioStatus("Скопировано в буфер обмена.", "ok");
  } catch {
    ioStatus("Текст выделен — нажмите Ctrl+C.", "ok");
  }
};
$("io-close").onclick = () => ($("io-panel").hidden = true);
function doImport(mode) {
  let parsed;
  try {
    parsed = parseImport($("io-text").value);
  } catch (e) {
    return ioStatus(e.message, "err");
  }
  if (mode === "replace" && (skills.length || resources.length) &&
      !confirm("Удалить текущие навыки и ресурсы персонажа и загрузить новые?")) return;
  const result = applyImport(parsed, { resources, skills }, mode);
  save({ [RES_KEY]: result.resources, [SKILLS_KEY]: result.skills });
  const head = `Загружено: навыков ${parsed.skills.length}, ресурсов ${parsed.resources.length}.`;
  ioStatus(result.warnings.length ? `${head}\nЗамечания:\n• ${result.warnings.join("\n• ")}` : head,
    result.warnings.length ? "warn" : "ok");
  $("io-text").value = "";
}
$("io-merge").onclick = () => doImport("merge");
$("io-replace").onclick = () => doImport("replace");

$("close").onclick = () => OBR.popover.close(SKILLS_POPOVER);

// ---------- данные токена ----------

function onItems(items) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return OBR.popover.close(SKILLS_POPOVER);
  $("char-name").textContent = item.text?.plainText || item.name || "";
  skills = item.metadata[SKILLS_KEY] || [];
  resources = item.metadata[RES_KEY] || [];
  st = item.metadata[STATS_KEY] || {};
  renderStats();
  renderResources();
  renderSkills();
}

OBR.onReady(async () => {
  resetForm();
  resetResForm();
  onItems(await OBR.scene.items.getItems([itemId]));
  OBR.scene.items.onChange(onItems);
});
