import { ITEM_KEY, SKILLS_KEY, RES_KEY, STATS_KEY, skillType, rollRange } from "./constants.js";

// Навык без зарядов, ресурса и действия (обычная пассивка) — просто справка, не нажимается
export function isClickable(skill) {
  const t = skillType(skill.type);
  return !!(t.pip || t.key === "free" || skill.max || skill.cost?.resId);
}

// Почему навык нельзя применить сейчас (null — можно)
export function blockReason(skill, combat, resources) {
  if (skill.max && (skill.used || 0) >= skill.max) return "заряды закончились";
  if (!skill.max && skill.done) return "уже использовано в этом раунде";
  const t = skillType(skill.type);
  if (t.pip && combat && combat[t.pip] === false) return `${t.label.toLowerCase()} уже потрачено`;
  if (skill.cost?.resId) {
    const r = resources.find((x) => x.id === skill.cost.resId);
    if (r && r.current < (skill.cost.amount || 1)) return `не хватает ресурса «${r.name}»`;
  }
  return null;
}

// Применить (direction = 1) или отменить (-1) навык: Д/Б/Р, ресурс, заряд — одной записью
export function applySkill(draft, skillId, direction = 1, round = 0) {
  const skills = draft.metadata[SKILLS_KEY] || [];
  const skill = skills.find((s) => s.id === skillId);
  if (!skill) return;
  const combat = draft.metadata[ITEM_KEY];
  const resources = draft.metadata[RES_KEY] || [];

  if (direction > 0 && blockReason(skill, combat, resources)) return;

  const t = skillType(skill.type);
  if (t.pip && combat) combat[t.pip] = direction < 0; // при отмене — вернуть

  if (skill.cost?.resId) {
    const amount = skill.cost.amount || 1;
    draft.metadata[RES_KEY] = resources.map((r) =>
      r.id !== skill.cost.resId
        ? r
        : {
            ...r,
            current: Math.max(0, Math.min(r.max, r.current - amount * direction)),
            ...(direction > 0 ? { spentRound: round } : {}),
          }
    );
  }

  draft.metadata[SKILLS_KEY] = skills.map((s) => {
    if (s.id !== skillId) return s;
    const next = { ...s };
    if (s.max) next.used = Math.max(0, Math.min(s.max, (s.used || 0) + direction));
    else next.done = direction > 0; // без зарядов: отметка «использовано в этом раунде»
    if (direction > 0) next.usedRound = round;
    return next;
  });
}

// Восстановить навыки и ресурсы с указанными типами перезарядки
export function recharge(draft, types) {
  const skills = draft.metadata[SKILLS_KEY];
  if (skills) {
    draft.metadata[SKILLS_KEY] = skills.map((s) => {
      const next = types.includes(s.recharge) ? { ...s, used: 0 } : { ...s };
      if (types.includes("round")) delete next.done; // отметки «в этом раунде» снимаются каждый раунд
      return next;
    });
  }
  const res = draft.metadata[RES_KEY];
  if (res) {
    draft.metadata[RES_KEY] = res.map((r) => (types.includes(r.recharge) ? { ...r, current: r.max } : r));
  }
}

// Начало нового раунда: «каждый раунд» и «через раунд» (использовано в раунде N → снова доступно с N+2)
export function tickRound(draft, round) {
  recharge(draft, ["round"]);
  const ready = (x) => round - (x ?? -99) >= 2;
  const skills = draft.metadata[SKILLS_KEY];
  if (skills) {
    draft.metadata[SKILLS_KEY] = skills.map((s) =>
      s.recharge === "round2" && s.used && ready(s.usedRound) ? { ...s, used: 0 } : s
    );
  }
  const res = draft.metadata[RES_KEY];
  if (res) {
    draft.metadata[RES_KEY] = res.map((r) =>
      r.recharge === "round2" && r.current < r.max && ready(r.spentRound) ? { ...r, current: r.max } : r
    );
  }
}

// Начало хода существа: броски перезарядки («Перезарядка 5–6»). Возвращает результаты бросков.
export function rollRecharges(draft, rng = Math.random) {
  const results = [];
  const skills = draft.metadata[SKILLS_KEY];
  if (!skills) return results;
  draft.metadata[SKILLS_KEY] = skills.map((s) => {
    if (s.recharge !== "roll" || !s.used) return s;
    const die = s.rollDie || 6;
    const min = Math.min(s.rollMin || die, die);
    const roll = 1 + Math.floor(rng() * die);
    const ok = roll >= min;
    results.push({ name: s.name, roll, die, range: rollRange(s), ok });
    return ok ? { ...s, used: 0 } : s;
  });
  return results;
}

// ---------- хиты ----------

// Урон сначала снимает временные хиты, потом обычные
export function applyHp(draft, kind, amount) {
  const st = { ...(draft.metadata[STATS_KEY] || {}) };
  const max = st.hpMax ?? null;
  let hp = st.hp ?? max ?? 0;
  let temp = st.hpTemp || 0;
  amount = Math.max(0, Math.floor(amount) || 0);
  if (kind === "damage") {
    const fromTemp = Math.min(temp, amount);
    temp -= fromTemp;
    hp = Math.max(0, hp - (amount - fromTemp));
  } else if (kind === "heal") {
    hp = max === null ? hp + amount : Math.min(max, hp + amount);
  } else if (kind === "temp") {
    temp = Math.max(temp, amount); // временные хиты не складываются
  }
  st.hp = hp;
  st.hpTemp = temp;
  draft.metadata[STATS_KEY] = st;
}
