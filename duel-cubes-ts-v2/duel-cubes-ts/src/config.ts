export const config = {
  BOT_TOKEN: process.env.BOT_TOKEN ?? (() => { throw new Error("BOT_TOKEN is not set"); })(),
  DATABASE_URL: process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is not set"); })(),
  PORT: parseInt(process.env.PORT ?? "8080", 10),

  DEV_ID: 5103088337,
  CREATOR_IDS: [2053035323, 5103088337] as number[],

  HIGH_BET_THRESHOLD: 500_000,
  HIGH_BET_RATIO: 0.5,

  WORK_MIN_HOURLY: 18_000,
  WORK_MAX_HOURLY: 24_000,
  WORK_MAX_HOURS: 24,
  WORK_MIN_COOLDOWN_HOURS: 2,

  TRANSFER_FEE_PERCENT: 5,
  DIVORCE_ALIMONY_PERCENT: 10,

  CAPTCHA_TIMEOUT_SECONDS: 90,
  CAPTCHA_MAX_ATTEMPTS: 3,

  QUIZ_INTERVAL_MS: 30 * 60 * 1000,

  // Business accumulation
  BUSINESS_MIN_COLLECT_HOURS: 6,
  BUSINESS_MAX_ACCUM_HOURS: 48,

  // Game multipliers
  DICE_MULT: 1.9,
  DOUBLES_MULT: 3.0,
  SLOTS_JACKPOT_MULT: 35,
  SLOTS_TRIPLE_MULT: 10,
  SLOTS_LINE_MULT: 2.5,
  GUESS_MULT: 1.9,

  // Roulette
  ROULETTE_RED: new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]),

  // Ladder
  LADDER_STEPS: [1.3, 1.8, 2.5, 4.0, 7.5] as number[],
  LADDER_INACTIVITY_MS: 3 * 60 * 1000,

  // P2P timers
  DUEL_EXPIRY_MS: 120_000,
  KNB_EXPIRY_MS: 180_000,

  // Game lock window (ms) — prevents concurrent spam bets
  GAME_LOCK_MS: 4_000,

  // Banner image URLs
  WIN_IMG: "https://raw.githubusercontent.com/Molotof-def/Cubs/main/win.jpg",
  LOSE_IMG: "https://raw.githubusercontent.com/Molotof-def/Cubs/main/lose.jpg",
  DRAW_IMG: "https://raw.githubusercontent.com/Molotof-def/Cubs/main/draw.jpg",
} as const;
