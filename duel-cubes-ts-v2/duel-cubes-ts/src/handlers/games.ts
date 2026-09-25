import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, deductBetAtomic, creditWin, recordLoss, refundBet, recordDraw, addBalance } from "../db.js";
import { config } from "../config.js";
import { parseAmount, fmt, shuffle, sleep, generateId } from "../utils.js";
import { acquireLock, releaseLock } from "../locks.js";
import { sendResult } from "../media.js";

// ── Roulette sector data ─────────────────────────────────────────────────────
const RED_NUMBERS = config.ROULETTE_RED;

function rouletteColor(n: number): string {
  if (n === 0) return "🟢";
  return RED_NUMBERS.has(n) ? "🔴" : "⚫️";
}

function replayKeyboard(bet: number, cmd: string): InlineKeyboard {
  return new InlineKeyboard().text(
    `🔄 Повторить (${fmt(bet)} 💎)`,
    `replay_${cmd}_${bet}`
  );
}

// ── High-bet confirmation ────────────────────────────────────────────────────
const pendingConfirm = new Map<
  string,
  { bet: number; cmd: string; extra?: string; expiresAt: number }
>();

async function checkConfirm(
  ctx: BotContext,
  bet: number,
  cmd: string,
  extra?: string
): Promise<boolean> {
  if (!ctx.from || !ctx.chat) return false;
  const user = await getUser(ctx.from.id);
  if (!user) return false;
  const needsConfirm =
    bet >= config.HIGH_BET_THRESHOLD || bet >= user.balance * config.HIGH_BET_RATIO;
  if (!needsConfirm) return true;

  const key = `${ctx.from.id}_${ctx.chat.id}`;
  pendingConfirm.set(key, { bet, cmd, extra, expiresAt: Date.now() + 30_000 });

  const pct = Math.round((bet / user.balance) * 100);
  const kb = new InlineKeyboard()
    .text(`✅ Да, ставлю ${fmt(bet)} 💎`, `confirm_${key}`)
    .text("❌ Отмена", `cancelbet_${key}`);

  await ctx.reply(
    `⚠️ <b>Подтверждение ставки</b>\n\n` +
    `Ставка: <b>${fmt(bet)} 💎</b> (${pct}% баланса)\n\nПодтверждаешь?`,
    { parse_mode: "HTML", reply_markup: kb }
  );
  return false;
}

// ── кубик (dice 1v1 vs bot, ×1.9) ───────────────────────────────────────────
async function execDice(ctx: BotContext, bet: number): Promise<void> {
  if (!ctx.from) return;
  if (!acquireLock(ctx.from.id)) {
    await ctx.reply("⏳ Подожди, предыдущая игра ещё обрабатывается.");
    return;
  }
  try {
    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ <b>Недостаточно средств!</b>", { parse_mode: "HTML" }); return; }

    const userMsg = await ctx.replyWithDice("🎲");
    await sleep(3600);
    const botMsg = await ctx.replyWithDice("🎲");
    await sleep(3600);

    const uRoll = userMsg.dice?.value ?? Math.ceil(Math.random() * 6);
    const bRoll = botMsg.dice?.value ?? Math.ceil(Math.random() * 6);

    if (uRoll > bRoll) {
      const payout = Math.round(bet * config.DICE_MULT);
      await creditWin(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption: `🎉 <b>Победа!</b>\n🎲 ${uRoll} vs ${bRoll}\n\n💰 +<b>${fmt(payout)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, "кубик").inline_keyboard.length
          ? replayKeyboard(bet, "кубик")
          : undefined,
      });
    } else if (uRoll < bRoll) {
      await recordLoss(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption: `😔 <b>Поражение!</b>\n🎲 ${uRoll} vs ${bRoll}\n\n❌ -<b>${fmt(bet)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, "кубик"),
      });
    } else {
      await refundBet(ctx.from.id, bet);
      await recordDraw(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.DRAW_IMG,
        caption: `🤝 <b>Ничья!</b> Оба: ${uRoll}\n\n🔄 Ставка возвращена`,
        replyMarkup: replayKeyboard(bet, "кубик"),
      });
    }
  } finally {
    releaseLock(ctx.from.id);
  }
}

