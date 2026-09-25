import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { config } from "../config.js";

interface Session {
  userId: number;
  chatId: number;
  answer: number;
  attempts: number;
  msgId: number;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();
const key = (chatId: number, userId: number) => `${chatId}_${userId}`;

function mkQuestion() {
  const a = Math.floor(Math.random() * 15) + 2;
  const b = Math.floor(Math.random() * 15) + 2;
  const ops = ["+", "-", "*"] as const;
  const op = ops[Math.floor(Math.random() * ops.length)];
  const answer = op === "+" ? a + b : op === "-" ? a - b : a * b;
  const wrongs = new Set<number>();
  while (wrongs.size < 3) {
    const d = Math.floor(Math.random() * 8) + 1;
    const c = Math.random() < 0.5 ? answer + d : answer - d;
    if (c !== answer && c > 0) wrongs.add(c);
  }
  const options = [answer, ...wrongs].sort(() => Math.random() - 0.5);
  return { question: `${a} ${op} ${b}`, answer, options };
}

export function registerCaptchaHandlers(bot: Bot<BotContext>): void {
  bot.on("chat_member", async (ctx) => {
    try {
      const upd = ctx.chatMember;
      if (!upd) return;
      const { new_chat_member: nxt, old_chat_member: old, chat } = upd;
      const wasOut = ["left", "kicked"].includes(old.status);
      const isIn = ["member", "restricted"].includes(nxt.status);
      if (!wasOut || !isIn || nxt.user.is_bot) return;

      const user = nxt.user;
      const sk = key(chat.id, user.id);
      if (sessions.has(sk)) return;

      try {
        await ctx.api.restrictChatMember(chat.id, user.id, { permissions: { can_send_messages: false } });
      } catch { return; }

      const { question, answer, options } = mkQuestion();
      const kb = new InlineKeyboard();
      options.forEach(o => kb.text(String(o), `cap_${chat.id}_${user.id}_${o}`));

      const msg = await ctx.api.sendMessage(
        chat.id,
        `👋 <b>${user.first_name}</b>, реши пример для входа!\n\n🧮 <b>${question} = ?</b>\n\n⏱️ ${config.CAPTCHA_TIMEOUT_SECONDS} сек. При 3 ошибках — кик.`,
        { parse_mode: "HTML", reply_markup: kb }
      );

      const timer = setTimeout(async () => {
        sessions.delete(sk);
        try {
          await ctx.api.banChatMember(chat.id, user.id);
          await ctx.api.unbanChatMember(chat.id, user.id);
          await ctx.api.editMessageText(chat.id, msg.message_id,
            `⏱️ <b>${user.first_name}</b> не прошёл(а) капчу — кик.`, { parse_mode: "HTML" }
          );
        } catch { /* ignored */ }
      }, config.CAPTCHA_TIMEOUT_SECONDS * 1000);

      sessions.set(sk, { userId: user.id, chatId: chat.id, answer, attempts: 0, msgId: msg.message_id, timer });
    } catch (err) { console.error("[captcha/join] Error:", err); }
  });

  bot.callbackQuery(/^cap_(-?\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const chatId = parseInt(ctx.match[1]);
    const targetId = parseInt(ctx.match[2]);
    const chosen = parseInt(ctx.match[3]);

    if (ctx.from.id !== targetId) { await ctx.answerCallbackQuery("❌ Это не твоя капча!"); return; }

    const sk = key(chatId, targetId);
    const session = sessions.get(sk);
    if (!session) { await ctx.answerCallbackQuery("⏱️ Капча истекла."); return; }

    if (chosen === session.answer) {
      clearTimeout(session.timer);
      sessions.delete(sk);
      try {
        await ctx.api.restrictChatMember(chatId, targetId, {
          permissions: { can_send_messages: true, can_send_media_messages: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true },
        });
        await ctx.editMessageText(`✅ <b>${ctx.from.first_name}</b> прошёл(а) проверку! Добро пожаловать! 🎉`, { parse_mode: "HTML" });
      } catch { /* ignored */ }
      await ctx.answerCallbackQuery("✅ Верно! Добро пожаловать!");
    } else {
      session.attempts += 1;
      await ctx.answerCallbackQuery(`❌ Неверно! Попыток: ${session.attempts}/${config.CAPTCHA_MAX_ATTEMPTS}`);
      if (session.attempts >= config.CAPTCHA_MAX_ATTEMPTS) {
        clearTimeout(session.timer);
        sessions.delete(sk);
        try {
          await ctx.api.banChatMember(chatId, targetId);
          await ctx.api.unbanChatMember(chatId, targetId);
          await ctx.editMessageText(`🚫 <b>${ctx.from.first_name}</b> не прошёл(а) капчу — кик.`, { parse_mode: "HTML" });
        } catch { /* ignored */ }
      } else {
        const { question, answer: newAns, options } = mkQuestion();
        session.answer = newAns;
        const kb = new InlineKeyboard();
        options.forEach(o => kb.text(String(o), `cap_${chatId}_${targetId}_${o}`));
        try {
          await ctx.editMessageText(
            `👋 Попробуй ещё раз!\n\n🧮 <b>${question} = ?</b>\n\nОсталось попыток: <b>${config.CAPTCHA_MAX_ATTEMPTS - session.attempts}</b>`,
            { parse_mode: "HTML", reply_markup: kb }
          );
        } catch { /* ignored */ }
      }
    }
  });
}
