import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, getUserBusiness, getAllUserBusinesses, buyBusiness, collectBusiness } from "../db.js";
import { BUSINESSES, BUSINESS_MAP, MIN_COLLECT_HOURS, MAX_ACCUM_HOURS, calcAccumulated } from "../data/businesses.js";
import { fmt, fmtCountdown } from "../utils.js";

const MIN_COLLECT_MS = MIN_COLLECT_HOURS * 3_600_000;

export function registerBusinessHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^бизнесы$/i, /^\/businesses$/i, /^\/business$/i], async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user) return;
      const owned = await getAllUserBusinesses(ctx.from.id);
      const ownedMap = new Map(owned.map(b => [b.business_key, b]));

      const lines: string[] = [];
      const kb = new InlineKeyboard();

      BUSINESSES.forEach((biz, i) => {
        const rec = ownedMap.get(biz.key);
        if (rec) {
          const elapsed = Date.now() - new Date(rec.last_collect).getTime();
          const accumulated = calcAccumulated(biz, new Date(rec.last_collect));
          const canCollect = elapsed >= MIN_COLLECT_MS;
          const timeLeft = MIN_COLLECT_MS - elapsed;
          const capHours = MAX_ACCUM_HOURS;
          const isCapped = elapsed >= capHours * 3_600_000;

          lines.push(
            `${biz.emoji} <b>${biz.name}</b> [КУПЛЕН]\n` +
            `   📦 ${fmt(biz.hourlyIncome)} 💎/ч | Накоплено: <b>${fmt(accumulated)} 💎</b>\n` +
            `   ${canCollect ? "✅ Готово к сбору!" : `⏳ ${fmtCountdown(timeLeft)}`}` +
            (isCapped ? " ⚠️ Кап 48ч" : "")
          );
          if (canCollect) kb.text(`${biz.emoji} Собрать`, `biz_collect_${biz.key}`);
          else kb.text(`${biz.emoji} ⏳`, `biz_wait_${biz.key}`);
        } else {
          const canAfford = user.balance >= biz.cost;
          lines.push(
            `${biz.emoji} <b>${biz.name}</b>\n` +
            `   💰 Цена: ${fmt(biz.cost)} 💎 | ${fmt(biz.hourlyIncome)} 💎/ч\n` +
            `   📅 Окупаемость: 5 дней`
          );
          kb.text(`${biz.emoji} ${canAfford ? "Купить" : "❌"}`, `biz_buy_${biz.key}`);
        }
        if ((i + 1) % 2 === 0) kb.row();
      });

      await ctx.reply(
        `🏢 <b>Бизнесы</b>\n💰 Баланс: <b>${fmt(user.balance)} 💎</b>\n` +
        `📦 Сбор: раз в ${MIN_COLLECT_HOURS}ч | Кап: ${MAX_ACCUM_HOURS}ч\n\n` +
        lines.join("\n\n"),
        { parse_mode: "HTML", reply_markup: kb }
      );
    } catch (err) {
      console.error("[businesses/list] Error:", err);
    }
  });

  bot.callbackQuery(/^biz_buy_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const key = ctx.match[1];
    const biz = BUSINESS_MAP.get(key);
    if (!biz) return;
    const existing = await getUserBusiness(ctx.from.id, key);
    if (existing) { await ctx.answerCallbackQuery("❌ Уже куплено!"); return; }
    const user = await getUser(ctx.from.id);
    if (!user || user.balance < biz.cost) {
      await ctx.answerCallbackQuery(`❌ Нужно ${fmt(biz.cost)} 💎`); return;
    }
    const ok = await buyBusiness(ctx.from.id, key, biz.cost);
    if (!ok) { await ctx.answerCallbackQuery("❌ Не удалось купить."); return; }
    await ctx.answerCallbackQuery(`✅ ${biz.name} куплен!`);
    await ctx.reply(
      `${biz.emoji} <b>${biz.name}</b> куплен!\n\n` +
      `💸 Потрачено: <b>${fmt(biz.cost)} 💎</b>\n` +
      `📦 Доход: <b>${fmt(biz.hourlyIncome)} 💎/ч</b>\n` +
      `📅 Окупаемость: <b>5 дней</b>\n` +
      `⏱️ Первый сбор через <b>${MIN_COLLECT_HOURS} ч.</b>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^biz_collect_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const key = ctx.match[1];
    const biz = BUSINESS_MAP.get(key);
    if (!biz) return;
    const rec = await getUserBusiness(ctx.from.id, key);
    if (!rec) { await ctx.answerCallbackQuery("❌ Бизнес не найден."); return; }

    const elapsed = Date.now() - new Date(rec.last_collect).getTime();
    if (elapsed < MIN_COLLECT_MS) {
      await ctx.answerCallbackQuery(`⏳ Ещё рано! ${fmtCountdown(MIN_COLLECT_MS - elapsed)}`, { show_alert: true });
      return;
    }

    const income = calcAccumulated(biz, new Date(rec.last_collect));
    await collectBusiness(ctx.from.id, key, income);
    await ctx.answerCallbackQuery(`✅ Собрано ${fmt(income)} 💎!`);
    await ctx.reply(
      `${biz.emoji} <b>${biz.name}</b>: доход собран!\n\n💰 +<b>${fmt(income)} 💎</b>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^biz_wait_(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const biz = BUSINESS_MAP.get(key);
    if (!biz || !ctx.from) { await ctx.answerCallbackQuery(); return; }
    const rec = await getUserBusiness(ctx.from.id, key);
    if (!rec) { await ctx.answerCallbackQuery(); return; }
    const elapsed = Date.now() - new Date(rec.last_collect).getTime();
    const accumulated = calcAccumulated(biz, new Date(rec.last_collect));
    await ctx.answerCallbackQuery(
      `⏳ ${biz.name}\nНакоплено: ${fmt(accumulated)} 💎\nДо сбора: ${fmtCountdown(MIN_COLLECT_MS - elapsed)}`,
      { show_alert: true }
    );
  });

  // Text commands
  bot.hears(/^купить (.+)$/i, async (ctx) => {
    if (!ctx.from) return;
    const q = ctx.match[1].trim().toLowerCase();
    const biz = BUSINESSES.find(b => b.key === q || b.name.toLowerCase().includes(q));
    if (!biz) { await ctx.reply("❌ Не найдено. Напиши <code>бизнесы</code>.", { parse_mode: "HTML" }); return; }
    const existing = await getUserBusiness(ctx.from.id, biz.key);
    if (existing) { await ctx.reply(`❌ Ты уже владеешь: <b>${biz.name}</b>.`, { parse_mode: "HTML" }); return; }
    const user = await getUser(ctx.from.id);
    if (!user || user.balance < biz.cost) {
      await ctx.reply(`❌ Нужно: <b>${fmt(biz.cost)} 💎</b>`, { parse_mode: "HTML" }); return;
    }
    const ok = await buyBusiness(ctx.from.id, biz.key, biz.cost);
    if (!ok) { await ctx.reply("❌ Не удалось купить."); return; }
    await ctx.reply(
      `${biz.emoji} <b>${biz.name}</b> куплен!\n💸 -<b>${fmt(biz.cost)} 💎</b>\n📦 ${fmt(biz.hourlyIncome)} 💎/ч`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(/^собрать (.+)$/i, async (ctx) => {
    if (!ctx.from) return;
    const q = ctx.match[1].trim().toLowerCase();
    const biz = BUSINESSES.find(b => b.key === q || b.name.toLowerCase().includes(q));
    if (!biz) { await ctx.reply("❌ Не найдено. Напиши <code>бизнесы</code>.", { parse_mode: "HTML" }); return; }
    const rec = await getUserBusiness(ctx.from.id, biz.key);
    if (!rec) { await ctx.reply(`❌ Ты не владеешь: <b>${biz.name}</b>.`, { parse_mode: "HTML" }); return; }
    const elapsed = Date.now() - new Date(rec.last_collect).getTime();
    if (elapsed < MIN_COLLECT_MS) {
      await ctx.reply(`⏳ Ещё рано!\n\nНакоплено: <b>${fmt(calcAccumulated(biz, new Date(rec.last_collect)))} 💎</b>\nДо сбора: <b>${fmtCountdown(MIN_COLLECT_MS - elapsed)}</b>`, { parse_mode: "HTML" });
      return;
    }
    const income = calcAccumulated(biz, new Date(rec.last_collect));
    await collectBusiness(ctx.from.id, biz.key, income);
    await ctx.reply(`${biz.emoji} <b>${biz.name}</b>: +<b>${fmt(income)} 💎</b>`, { parse_mode: "HTML" });
  });
}