// ── кубы (double dice, ×3.0 on doubles) ─────────────────────────────────────
async function execDoubles(ctx: BotContext, bet: number): Promise<void> {
  if (!ctx.from) return;
  if (!acquireLock(ctx.from.id)) { await ctx.reply("⏳ Подожди завершения предыдущей игры."); return; }
  try {
    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ <b>Недостаточно средств!</b>", { parse_mode: "HTML" }); return; }

    const m1 = await ctx.replyWithDice("🎲");
    await sleep(3600);
    const m2 = await ctx.replyWithDice("🎲");
    await sleep(3600);

    const r1 = m1.dice?.value ?? Math.ceil(Math.random() * 6);
    const r2 = m2.dice?.value ?? Math.ceil(Math.random() * 6);

    if (r1 === r2) {
      const payout = Math.round(bet * config.DOUBLES_MULT);
      await creditWin(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption: `🎉 <b>ДУБЛЬ ${r1}+${r2}!</b>\n\n💰 +<b>${fmt(payout)} 💎</b> (×${config.DOUBLES_MULT})`,
        replyMarkup: replayKeyboard(bet, "кубы"),
      });
    } else {
      await recordLoss(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption: `😔 <b>Не дубль.</b> ${r1} + ${r2}\n\n❌ -<b>${fmt(bet)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, "кубы"),
      });
    }
  } finally {
    releaseLock(ctx.from.id);
  }
}

// ── слоты ────────────────────────────────────────────────────────────────────
async function execSlots(ctx: BotContext, bet: number): Promise<void> {
  if (!ctx.from) return;
  if (!acquireLock(ctx.from.id)) { await ctx.reply("⏳ Подожди завершения предыдущей игры."); return; }
  try {
    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ <b>Недостаточно средств!</b>", { parse_mode: "HTML" }); return; }

    const msg = await ctx.replyWithDice("🎰");
    await sleep(3600);
    const val = msg.dice?.value ?? Math.ceil(Math.random() * 64);

    let mult = 0;
    let label = "";
    if (val === 64) { mult = config.SLOTS_JACKPOT_MULT; label = "🎰🎰🎰 ДЖЕКПОТ 777!"; }
    else if ([1, 22, 43].includes(val)) { mult = config.SLOTS_TRIPLE_MULT; label = "🎉 Три одинаковых!"; }
    else if (val % 11 === 0) { mult = config.SLOTS_LINE_MULT; label = "✨ Линия!"; }

    if (mult > 0) {
      const payout = Math.round(bet * mult);
      await creditWin(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption: `${label}\n\n💰 +<b>${fmt(payout)} 💎</b> (×${mult})`,
        replyMarkup: replayKeyboard(bet, "слоты"),
      });
    } else {
      await recordLoss(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption: `😔 <b>Не повезло!</b>\n\n❌ -<b>${fmt(bet)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, "слоты"),
      });
    }
  } finally {
    releaseLock(ctx.from.id);
  }
}

// ── больше / меньше / чётное / нечётное ──────────────────────────────────────
type GuessType = "больше" | "меньше" | "четное" | "нечетное";

