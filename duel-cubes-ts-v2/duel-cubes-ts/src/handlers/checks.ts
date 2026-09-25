import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { deductBetAtomic, addBalance } from "../db.js";
import { parseAmount, fmt, generateId, displayName } from "../utils.js";

interface Check {
  creatorId: number;
  amountEach: number;
  remaining: number;
  claimed: Set<number>;
  expiresAt: number;
}

const checks = new Map<string, Check>();

export function registerCheckHandlers(bot: Bot<BotContext>): void {
  bot.hears(/^чек (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const args = ctx.match[1].trim().split(/\s+/);
      const amountEach = parseAmount(args[0]);
      const count = args[1] ? parseInt(args[1]) : 1;
      if (!amountEach || isNaN(count) || count < 1 || count > 100) {
        await ctx.reply("❌ Пример: <code>чек 10000 5</code>", { parse_mode: "HTML" }); return;
      }
      const total = amountEach * count;
      const ok = await deductBetAtomic(ctx.from.id, total);
      if (!ok) { await ctx.reply(`❌ Нужно: <b>${fmt(total)} 💎</b>`, { parse_mode: "HTML" }); return; }

      const id = generateId();
      checks.set(id, { creatorId: ctx.from.id, amountEach, remaining: count, claimed: new Set(), expiresAt: Date.now() + 24 * 3_600_000 });

      const kb = new InlineKeyboard().text(`🎁 Получить ${fmt(amountEach)} 💎`, `check_claim_${id}`);
      await ctx.reply(
        `🎁 <b>ЧЕК!</b>\n💰 ${fmt(amountEach)} 💎 × ${count} шт.\n💸 Заморожено: <b>${fmt(total)} 💎</b>\n⏱️ Действует 24 ч.`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    } catch (err) { console.error("[checks] Error:", err); }
  });

  bot.callbackQuery(/^check_claim_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const id = ctx.match[1];
    const check = checks.get(id);
    if (!check) { await ctx.answerCallbackQuery("❌ Чек не найден или истёк."); return; }
    if (Date.now() > check.expiresAt) { checks.delete(id); await ctx.answerCallbackQuery("⏱️ Чек истёк."); return; }
    if (check.claimed.has(ctx.from.id)) { await ctx.answerCallbackQuery("❌ Ты уже получил этот чек!"); return; }
    if (ctx.from.id === check.creatorId) { await ctx.answerCallbackQuery("❌ Нельзя забрать свой чек!"); return; }
    if (check.remaining <= 0) { checks.delete(id); await ctx.answerCallbackQuery("❌ Чек уже разобран!"); return; }

    check.claimed.add(ctx.from.id);
    check.remaining -= 1;
    await addBalance(ctx.from.id, check.amountEach);
    await ctx.answerCallbackQuery(`✅ +${fmt(check.amountEach)} 💎`);
    await ctx.reply(`🎁 <b>${displayName(ctx.from)}</b> получил чек: <b>+${fmt(check.amountEach)} 💎</b> (осталось: ${check.remaining})`, { parse_mode: "HTML" });
    if (check.remaining <= 0) checks.delete(id);
  });
}
