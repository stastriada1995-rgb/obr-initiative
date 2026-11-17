import { uid } from "./constants.js";

export const FORMAT = "obr-initiative-skills";

const TYPES = {
  action: "action", "действие": "action",
  bonus: "bonus", "бонусное": "bonus", "бонусное действие": "bonus",
  reaction: "reaction", "реакция": "reaction",
  free: "free", "свободное": "free", "свободное действие": "free",
  passive: "passive", "пассивка": "passive", "пассивный": "passive",
};
const RECHARGES = {
  round: "round", "раунд": "round", "каждый раунд": "round",
  round2: "round2", "через раунд": "round2",
  roll: "roll", "бросок": "roll", "бросок кубика": "roll",
  short: "short", "короткий отдых": "short",
  long: "long", "длинный отдых": "long",
  manual: "manual", "вручную": "manual",
};

const norm = (s) => String(s ?? "").trim().toLowerCase();
const posInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Разобрать текст из нейросети. Терпим к ```json-обёрткам и тексту вокруг.
export function parseImport(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Не найден JSON-объект { … }.");
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON не читается: ${e.message}`);
  }
  if (!data || typeof data !== "object") throw new Error("Ожидался объект.");

  const warnings = [];
  const resources = [];
  for (const [i, r] of (Array.isArray(data.resources) ? data.resources : []).entries()) {
    const name = String(r?.name ?? "").trim().slice(0, 40);
    if (!name) { warnings.push(`Ресурс №${i + 1} без названия — пропущен.`); continue; }
    const max = posInt(r.max);
    if (!max) { warnings.push(`Ресурс «${name}»: max не число — поставлено 1.`); }
    resources.push({
      name,
      max: max || 1,
      recharge: (RECHARGES[norm(r.recharge)] === "roll" ? "long" : RECHARGES[norm(r.recharge)]) || "long",
      show: r.show === true || norm(r.show) === "true",
    });
  }

  const skills = [];
  for (const [i, s] of (Array.isArray(data.skills) ? data.skills : []).entries()) {
    const name = String(s?.name ?? "").trim().slice(0, 60);
    if (!name) { warnings.push(`Навык №${i + 1} без названия — пропущен.`); continue; }
    const type = TYPES[norm(s.type)];
    if (!type) warnings.push(`«${name}»: тип «${s.type}» не распознан — стал пассивкой.`);
    let cost = null;
    if (s.cost && (s.cost.resource || s.cost.name)) {
      cost = { resource: String(s.cost.resource || s.cost.name).trim(), amount: posInt(s.cost.amount) || 1 };
    }
    skills.push({
      name,
      desc: String(s.desc ?? s.description ?? "").trim(),
      type: type || "passive",
      cost,
      max: posInt(s.charges ?? s.max),
      recharge: RECHARGES[norm(s.recharge)] || "long",
      spell: s.spell === true,
      rollDie: posInt(s.rollDie),
      rollMin: posInt(s.rollMin),
    });
  }

  if (!resources.length && !skills.length) throw new Error("В JSON нет ни навыков, ни ресурсов.");
  return { resources, skills, warnings };
}

// Совместить с текущими данными токена. mode: "merge" | "replace"
export function applyImport(parsed, current, mode) {
  const warnings = [...parsed.warnings];
  const baseRes = mode === "replace" ? [] : current.resources.map((r) => ({ ...r }));
  const baseSkills = mode === "replace" ? [] : current.skills.map((s) => ({ ...s }));

  for (const r of parsed.resources) {
    const ex = baseRes.find((x) => norm(x.name) === norm(r.name));
    if (ex) Object.assign(ex, r, { current: Math.min(ex.current, r.max) });
    else baseRes.push({ id: uid(), current: r.max, ...r });
  }

  for (const s of parsed.skills) {
    let cost = null;
    if (s.cost) {
      const res = baseRes.find((x) => norm(x.name) === norm(s.cost.resource));
      if (res) cost = { resId: res.id, amount: s.cost.amount };
      else warnings.push(`«${s.name}»: ресурс «${s.cost.resource}» не найден — стоимость убрана.`);
    }
    const data = { name: s.name, desc: s.desc, type: s.type, cost, max: s.max, recharge: s.recharge, spell: s.spell };
    if (s.recharge === "roll") { data.rollDie = s.rollDie || 6; data.rollMin = s.rollMin || data.rollDie; data.max ||= 1; }
    const ex = baseSkills.find((x) => norm(x.name) === norm(s.name));
    if (ex) Object.assign(ex, data, { used: Math.min(ex.used || 0, s.max || 0) });
    else baseSkills.push({ id: uid(), used: 0, ...data });
  }

  return { resources: baseRes, skills: baseSkills, warnings };
}

export function exportData(resources, skills) {
  const byId = new Map(resources.map((r) => [r.id, r.name]));
  return JSON.stringify(
    {
      format: FORMAT,
      version: 1,
      resources: resources.map((r) => ({ name: r.name, max: r.max, recharge: r.recharge, show: !!r.show })),
      skills: skills.map((s) => ({
        name: s.name,
        desc: s.desc || "",
        type: s.type || "passive",
        cost: s.cost?.resId && byId.has(s.cost.resId)
          ? { resource: byId.get(s.cost.resId), amount: s.cost.amount || 1 }
          : null,
        charges: s.max || null,
        recharge: s.recharge || "long",
        ...(s.spell ? { spell: true } : {}),
        ...(s.recharge === "roll" ? { rollDie: s.rollDie || 6, rollMin: s.rollMin || 6 } : {}),
      })),
    },
    null,
    2
  );
}