async function execGuess(ctx: BotContext, bet: number, type: GuessType): Promise<void> {
  if (!ctx.from) return;
  if (!acquireLock(ctx.from.id)) { await ctx.reply("⏳ Подожди завершения предыдущей игры."); return; }
  try {
    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ <b>Недостаточно средств!</b>", { parse_mode: "HTML" }); return; }

    const msg = await ctx.replyWithDice("🎲");
    await sleep(3600);
    const roll = msg.dice?.value ?? Math.ceil(Math.random() * 6);

    const win =
      type === "больше" ? roll > 3 :
      type === "меньше" ? roll < 4 :
      type === "четное" ? roll % 2 === 0 :
      roll % 2 !== 0;

    if (win) {
      const payout = Math.round(bet * config.GUESS_MULT);
      await creditWin(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption: `🎉 <b>Победа!</b> Выпало: <b>${roll}</b>\n\n💰 +<b>${fmt(payout)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, type),
      });
    } else {
      await recordLoss(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption: `😔 <b>Поражение!</b> Выпало: <b>${roll}</b>\n\n❌ -<b>${fmt(bet)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, type),
      });
    }
  } finally {
    releaseLock(ctx.from.id);
  }
}

// ── Европейская рулетка 0–36 ─────────────────────────────────────────────────
type RouletteOutcome =
  | { type: "color"; value: "red" | "black" }
  | { type: "parity"; value: "even" | "odd" }
  | { type: "half"; value: "1-18" | "19-36" }
  | { type: "dozen"; value: "1-12" | "13-24" | "25-36" }
  | { type: "number"; value: number };

function parseRouletteOutcome(raw: string): RouletteOutcome | null {
  const s = raw.trim().toLowerCase();
  if (["кр", "красное", "красный"].includes(s)) return { type: "color", value: "red" };
  if (["чер", "черное", "чёрное", "черный", "чёрный"].includes(s)) return { type: "color", value: "black" };
  if (["чет", "чётное", "четное"].includes(s)) return { type: "parity", value: "even" };
  if (["нечет", "нечётное", "нечетное"].includes(s)) return { type: "parity", value: "odd" };
  if (s === "1-18") return { type: "half", value: "1-18" };
  if (s === "19-36") return { type: "half", value: "19-36" };
  if (s === "1-12") return { type: "dozen", value: "1-12" };
  if (s === "13-24") return { type: "dozen", value: "13-24" };
  if (s === "25-36") return { type: "dozen", value: "25-36" };
  // Explicit number check — handle 0 correctly (avoids JS falsy trap)
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0 && n <= 36) return { type: "number", value: n };
  return null;
}

function outcomeWins(result: number, outcome: RouletteOutcome): boolean {
  switch (outcome.type) {
    case "color":
      if (result === 0) return false;
      return outcome.value === "red"
        ? RED_NUMBERS.has(result)
        : !RED_NUMBERS.has(result);
    case "parity":
      if (result === 0) return false;
      return outcome.value === "even" ? result % 2 === 0 : result % 2 !== 0;
    case "half":
      if (result === 0) return false;
      return outcome.value === "1-18" ? result <= 18 : result >= 19;
    case "dozen":
      if (result === 0) return false;
      if (outcome.value === "1-12") return result >= 1 && result <= 12;
      if (outcome.value === "13-24") return result >= 13 && result <= 24;
      return result >= 25 && result <= 36;
    case "number":
      return result === outcome.value;
  }
}

function outcomeMult(outcome: RouletteOutcome): number {
  switch (outcome.type) {
    case "color": return 2;
    case "parity": return 2;
    case "half": return 2;
    case "dozen": return 3;
    case "number": return 36;
  }
}

function outcomeLabel(outcome: RouletteOutcome): string {
  switch (outcome.type) {
    case "color": return outcome.value === "red" ? "🔴 Красное" : "⚫️ Чёрное";
    case "parity": return outcome.value === "even" ? "Чётное" : "Нечётное";
    case "half": return outcome.value;
    case "dozen": return outcome.value;
    case "number": return `Число ${outcome.value}`;
  }
}

