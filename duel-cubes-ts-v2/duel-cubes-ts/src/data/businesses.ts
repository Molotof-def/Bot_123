export interface BusinessDef {
  key: string;
  name: string;
  emoji: string;
  cost: number;
  /** Hourly income = Math.round(cost / 120) — 5-day (120h) payback */
  hourlyIncome: number;
}

export const BUSINESSES: BusinessDef[] = [
  { key: "vending",     name: "Сеть вендинговых аппаратов",  emoji: "☕",  cost: 1_500_000,      hourlyIncome: 12_500 },
  { key: "kiosk",       name: "Круглосуточный павильон",      emoji: "🏪",  cost: 5_000_000,      hourlyIncome: 41_666 },
  { key: "pc_club",     name: "Киберспортивная арена",        emoji: "🖥",  cost: 18_000_000,     hourlyIncome: 150_000 },
  { key: "car_wash",    name: "Роботизированная автомойка",   emoji: "🚿",  cost: 50_000_000,     hourlyIncome: 416_666 },
  { key: "logistics",   name: "Логистический терминал",       emoji: "🚛",  cost: 140_000_000,    hourlyIncome: 1_166_666 },
  { key: "crypto_farm", name: "ASIC Дата-центр",              emoji: "⛏",  cost: 350_000_000,    hourlyIncome: 2_916_666 },
  { key: "factory",     name: "Нефтеперерабатывающий завод",  emoji: "🏭",  cost: 900_000_000,    hourlyIncome: 7_500_000 },
  { key: "casino",      name: "Неоновое казино в Вегасе",     emoji: "🎰",  cost: 2_500_000_000,  hourlyIncome: 20_833_333 },
  { key: "bank",        name: "Транснациональный банк",       emoji: "🏦",  cost: 7_000_000_000,  hourlyIncome: 58_333_333 },
  { key: "spaceport",   name: "Орбитальный космодром",        emoji: "🚀",  cost: 20_000_000_000, hourlyIncome: 166_666_666 },
];

export const BUSINESS_MAP = new Map<string, BusinessDef>(
  BUSINESSES.map((b) => [b.key, b])
);

/** Min hours before collection is allowed */
export const MIN_COLLECT_HOURS = 6;
/** Max accumulation cap in hours */
export const MAX_ACCUM_HOURS = 48;

/**
 * Calculate how much has accumulated since last_collect.
 * Capped at MAX_ACCUM_HOURS worth of income.
 */
export function calcAccumulated(biz: BusinessDef, lastCollect: Date): number {
  const hoursElapsed = Math.min(
    (Date.now() - lastCollect.getTime()) / 3_600_000,
    MAX_ACCUM_HOURS
  );
  return Math.round(biz.hourlyIncome * hoursElapsed);
}
