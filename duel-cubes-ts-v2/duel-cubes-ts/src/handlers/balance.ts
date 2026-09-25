import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, setCustomNick } from "../db.js";
import { fmt, fmtDate, displayName } from "../utils.js";

export function registerBalanceHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^\/balance$/i, /^\/bal$/i, /^баланс$/i], async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user) return;
      const nick = user.custom_nick ?? user.username;
      const spouse = user.spouse_id
        ? `\n💍 Супруг(а): <code>${user.spouse_id}</code>`
        : "";
      const since = user.marriage_date
        ? `\n📅 В браке с: ${fmtDate(new Date(user.marriage_date))}`
        : "";
      await ctx.reply(
        `👤 <b>Профиль</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🏷 Ник: <b>${nick}</b>\n` +
        `💰 Баланс: <b>${fmt(user.balance)} 💎</b>\n` +
        `📊 Оборот: <b>${fmt(user.turnover)} 💎</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `✅ Побед: <b>${user.wins}</b>\n` +
        `❌ Поражений: <b>${user.losses}</b>\n` +
        `🤝 Ничьих: <b>${user.draws}</b>` +
        spouse + since,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("[balance] Error:", err);
    }
  });

  bot.hears(/^ник (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const nick = ctx.match[1].trim().slice(0, 32);
      await setCustomNick(ctx.from.id, nick);
      await ctx.reply(`✅ Ник изменён на: <b>${nick}</b>`, { parse_mode: "HTML" });
    } catch (err) {
      console.error("[nick] Error:", err);
    }
  });
}