async function execRoulette(
  ctx: BotContext,
  outcome: RouletteOutcome,
  bet: number
): Promise<void> {
  if (!ctx.from) return;
  if (!acquireLock(ctx.from.id)) { await ctx.reply("⏳ Подожди завершения предыдущей игры."); return; }
  try {
    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ <b>Недостаточно средств!</b>", { parse_mode: "HTML" }); return; }

    await ctx.reply("🎡 <b>Колесо крутится...</b>", { parse_mode: "HTML" });
    await sleep(2500);

    const result = Math.floor(Math.random() * 37); // 0–36
    const color = rouletteColor(result);
    const mult = outcomeMult(outcome);
    const wins = outcomeWins(result, outcome);

    const resultLine = `${color} <b>${result}</b>`;
    const betLine = `Ставка: <b>${outcomeLabel(outcome)}</b> — ${fmt(bet)} 💎`;

    if (wins) {
      const payout = Math.round(bet * mult);
      await creditWin(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption:
          `🎡 <b>РУЛЕТКА</b>\n\n${resultLine}\n${betLine}\n\n` +
          `🎉 <b>Победа!</b> ×${mult}\n💰 +<b>${fmt(payout)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, `рулетка_${outcomeLabel(outcome).replace(/\s/g, "_")}`),
      });
    } else {
      await recordLoss(ctx.from.id);
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption:
          `🎡 <b>РУЛЕТКА</b>\n\n${resultLine}\n${betLine}\n\n` +
          `😔 <b>Поражение!</b>\n❌ -<b>${fmt(bet)} 💎</b>`,
        replyMarkup: replayKeyboard(bet, `рулетка_${outcomeLabel(outcome).replace(/\s/g, "_")}`),
      });
    }
  } finally {
    releaseLock(ctx.from.id);
  }
}

// ── Лесенка ──────────────────────────────────────────────────────────────────
async function sendLadder(ctx: BotContext, bet: number, step: number): Promise<void> {
  const steps = config.LADDER_STEPS;
  const mult = step > 0 ? steps[step - 1] : 1;
  const current = step > 0 ? Math.round(bet * mult) : 0;
  const nextMult = step < steps.length ? steps[step] : null;

  const rows = steps.map((m, i) => {
    const p = Math.round(bet * m);
    const mark = i < step ? "✅" : i === step ? "👉" : "⬜";
    return `${mark} Шаг ${i + 1}: ×${m} = ${fmt(p)} 💎`;
  }).join("\n");

  const kb = new InlineKeyboard();
  if (nextMult !== null) {
    kb.text(`🎲 Вперёд (×${nextMult})`, "ladder_next");
  }
  if (step > 0) {
    kb.text(`💰 Забрать ${fmt(current)} 💎`, "ladder_cashout");
  } else {
    kb.text("❌ Отмена", "ladder_cashout");
  }

  await ctx.reply(
    `🪜 <b>ЛЕСЕНКА</b>\n\nСтавка: <b>${fmt(bet)} 💎</b>\n\n${rows}` +
    (step > 0 ? `\n\nТекущий выигрыш: <b>${fmt(current)} 💎</b>` : ""),
    { parse_mode: "HTML", reply_markup: kb }
  );
}

// ── Main registration ─────────────────────────────────────────────────────────
export function registerGameHandlers(bot: Bot<BotContext>): void {
  // кубик [ставка]
  bot.hears(/^кубик (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>кубик 5000</code>", { parse_mode: "HTML" }); return; }
    if (!await checkConfirm(ctx, bet, "кубик")) return;
    await execDice(ctx, bet);
  });

  // кубы [ставка]
  bot.hears(/^кубы (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>кубы 5000</code>", { parse_mode: "HTML" }); return; }
    if (!await checkConfirm(ctx, bet, "кубы")) return;
    await execDoubles(ctx, bet);
  });

  // слоты [ставка]
  bot.hears(/^слоты (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>слоты 5000</code>", { parse_mode: "HTML" }); return; }
    await execSlots(ctx, bet);
  });

  // больше / меньше / чётное / нечётное [ставка]
  bot.hears(/^больше (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>больше 5000</code>", { parse_mode: "HTML" }); return; }
    await execGuess(ctx, bet, "больше");
  });
  bot.hears(/^меньше (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>меньше 5000</code>", { parse_mode: "HTML" }); return; }
    await execGuess(ctx, bet, "меньше");
  });
  bot.hears(/^чет[её]?н?о?е? (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>чётное 5000</code>", { parse_mode: "HTML" }); return; }
    await execGuess(ctx, bet, "четное");
  });
  bot.hears(/^нечет[её]?н?о?е? (.+)$/i, async (ctx) => {
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>нечётное 5000</code>", { parse_mode: "HTML" }); return; }
    await execGuess(ctx, bet, "нечетное");
  });

  // рулетка / рул / roulette [исход] [ставка]
  bot.hears(/^(?:рулетка|рул|roulette) (.+)$/i, async (ctx) => {
    const parts = ctx.match[1].trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "❌ Пример: <code>рулетка красное 5000</code>\n" +
        "Варианты: <b>красное, чёрное, чётное, нечётное, 1-18, 19-36, 1-12, 13-24, 25-36, 0–36</b>",
        { parse_mode: "HTML" }
      );
      return;
    }
    const betStr = parts[parts.length - 1];
    const outcomeStr = parts.slice(0, -1).join(" ");
    const bet = parseAmount(betStr);
    if (!bet) { await ctx.reply("❌ Неверная ставка.", { parse_mode: "HTML" }); return; }
    const outcome = parseRouletteOutcome(outcomeStr);
    if (!outcome) {
      await ctx.reply("❌ Неверный исход. Варианты: красное, чёрное, чётное, нечётное, 1-18, 19-36, 1-12, 13-24, 25-36, 0–36", { parse_mode: "HTML" });
      return;
    }
    if (!await checkConfirm(ctx, bet, "рулетка")) return;
    await execRoulette(ctx, outcome, bet);
  });

  // лесенка [ставка]
  bot.hears(/^лесенка (.+)$/i, async (ctx) => {
    if (!ctx.from) return;
    if (ctx.session.ladderStep !== null) {
      await ctx.reply("⚠️ У тебя уже активна лесенка! Сначала забери выигрыш.");
      return;
    }
    const bet = parseAmount(ctx.match[1]);
    if (!bet) { await ctx.reply("❌ Пример: <code>лесенка 5000</code>", { parse_mode: "HTML" }); return; }
    const user = await getUser(ctx.from.id);
    if (!user || user.balance < bet) { await ctx.reply("❌ Недостаточно средств!"); return; }

    const ok = await deductBetAtomic(ctx.from.id, bet);
    if (!ok) { await ctx.reply("❌ Недостаточно средств!"); return; }

    ctx.session.ladderBet = bet;
    ctx.session.ladderStep = 0;
    ctx.session.ladderLastActivity = Date.now();
    await sendLadder(ctx, bet, 0);
  });

  // Ladder next step
  bot.callbackQuery("ladder_next", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    if (ctx.session.ladderStep === null || ctx.session.ladderBet === null) {
      await ctx.editMessageText("⏱️ Лесенка истекла."); return;
    }
    const inactiveMs = Date.now() - (ctx.session.ladderLastActivity ?? 0);
    if (inactiveMs > config.LADDER_INACTIVITY_MS) {
      const step = ctx.session.ladderStep;
      const bet = ctx.session.ladderBet;
      const payout = step > 0 ? Math.round(bet * config.LADDER_STEPS[step - 1]) : 0;
      ctx.session.ladderStep = null; ctx.session.ladderBet = null; ctx.session.ladderLastActivity = null;
      if (payout > 0) {
        await addBalance(ctx.from.id, payout);
        await ctx.editMessageText(
          `⏱️ <b>Автовыплата!</b> Прошло 3 мин.\n💰 Забрано: <b>${fmt(payout)} 💎</b>`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.editMessageText("⏱️ Лесенка истекла. Ставка потеряна.");
      }
      return;
    }
    ctx.session.ladderLastActivity = Date.now();
    const step = ctx.session.ladderStep;
    const bet = ctx.session.ladderBet;
    if (Math.random() < 0.5) {
      ctx.session.ladderStep! += 1;
      const newStep = ctx.session.ladderStep!;
      if (newStep >= config.LADDER_STEPS.length) {
        const payout = Math.round(bet * config.LADDER_STEPS[config.LADDER_STEPS.length - 1]);
        await addBalance(ctx.from.id, payout);
        ctx.session.ladderStep = null; ctx.session.ladderBet = null; ctx.session.ladderLastActivity = null;
        await ctx.editMessageText(
          `🏆 <b>МАКСИМУМ!</b>\n💰 +<b>${fmt(payout)} 💎</b>`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.editMessageText(
          `✅ Шаг ${newStep} пройден!`,
          { parse_mode: "HTML" }
        );
        await sendLadder(ctx, bet, newStep);
      }
    } else {
      ctx.session.ladderStep = null; ctx.session.ladderBet = null; ctx.session.ladderLastActivity = null;
      await sendResult(ctx, {
        imageUrl: config.LOSE_IMG,
        caption: `💥 <b>Упал на шаге ${step + 1}!</b>\n\n❌ Ставка потеряна.`,
      });
    }
  });

  // Ladder cashout
  bot.callbackQuery("ladder_cashout", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    if (ctx.session.ladderStep === null || ctx.session.ladderBet === null) {
      await ctx.editMessageText("⏱️ Лесенка уже завершена."); return;
    }
    const step = ctx.session.ladderStep;
    const bet = ctx.session.ladderBet;
    const payout = step > 0 ? Math.round(bet * config.LADDER_STEPS[step - 1]) : 0;
    ctx.session.ladderStep = null; ctx.session.ladderBet = null; ctx.session.ladderLastActivity = null;
    if (payout > 0) {
      await addBalance(ctx.from.id, payout);
      await sendResult(ctx, {
        imageUrl: config.WIN_IMG,
        caption: `💰 <b>Забрал!</b>\n+<b>${fmt(payout)} 💎</b> (×${config.LADDER_STEPS[step - 1]})`,
      });
    } else {
      await refundBet(ctx.from.id, bet);
      await ctx.editMessageText("🔄 Ставка возвращена.");
    }
  });

  // High-bet confirmation callbacks
  bot.callbackQuery(/^confirm_(\d+_-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    const key = `${ctx.from.id}_${ctx.chat.id}`;
    const p = pendingConfirm.get(key);
    if (!p || Date.now() > p.expiresAt) { await ctx.editMessageText("⏱️ Истекло."); return; }
    pendingConfirm.delete(key);
    await ctx.deleteMessage().catch(() => {});
    if (p.cmd === "кубик") await execDice(ctx, p.bet);
    else if (p.cmd === "кубы") await execDoubles(ctx, p.bet);
    else if (p.cmd === "рулетка" && p.extra) {
      const outcome = parseRouletteOutcome(p.extra);
      if (outcome) await execRoulette(ctx, outcome, p.bet);
    }
  });

  bot.callbackQuery(/^cancelbet_/, async (ctx) => {
    await ctx.answerCallbackQuery("Отменено.");
    if (!ctx.from || !ctx.chat) return;
    pendingConfirm.delete(`${ctx.from.id}_${ctx.chat.id}`);
    await ctx.editMessageText("❌ Ставка отменена.");
  });

  // Replay callbacks
  bot.callbackQuery(/^replay_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const cmd = ctx.match[1];
    const bet = parseInt(ctx.match[2]);
    if (isNaN(bet) || bet <= 0) return;

    if (cmd === "кубик") await execDice(ctx, bet);
    else if (cmd === "кубы") await execDoubles(ctx, bet);
    else if (cmd === "слоты") await execSlots(ctx, bet);
    else if (cmd === "больше") await execGuess(ctx, bet, "больше");
    else if (cmd === "меньше") await execGuess(ctx, bet, "меньше");
    else if (cmd === "четное") await execGuess(ctx, bet, "четное");
    else if (cmd === "нечетное") await execGuess(ctx, bet, "нечетное");
  });
}
