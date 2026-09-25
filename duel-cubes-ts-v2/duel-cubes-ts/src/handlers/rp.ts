import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getChatSettings } from "../db.js";
import { RP_ACTIONS } from "../data/rp.js";
import { displayName } from "../utils.js";

export function registerRpHandlers(bot: Bot<BotContext>): void {
  const actionKeys = Object.keys(RP_ACTIONS);
  const pattern = new RegExp(`^(${actionKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\s+.*)?$`, "i");

  bot.hears(pattern, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      const settings = await getChatSettings(ctx.chat.id);
      if (!settings.rp_enabled) return;

      const text = ctx.message?.text ?? "";
      const matched = actionKeys.find(a => text.toLowerCase().startsWith(a));
      if (!matched) return;
      const action = RP_ACTIONS[matched];

      const replyUser = ctx.message?.reply_to_message?.from;
      const mention = ctx.message?.entities?.find(e => e.type === "mention" || e.type === "text_mention");
      let target: string;

      if (replyUser && !replyUser.is_bot) {
        target = displayName(replyUser);
      } else if (mention?.type === "text_mention" && mention.user) {
        target = displayName(mention.user);
      } else if (mention?.type === "mention") {
        target = text.slice(mention.offset, mention.offset + mention.length);
      } else {
        await ctx.reply(`${action.emoji} <i>Ответь на сообщение или упомяни игрока!</i>`, { parse_mode: "HTML" });
        return;
      }

      await ctx.reply(
        `${action.emoji} <b>${displayName(ctx.from)}</b> ${action.verb} <b>${target}</b>!`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[rp] Error:", err); }
  });

  // +рп / -рп
  bot.hears(/^\+рп$/i, async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
    const m = await ctx.getChatMember(ctx.from.id);
    if (!["administrator", "creator"].includes(m.status)) { await ctx.reply("❌ Только администраторы."); return; }
    const { setChatSetting } = await import("../db.js");
    await setChatSetting(ctx.chat.id, "rp_enabled", true);
    await ctx.reply("✅ RP-действия <b>включены</b>.", { parse_mode: "HTML" });
  });

  bot.hears(/^-рп$/i, async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
    const m = await ctx.getChatMember(ctx.from.id);
    if (!["administrator", "creator"].includes(m.status)) { await ctx.reply("❌ Только администраторы."); return; }
    const { setChatSetting } = await import("../db.js");
    await setChatSetting(ctx.chat.id, "rp_enabled", false);
    await ctx.reply("❌ RP-действия <b>выключены</b>.", { parse_mode: "HTML" });
  });
}
