/** Parse amount with Russian suffixes: к тыс кк млн млрд */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".");
  const map: [string, number][] = [
    ["млрд", 1_000_000_000],
    ["млн",  1_000_000],
    ["тыс",  1_000],
    ["кк",   1_000_000],
    ["к",    1_000],
  ];
  for (const [suf, mul] of map) {
    if (s.endsWith(suf)) {
      const n = parseFloat(s.slice(0, -suf.length));
      if (isNaN(n) || n <= 0) return null;
      return Math.floor(n * mul);
    }
  }
  const n = parseInt(s, 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

/** Format number with Russian thousands separator */
export function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

/** Format milliseconds as "X ч. Y мин. Z сек." */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h} ч. ${m} мин. ${sec} сек.`;
}

/** Fisher-Yates shuffle (in-place) */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function displayName(u: {
  first_name?: string;
  last_name?: string;
  username?: string;
  id: number;
}): string {
  return (
    [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
    u.username ||
    String(u.id)
  );
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Sleep helper */
/** Sleep helper */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function addBalance(userId: number, amount: number) {
  const { pool } = await import("./db.js");
  await pool.query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [amount, userId]);
}