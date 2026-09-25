import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, createClan, getClan, getClanByTag, getClanMembers, depositToClan } from "../db.js";
import { parseAmount, fmt, displayName } from "../utils.js";

export function registerClanHandlers(bot: Bot<BotContext>): void {
  bot.hears(/^создать клан (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user) return;
      if (user.clan_id) { await ctx.reply("❌ Ты уже в клане."); return; }
      const args = ctx.match[1].trim().split(/\s+/);
      if (args.length < 2) { await ctx.reply("❌ Пример: <code>создать клан НазваниеКлана [ТЕГ]</code>", { parse_mode: "HTML" }); return; }
      const tag = args[args.length - 1].toUpperCase().slice(0, 5);
      const name = args.slice(0, -1).join(" ").slice(0, 50);
      if (name.length < 3) { await ctx.reply("❌ Название минимум 3 символа."); return; }
      const clan = await createClan(name, tag, ctx.from.id);
      if (!clan) { await ctx.reply("❌ Клан с таким названием или тегом уже существует!"); return; }
      await ctx.reply(
        `🏰 <b>Клан создан!</b>\n\nНазвание: <b>${clan.name}</b>\nТег: <b>[${clan.tag}]</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[clan/create] Error:", err); }
  });

  bot.hears([/^клан$/i, /^клан (.+)$/i], async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user) return;
      const tagArg = (ctx.match as RegExpMatchArray)?.[1]?.trim();
      let clanId = user.clan_id;
      if (tagArg) {
        const found = await getClanByTag(tagArg);
        if (!found) { await ctx.reply("❌ Клан не найден."); return; }
        clanId = found.clan_id;
      }
      if (!clanId) { await ctx.reply("❌ Ты не в клане. Создай: <code>создать клан Название [ТЕГ]</code>", { parse_mode: "HTML" }); return; }
      const clan = await getClan(clanId);
      if (!clan) { await ctx.reply("❌ Клан не найден."); return; }
      const members = await getClanMembers(clanId);
      const top = members.slice(0, 5).map((m, i) => `${i + 1}. ${m.username} — ${fmt(m.balance)} 💎`).join("\n");
      await ctx.reply(
        `🏰 <b>${clan.name}</b> [${clan.tag}]\n\n👥 Участников: <b>${members.length}</b>\n💰 Казна: <b>${fmt(clan.balance)} 💎</b>\n⭐ Рейтинг: <b>${fmt(clan.rating)}</b>\n\n🏆 <b>Топ:</b>\n${top}`,
        { parse_mode: "HTML" }
      );
    } catch (err) { console.error("[clan/info] Error:", err); }
  });

  bot.hears(/^клан положить (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user || !user.clan_id) { await ctx.reply("❌ Ты не в клане."); return; }
      const amount = parseAmount(ctx.match[1]);
      if (!amount) { await ctx.reply("❌ Пример: <code>клан положить 50000</code>", { parse_mode: "HTML" }); return; }
      const ok = await depositToClan(ctx.from.id, user.clan_id, amount);
      if (!ok) { await ctx.reply("❌ Недостаточно средств!"); return; }
      await ctx.reply(`✅ +<b>${fmt(amount)} 💎</b> в казну клана.`, { parse_mode: "HTML" });
    } catch (err) { console.error("[clan/deposit] Error:", err); }
  });
}
