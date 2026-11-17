// Уникальный префикс расширения — используется как ключ в metadata
export const ID = "com.stastriada.initiative";
export const ITEM_KEY = `${ID}/item`; // участие в бою: инициатива, Д/Б/Р, состояния
export const SKILLS_KEY = `${ID}/skills`; // навыки персонажа (живут на токене всегда)
export const SCENE_KEY = `${ID}/scene`; // раунд и текущий ход в сцене
export const HISTORY_KEY = `${ID}/history`; // снимки для кнопки «Назад»
export const STATS_KEY = `${ID}/stats`; // КД, хиты, бонус инициативы, защиты (на токене)
export const SKILLS_POPOVER = `${ID}/skills-popover`;

// Пути к файлам расширения с учётом подпапки GitHub Pages ("/obr-initiative/…")
export const asset = (path) => import.meta.env.BASE_URL + path;

// Ресурсы, которые восстанавливаются в начале каждого раунда
export const RESOURCES = [
  { key: "action", label: "Действие", short: "Д" },
  { key: "bonus", label: "Бонусное действие", short: "Б" },
  { key: "reaction", label: "Реакция", short: "Р" },
];

export function freshResources() {
  return { action: true, bonus: true, reaction: true }; // true = доступно
}

// Состояния D&D 5e
export const CONDITIONS = [
  { key: "blinded", name: "Ослеплён", icon: "🙈", desc: "Автопровал проверок, требующих зрения. Атаки по существу с преимуществом, его атаки — с помехой." },
  { key: "charmed", name: "Очарован", icon: "💖", desc: "Не может атаковать очаровавшего. Очаровавший совершает с преимуществом проверки социального взаимодействия." },
  { key: "deafened", name: "Оглох", icon: "🔇", desc: "Ничего не слышит, автопровал проверок, требующих слуха." },
  { key: "frightened", name: "Испуган", icon: "😱", desc: "Помеха к проверкам и атакам, пока источник страха в поле зрения. Не может добровольно приблизиться к источнику." },
  { key: "grappled", name: "Схвачен", icon: "🤼", desc: "Скорость 0, не получает бонусов к скорости." },
  { key: "incapacitated", name: "Недееспособен", icon: "💫", desc: "Не может совершать действия и реакции." },
  { key: "invisible", name: "Невидим", icon: "👻", desc: "Атаки по существу с помехой, его атаки — с преимуществом." },
  { key: "paralyzed", name: "Парализован", icon: "⚡", desc: "Недееспособен, не двигается и не говорит. Автопровал спасбросков Сил и Лов. Атаки с преимуществом, вблизи — критические." },
  { key: "petrified", name: "Окаменел", icon: "🗿", desc: "Превращён в камень, недееспособен, сопротивление всем видам урона, иммунитет к ядам и болезням." },
  { key: "poisoned", name: "Отравлен", icon: "🤢", desc: "Помеха к броскам атаки и проверкам характеристик." },
  { key: "prone", name: "Сбит с ног", icon: "🛌", desc: "Ползёт или встаёт за половину скорости. Его атаки с помехой. Атаки вблизи по нему с преимуществом, издалека — с помехой." },
  { key: "restrained", name: "Опутан", icon: "🕸️", desc: "Скорость 0. Его атаки и спасброски Лов с помехой, атаки по нему с преимуществом." },
  { key: "stunned", name: "Ошеломлён", icon: "🌀", desc: "Недееспособен, двигается и говорит с трудом. Автопровал спасбросков Сил и Лов, атаки по нему с преимуществом." },
  { key: "unconscious", name: "Без сознания", icon: "💤", desc: "Недееспособен, падает ничком, роняет вещи. Атаки с преимуществом, вблизи — критические." },
  { key: "exhaustion", name: "Истощение", icon: "🥵", desc: "Уровни 1–6: помеха к проверкам, скорость /2, помеха к атакам и спасброскам, максимум хитов /2, скорость 0, смерть.", leveled: true },
  { key: "concentration", name: "Концентрация", icon: "🧠", desc: "Поддерживает заклинание. При уроне — спасбросок Тел (Сл 10 или половина урона)." },
];

export const conditionByKey = (key) => CONDITIONS.find((c) => c.key === key);

export const RES_KEY = `${ID}/resources`; // ресурсы персонажа (Ки, ячейки, ярость…)

// Тип навыка: какую часть экономики действий он тратит
export const SKILL_TYPES = [
  { key: "action", label: "Действие", pip: "action" },
  { key: "bonus", label: "Бонусное действие", pip: "bonus" },
  { key: "reaction", label: "Реакция", pip: "reaction" },
  { key: "free", label: "Свободное действие", pip: null }, // без кружка в трекере
  { key: "passive", label: "Пассивка", pip: null },
];
export const skillType = (key) =>
  SKILL_TYPES.find((t) => t.key === key) ||
  SKILL_TYPES.find((t) => t.key === "passive"); // старые навыки без типа — пассивка

// Порядок групп в трекере и редакторе: защиты → ресурсы → пассивки → реакции →
// свободные → действия/заклинания → бонусные
export const SKILL_ORDER = ["passive", "reaction", "free", "action", "bonus"];
export function sortSkills(list) {
  return list
    .map((s, i) => [s, i])
    .sort(([a, ia], [b, ib]) =>
      SKILL_ORDER.indexOf(skillType(a.type).key) - SKILL_ORDER.indexOf(skillType(b.type).key) || ia - ib)
    .map(([s]) => s);
}

// Перезарядка навыков и ресурсов
export const RECHARGE = [
  { key: "round", label: "Каждый раунд" },
  { key: "round2", label: "Через раунд" },
  { key: "roll", label: "Бросок кубика", skillOnly: true },
  { key: "short", label: "Короткий отдых" },
  { key: "long", label: "Длинный отдых" },
  { key: "manual", label: "Вручную" },
];
export const DICE = [4, 6, 8, 10, 12, 20];
export function rechargeText(item) {
  if (item.recharge === "roll") return `Перезарядка к${item.rollDie || 6}: ${rollRange(item)}`;
  return RECHARGE.find((r) => r.key === item.recharge)?.label ?? "";
}
export function rollRange(item) {
  const die = item.rollDie || 6, min = Math.min(item.rollMin || die, die);
  return min === die ? `${die}` : `${min}–${die}`;
}

// Защиты: поля статблока
export const DEFENSES = [
  { key: "vuln", label: "Уязвимость к урону", short: "Уязв." },
  { key: "resDmg", label: "Сопротивление урону", short: "Сопр." },
  { key: "resCond", label: "Сопротивление состояниям", short: "Сопр. сост." },
  { key: "immDmg", label: "Иммунитет к урону", short: "Иммун." },
  { key: "immCond", label: "Иммунитет к состояниям", short: "Иммун. сост." },
];

export const stats = (item) => item.metadata[STATS_KEY] || {};
export const num = (v) => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v));

export const uid = () => Math.random().toString(36).slice(2, 10);
