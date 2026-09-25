import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getTopByBalance, getTopByTurnover, getTopByWins, getChatTopMessages, type User } from "../db.js";
import { fmt } from "../utils.js";

type Tab = "balance" | "turnover" | "wins";

function kb(active: Tab): InlineKeyboard {
  return new InlineKeyboard()
    .text(active === "balance" ? "💰 Баланс ✓" : "💰 Баланс", "top_balance")
    .text(active === "turnover" ? "📊 Оборот ✓" : "📊 Оборот", "top_turnover")
    .text(active === "wins" ? "🏆 Победы ✓" : "🏆 Победы", "top_wins");
}

function formatTop(users: User[], tab: Tab): string {
  const medals = ["🥇", "🥈", "🥉"];
  const title: Record<Tab, string> = { balance: "💰 Топ по балансу", turnover: "📊 Топ по обороту", wins: "🏆 Топ по победам" };
  const lines = users.map((u, i) => {
    const m = medals[i] ?? `${i + 1}.`;
    const nick = u.custom_nick ?? u.username;
    const val = tab === "balance" ? `${fmt(u.balance)} 💎` : tab === "turnover" ? `${fmt(u.turnover)} 💎` : `${u.wins} поб.`;
    return `${m} <b>${nick}</b> — ${val}`;
  });
  return `${title[tab]}\n━━━━━━━━━━━━━━━━\n${lines.join("\n")}`;
}

export function registerTopHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^\/top$/i, /^топ$/i], async (ctx) => {
    try {
      const users = await getTopByBalance(10);
      await ctx.reply(formatTop(users, "balance"), { parse_mode: "HTML", reply_markup: kb("balance") });
    } catch (err) { console.error("[top] Error:", err); }
  });

  const handle = (tab: Tab) => async (ctx: BotContext) => {
    try {
      await (ctx as any).answerCallbackQuery();
      const users = await (tab === "balance" ? getTopByBalance : tab === "turnover" ? getTopByTurnover : getTopByWins)(10);
      await (ctx as any).editMessageText(formatTop(users, tab), { parse_mode: "HTML", reply_markup: kb(tab) });
    } catch (err) { console.error(`[top/${tab}] Error:`, err); }
  };

  bot.callbackQuery("top_balance", handle("balance"));
  bot.callbackQuery("top_turnover", handle("turnover"));
  bot.callbackQuery("top_wins", handle("wins"));

  bot.hears(/^топ сообщений$/i, async (ctx) => {
    try {
      if (!ctx.chat || ctx.chat.type === "private") return;
      const rows = await getChatTopMessages(ctx.chat.id, 10);
      const medals = ["🥇", "🥈", "🥉"];
      const lines = rows.map((r, i) => `${medals[i] ?? `${i + 1}.`} <b>${r.username}</b> — ${fmt(r.msg_count)} сообщ.`);
      await ctx.reply(`💬 <b>Топ по сообщениям</b>\n━━━━━━━━━━━━━━━━\n${lines.join("\n")}`, { parse_mode: "HTML" });
    } catch (err) { console.error("[top/messages] Error:", err); }
  });
}
