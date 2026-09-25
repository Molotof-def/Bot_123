import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, marry, divorce, transferMoney } from "../db.js";
import { config } from "../config.js";
import { parseAmount, fmt, displayName, fmtDate } from "../utils.js";

const proposals = new Map<number, { targetId: number; chatId: number; msgId: number; expiresAt: number }>();

export function registerSocialHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^брак$/i, /^жениться$/i, /^выйти замуж$/i], async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") {
        await ctx.reply("💍 Только в группах!"); return;
      }
      const replyUser = ctx.message?.reply_to_message?.from;
      if (!replyUser || replyUser.is_bot) {
        await ctx.reply("💍 Ответь на сообщение того, кому хочешь предложить брак!"); return;
      }
      if (replyUser.id === ctx.from.id) { await ctx.reply("🤡 Нельзя жениться на себе!"); return; }

      const p = await getUser(ctx.from.id);
      const t = await getUser(replyUser.id);
      if (!p || !t) return;
      if (p.spouse_id) { await ctx.reply("💔 Ты уже в браке!"); return; }
      if (t.spouse_id) { await ctx.reply(`💔 <b>${displayName(replyUser)}</b> уже в браке!`, { parse_mode: "HTML" }); return; }

      const kb = new InlineKeyboard()
        .text("💍 Принять", `marry_accept_${ctx.from.id}`)
        .text("💔 Отказать", `marry_decline_${ctx.from.id}`);
      const msg = await ctx.reply(
        `💍 <b>${displayName(ctx.from)}</b> делает предложение <b>${displayName(replyUser)}</b>!`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      proposals.set(ctx.from.id, { targetId: replyUser.id, chatId: ctx.chat.id, msgId: msg.message_id, expiresAt: Date.now() + 60_000 });
    } catch (err) { console.error("[social/marry] Error:", err); }
  });

  bot.callbackQuery(/^marry_accept_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const pid = parseInt(ctx.match[1]);
    const prop = proposals.get(pid);
    if (!prop || ctx.from.id !== prop.targetId || Date.now() > prop.expiresAt) {
      await ctx.editMessageText("💔 Предложение истекло."); return;
    }
    proposals.delete(pid);
    const ok = await marry(pid, ctx.from.id);
    if (!ok) { await ctx.editMessageText("❌ Кто-то уже в браке."); return; }
    await ctx.editMessageText(`💒 <b>Поздравляем!</b> Новая семья создана! 🎉💍`, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^marry_decline_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const pid = parseInt(ctx.match[1]);
    proposals.delete(pid);
    await ctx.editMessageText("💔 Предложение отклонено.");
  });

  bot.hears(/^семья$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user || !user.spouse_id) { await ctx.reply("💔 Ты не в браке."); return; }
      const spouse = await getUser(user.spouse_id);
      await ctx.reply(
        `👨‍👩‍👧 <b>Семья</b>\n\n💍 Супруг(а): <b>${spouse?.username ?? user.spouse_id}</b>\n📅 В браке с: <b>${user.marriage_date ? fmtDate(new Date(user.marriage_date)) : "?"}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[social/family] Error:", err); }
  });

  bot.hears(/^подарок (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user || !user.spouse_id) { await ctx.reply("💔 Ты не в браке."); return; }
      const amount = parseAmount(ctx.match[1]);
      if (!amount) { await ctx.reply("❌ Пример: <code>подарок 10000</code>", { parse_mode: "HTML" }); return; }
      if (amount > user.balance) { await ctx.reply("❌ Недостаточно средств!"); return; }
      const ok = await transferMoney(ctx.from.id, user.spouse_id, amount, amount); // 0% fee
      if (!ok) { await ctx.reply("❌ Ошибка перевода."); return; }
      const spouse = await getUser(user.spouse_id);
      await ctx.reply(
        `🎁 <b>Подарок отправлен!</b>\n+<b>${fmt(amount)} 💎</b> → <b>${spouse?.username ?? user.spouse_id}</b>\n<i>Комиссия: 0%</i>`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[social/gift] Error:", err); }
  });

  bot.hears(/^развод$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user || !user.spouse_id) { await ctx.reply("💔 Ты не в браке."); return; }
      const alimony = Math.round(user.balance * (config.DIVORCE_ALIMONY_PERCENT / 100));
      const kb = new InlineKeyboard()
        .text(`✅ Развестись (-${fmt(alimony)} 💎)`, `divorce_confirm_${ctx.from.id}`)
        .text("❌ Отмена", "divorce_cancel");
      await ctx.reply(
        `⚠️ <b>Развод</b>\n\nАлименты: <b>${fmt(alimony)} 💎</b> (${config.DIVORCE_ALIMONY_PERCENT}% баланса)`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    } catch (err) { console.error("[social/divorce] Error:", err); }
  });

  bot.callbackQuery(/^divorce_confirm_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    if (ctx.from.id !== parseInt(ctx.match[1])) return;
    const user = await getUser(ctx.from.id);
    if (!user || !user.spouse_id) { await ctx.editMessageText("❌ Ты уже не в браке."); return; }
    const alimony = Math.round(user.balance * (config.DIVORCE_ALIMONY_PERCENT / 100));
    const ok = await divorce(ctx.from.id, user.spouse_id, alimony);
    if (!ok) { await ctx.editMessageText("❌ Недостаточно средств на алименты!"); return; }
    await ctx.editMessageText(`📜 <b>Развод оформлен.</b> Алименты: <b>${fmt(alimony)} 💎</b>`, { parse_mode: "HTML" });
  });

  bot.callbackQuery("divorce_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Отменено.");
    await ctx.editMessageText("✅ Развод отменён. 💍");
  });

  bot.hears(/^перевод (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const args = ctx.match[1].trim().split(/\s+/);
      const amount = parseAmount(args[0]);
      if (!amount) { await ctx.reply("❌ Пример: <code>перевод 5000 @user</code>", { parse_mode: "HTML" }); return; }

      const replyUser = ctx.message?.reply_to_message?.from;
      const mention = ctx.message?.entities?.find(e => e.type === "text_mention");
      let targetId: number | null = null;
      let targetName = "";
      if (replyUser && !replyUser.is_bot) { targetId = replyUser.id; targetName = displayName(replyUser); }
      else if (mention?.type === "text_mention" && mention.user) { targetId = mention.user.id; targetName = displayName(mention.user); }
      if (!targetId) { await ctx.reply("❌ Укажи получателя."); return; }
      if (targetId === ctx.from.id) { await ctx.reply("🤡 Нельзя переводить себе!"); return; }

      const sender = await getUser(ctx.from.id);
      if (!sender || sender.balance < amount) { await ctx.reply("❌ Недостаточно средств!"); return; }

      const fee = Math.round(amount * (config.TRANSFER_FEE_PERCENT / 100));
      const received = amount - fee;
      const ok = await transferMoney(ctx.from.id, targetId, amount, received);
      if (!ok) { await ctx.reply("❌ Ошибка перевода."); return; }
      await ctx.reply(
        `💸 <b>Перевод выполнен!</b>\nОтправлено: <b>${fmt(amount)} 💎</b>\nКомиссия (${config.TRANSFER_FEE_PERCENT}%): -<b>${fmt(fee)} 💎</b>\nПолучено <b>${targetName}</b>: <b>${fmt(received)} 💎</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[social/transfer] Error:", err); }
  });
}
