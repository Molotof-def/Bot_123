import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { QUIZ_DATABASE } from "../data/quiz.js";
import { config } from "../config.js";
import { shuffle, addBalance } from "../utils.js";
import { pool } from "../db.js";

// Re-export addBalance for quiz reward
async function rewardWinner(userId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET balance = balance + 25000, last_active = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId]
  );
}

interface ActiveQuiz {
  idx: number;
  correct: string;
  blocked: Set<number>;
  winnerId: number | null;
  msgId: number;
  chatId: number;
}

const activeQuizzes = new Map<number, ActiveQuiz>();
const schedulers = new Map<number, ReturnType<typeof setInterval>>();

function encB64(s: string): string { return Buffer.from(s).toString("base64url"); }
function decB64(s: string): string { return Buffer.from(s, "base64url").toString("utf-8"); }

async function sendQuiz(bot: Bot<BotContext>, chatId: number): Promise<void> {
  try {
    if (activeQuizzes.has(chatId)) return;
    const idx = Math.floor(Math.random() * QUIZ_DATABASE.length);
    const q = QUIZ_DATABASE[idx];
    const options = shuffle([q.correct, ...q.wrong]);

    const kb = new InlineKeyboard();
    options.forEach(opt => kb.text(opt, `quiz_${chatId}_${encB64(opt)}`).row());

    const msg = await bot.api.sendMessage(
      chatId,
      `🧠 <b>ВИКТОРИНА!</b>\n\n<b>${q.q}</b>\n\n<i>Первый правильный ответ: +25 000 💎</i>`,
      { parse_mode: "HTML", reply_markup: kb }
    );

    activeQuizzes.set(chatId, { idx, correct: q.correct, blocked: new Set(), winnerId: null, msgId: msg.message_id, chatId });

    setTimeout(async () => {
      const quiz = activeQuizzes.get(chatId);
      if (quiz && !quiz.winnerId) {
        activeQuizzes.delete(chatId);
        try {
          await bot.api.editMessageText(chatId, quiz.msgId,
            `🧠 <b>Викторина завершена!</b>\n\n❓ ${QUIZ_DATABASE[quiz.idx].q}\n\n✅ Ответ: <b>${quiz.correct}</b>\n\n<i>Никто не ответил.</i>`,
            { parse_mode: "HTML" }
          );
        } catch { /* ignored */ }
      }
    }, 120_000);
  } catch (err) { console.error("[quiz/send] Error:", err); }
}

export function registerQuizHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^\/quiz$/i, /^викторина$/i], async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      const allowed = [config.DEV_ID, ...config.CREATOR_IDS];
      if (!allowed.includes(ctx.from.id)) { await ctx.reply("❌ Только разработчики."); return; }
      if (activeQuizzes.has(ctx.chat.id)) { await ctx.reply("⚠️ Викторина уже идёт!"); return; }
      await sendQuiz(bot, ctx.chat.id);
      if (!schedulers.has(ctx.chat.id)) {
        const id = ctx.chat.id;
        schedulers.set(id, setInterval(() => sendQuiz(bot, id), config.QUIZ_INTERVAL_MS));
      }
    } catch (err) { console.error("[quiz/trigger] Error:", err); }
  });

  bot.callbackQuery(/^quiz_(-?\d+)_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const chatId = parseInt(ctx.match[1]);
    const answer = decB64(ctx.match[2]);
    const quiz = activeQuizzes.get(chatId);

    if (!quiz) { await ctx.answerCallbackQuery("⏱️ Викторина уже завершена."); return; }
    if (quiz.blocked.has(ctx.from.id)) { await ctx.answerCallbackQuery("❌ Ты выбыл из этой викторины."); return; }
    if (quiz.winnerId !== null) { await ctx.answerCallbackQuery("✅ Победитель уже найден!"); return; }

    if (answer === quiz.correct) {
      quiz.winnerId = ctx.from.id;
      activeQuizzes.delete(chatId);
      await rewardWinner(ctx.from.id);
      await ctx.answerCallbackQuery("🎉 Правильно!");
      try {
        await ctx.editMessageText(
          `🧠 <b>ВИКТОРИНА ЗАВЕРШЕНА!</b>\n\n❓ ${QUIZ_DATABASE[quiz.idx].q}\n\n✅ Ответ: <b>${quiz.correct}</b>\n\n🏆 Победитель: <b>${ctx.from.first_name}</b> (+25 000 💎)`,
          { parse_mode: "HTML" }
        );
      } catch { /* ignored */ }
    } else {
      quiz.blocked.add(ctx.from.id);
      await ctx.answerCallbackQuery("❌ Ответ неверный! Вы выбыли из этой викторины.");
    }
  });
}
