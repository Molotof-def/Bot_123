import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getUser } from "../db.js";
import { FUNNY_SUPPORT_QUOTES, EASTER_EGG_SUPPORT, getQuote } from "../data/quotes.js";
import { randomChoice } from "../utils.js";

export function registerSupportHandlers(bot: Bot<BotContext>): void {
  bot.hears(/поддержк/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const text = ctx.message?.text?.toLowerCase() ?? "";
      if ((text.includes("слова поддержки") || text.includes("поддержк")) && text.includes("деп")) {
        await ctx.reply(EASTER_EGG_SUPPORT, { parse_mode: "HTML" });
        return;
      }
      const user = await getUser(ctx.from.id);
      const quote = user ? getQuote(user.balance) : randomChoice(FUNNY_SUPPORT_QUOTES);
      await ctx.reply(quote, { parse_mode: "HTML" });
    } catch (err) { console.error("[support] Error:", err); }
  });
}
