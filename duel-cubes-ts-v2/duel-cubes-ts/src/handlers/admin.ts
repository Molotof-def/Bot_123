import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, addWarn, resetWarns, getChatRules, setChatRules, claimPromo, setChatSetting, syncChatAdmins } from "../db.js";
import { config } from "../config.js";
import { parseAmount, fmt, displayName } from "../utils.js";
import { pool } from "../db.js";

interface PromoDef { reward: number; maxUses: number; used: number }
const promoCodes = new Map<string, PromoDef>();

const isDevOrCreator = (id: number) => id === config.DEV_ID || config.CREATOR_IDS.includes(id);

async function isAdmin(ctx: BotContext, userId: number): Promise<boolean> {
  try {
    const m = await ctx.getChatMember(userId);
    return ["administrator", "creator"].includes(m.status);
  } catch { return false; }
}

export function registerAdminHandlers(bot: Bot<BotContext>): void {
  // Sync admins on member update
  bot.on("chat_member", async (ctx) => {
    try {
      if (!ctx.chat) return;
      const admins = await ctx.getChatAdministrators();
      await syncChatAdmins(ctx.chat.id, admins.map(a => a.user.id));
    } catch { /* ignored */ }
  });

  // /warn
  bot.hears([/^\/warn$/i, /^варн$/i], async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      const target = ctx.message?.reply_to_message?.from;
      if (!target || target.is_bot) { await ctx.reply("❌ Ответь на сообщение пользователя."); return; }
      const warns = await addWarn(target.id);
      await ctx.reply(
        `⚠️ <b>${displayName(target)}</b> — варн ${warns}/3\n` +
        (warns >= 3 ? "🚫 <b>Лимит! Рекомендуется бан.</b>" : ""),
        { parse_mode: "HTML" }
      );
      if (warns >= 3) {
        try { await ctx.api.banChatMember(ctx.chat.id, target.id); } catch { /* ignored */ }
      }
    } catch (err) { console.error("[admin/warn] Error:", err); }
  });

  // /unwarn
  bot.hears([/^\/unwarn$/i, /^анварн$/i], async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      const target = ctx.message?.reply_to_message?.from;
      if (!target) { await ctx.reply("❌ Ответь на сообщение."); return; }
      await resetWarns(target.id);
      await ctx.reply(`✅ Варны <b>${displayName(target)}</b> сброшены.`, { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/unwarn] Error:", err); }
  });

  // /mute [minutes]
  bot.hears(/^\/mute(?: (\d+))?$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      const target = ctx.message?.reply_to_message?.from;
      if (!target || target.is_bot) { await ctx.reply("❌ Ответь на сообщение."); return; }
      const mins = parseInt(ctx.match[1] ?? "10");
      await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(Date.now() / 1000) + mins * 60,
      });
      await ctx.reply(`🔇 <b>${displayName(target)}</b> замьючен на <b>${mins} мин.</b>`, { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/mute] Error:", err); }
  });

  // /unmute
  bot.hears(/^\/unmute$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      const target = ctx.message?.reply_to_message?.from;
      if (!target) { await ctx.reply("❌ Ответь на сообщение."); return; }
      await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
        permissions: { can_send_messages: true, can_send_media_messages: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true },
      });
      await ctx.reply(`🔊 <b>${displayName(target)}</b> размьючен.`, { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/unmute] Error:", err); }
  });

  // /ban
  bot.hears(/^\/ban$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      const target = ctx.message?.reply_to_message?.from;
      if (!target || target.is_bot) { await ctx.reply("❌ Ответь на сообщение."); return; }
      await ctx.api.banChatMember(ctx.chat.id, target.id);
      await ctx.reply(`🚫 <b>${displayName(target)}</b> забанен.`, { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/ban] Error:", err); }
  });

  // /unban [id]
  bot.hears(/^\/unban (\d+)$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) return;
      await ctx.api.unbanChatMember(ctx.chat.id, parseInt(ctx.match[1]));
      await ctx.reply(`✅ Пользователь разбанен.`);
    } catch (err) { console.error("[admin/unban] Error:", err); }
  });

  // +чат / -чат — enable/disable bot in chat
  bot.hears(/^\+чат$/i, async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
    if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
    await setChatSetting(ctx.chat.id, "bot_enabled", true);
    await ctx.reply("✅ Бот <b>включён</b> в этом чате.", { parse_mode: "HTML" });
  });

  bot.hears(/^-чат$/i, async (ctx) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
    if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
    await setChatSetting(ctx.chat.id, "bot_enabled", false);
    await ctx.reply("❌ Бот <b>выключен</b> в этом чате.", { parse_mode: "HTML" });
  });

  // /rules
  bot.hears(/^\/rules$/i, async (ctx) => {
    try {
      if (!ctx.chat) return;
      const rules = await getChatRules(ctx.chat.id);
      await ctx.reply(rules ? `📋 <b>Правила:</b>\n\n${rules}` : "📋 Правила не установлены.", { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/rules] Error:", err); }
  });

  bot.hears(/^\/setrules (.+)$/is, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") return;
      if (!await isAdmin(ctx, ctx.from.id)) { await ctx.reply("❌ Только администраторы."); return; }
      await setChatRules(ctx.chat.id, ctx.match[1].trim(), displayName(ctx.from));
      await ctx.reply("✅ <b>Правила обновлены!</b>", { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/setrules] Error:", err); }
  });

  // /createpromo code reward maxUses (DEV only)
  bot.hears(/^\/createpromo (\S+) (\d+) (\d+)$/i, async (ctx) => {
    if (!ctx.from || !isDevOrCreator(ctx.from.id)) return;
    const code = ctx.match[1].toUpperCase();
    const reward = parseInt(ctx.match[2]);
    const maxUses = parseInt(ctx.match[3]);
    promoCodes.set(code, { reward, maxUses, used: 0 });
    await ctx.reply(`✅ Промокод <code>${code}</code> создан: ${fmt(reward)} 💎 × ${maxUses}`, { parse_mode: "HTML" });
  });

  // промо [code]
  bot.hears(/^промо (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from) return;
      const code = ctx.match[1].trim().toUpperCase();
      const def = promoCodes.get(code);
      if (!def) { await ctx.reply("❌ Промокод не найден или истёк."); return; }
      if (def.used >= def.maxUses) { promoCodes.delete(code); await ctx.reply("❌ Промокод исчерпан."); return; }
      const ok = await claimPromo(ctx.from.id, code, def.reward);
      if (!ok) { await ctx.reply("❌ Ты уже активировал этот промокод!"); return; }
      def.used += 1;
      if (def.used >= def.maxUses) promoCodes.delete(code);
      await ctx.reply(`🎉 Промокод активирован! +<b>${fmt(def.reward)} 💎</b>`, { parse_mode: "HTML" });
    } catch (err) { console.error("[admin/promo] Error:", err); }
  });

  // /give id amount (DEV only)
  bot.hears(/^\/give (\d+) (.+)$/i, async (ctx) => {
    if (!ctx.from || !isDevOrCreator(ctx.from.id)) return;
    const targetId = parseInt(ctx.match[1]);
    const amount = parseAmount(ctx.match[2]);
    if (!amount) { await ctx.reply("❌ Неверная сумма."); return; }
    await pool.query(`UPDATE users SET balance = balance + $1 WHERE user_id = $2`, [amount, targetId]);
    await ctx.reply(`✅ Выдано <b>${fmt(amount)} 💎</b> → <code>${targetId}</code>`, { parse_mode: "HTML" });
  });

  // /userinfo id (DEV only)
  bot.hears(/^\/userinfo (\d+)$/i, async (ctx) => {
    if (!ctx.from || !isDevOrCreator(ctx.from.id)) return;
    const user = await getUser(parseInt(ctx.match[1]));
    if (!user) { await ctx.reply("❌ Не найден."); return; }
    await ctx.reply(
      `👤 <code>${user.user_id}</code> | <b>${user.username}</b>\n` +
      `💰 ${fmt(user.balance)} | 📊 ${fmt(user.turnover)}\n` +
      `✅ ${user.wins} | ❌ ${user.losses} | ⚠️ ${user.warns}\n` +
      `🏰 Клан: ${user.clan_id ?? "нет"}`,
      { parse_mode: "HTML" }
    );
  });

  // /help
  bot.hears([/^\/help$/i, /^помощь$/i], async (ctx) => {
    await ctx.reply(
      `🎲 <b>Duel Cubes — Команды</b>\n\n` +
      `<b>💰 Экономика</b>\n` +
      `• <code>баланс</code> — профиль\n` +
      `• <code>ворк</code> — заработок (2ч кд)\n` +
      `• <code>перевод [сумма] @user</code>\n` +
      `• <code>чек [сумма] [кол-во]</code>\n\n` +
      `<b>🎮 Игры</b>\n` +
      `• <code>кубик [ставка]</code> — ×1.9\n` +
      `• <code>кубы [ставка]</code> — дубль ×3.0\n` +
      `• <code>слоты [ставка]</code> — 777=×35\n` +
      `• <code>больше/меньше [ставка]</code> — ×1.9\n` +
      `• <code>чётное/нечётное [ставка]</code> — ×1.9\n` +
      `• <code>рулетка [исход] [ставка]</code> — 0–36\n` +
      `• <code>лесенка [ставка]</code> — до ×7.5\n\n` +
      `<b>⚔️ P2P</b>\n` +
      `• <code>дуэль [ставка] @user</code>\n` +
      `• <code>кнб [ставка] @user</code>\n\n` +
      `<b>👨‍👩 Социальное</b>\n` +
      `• <code>брак</code> | <code>семья</code> | <code>развод</code>\n` +
      `• <code>подарок [сумма]</code> (0% комиссия)\n\n` +
      `<b>🏰 Кланы</b>\n` +
      `• <code>создать клан [Название] [ТЕГ]</code>\n` +
      `• <code>клан</code> | <code>клан положить [сумма]</code>\n\n` +
      `<b>🏢 Бизнесы</b>\n` +
      `• <code>бизнесы</code> | <code>купить [бизнес]</code>\n` +
      `• <code>собрать [бизнес]</code>\n\n` +
      `<b>📊 Прочее</b>\n` +
      `• <code>топ</code> | <code>топ сообщений</code>\n` +
      `• <code>промо [код]</code>\n` +
      `• <code>ник [имя]</code>\n` +
      `• <code>/rules</code>`,
      { parse_mode: "HTML" }
    );
  });
}
