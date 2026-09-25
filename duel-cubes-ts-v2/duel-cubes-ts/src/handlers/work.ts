import { Bot } from "grammy";
import type { BotContext } from "../types.js";
import { getUser, addWorkReward } from "../db.js";
import { config } from "../config.js";
import { fmt } from "../utils.js";

export function registerWorkHandlers(bot: Bot<BotContext>): void {
  bot.hears([/^ворк$/i, /^\/work$/i], async (ctx) => {
    try {
      if (!ctx.from) return;
      const user = await getUser(ctx.from.id);
      if (!user) return;

      const now = Date.now();
      const lastWork = user.last_work_time
        ? new Date(user.last_work_time).getTime()
        : 0;
      const hoursSince = (now - lastWork) / 3_600_000;

      if (hoursSince < config.WORK_MIN_COOLDOWN_HOURS) {
        const remainMins = Math.ceil(
          (config.WORK_MIN_COOLDOWN_HOURS * 3_600_000 - (now - lastWork)) / 60_000
        );
        await ctx.reply(
          `⏳ <b>Слишком рано!</b>\n\nСледующий ворк через <b>${remainMins} мин.</b>`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const hoursWorked = Math.min(hoursSince, config.WORK_MAX_HOURS);
      const hourlyRate =
        config.WORK_MIN_HOURLY +
        Math.floor(Math.random() * (config.WORK_MAX_HOURLY - config.WORK_MIN_HOURLY + 1));
      const reward = Math.round(hoursWorked * hourlyRate);

      await addWorkReward(ctx.from.id, reward);

      const descriptions = [
        "разгружал вагоны", "писал код", "торговал на бирже", "водил такси",
        "доставлял пиццу", "майнил крипту", "стриг газоны", "ремонтировал технику",
        "работал барменом", "консультировал клиентов", "переводил документы",
        "монтировал видео", "дизайнил интерфейсы", "проводил аудит",
      ];
      const desc = descriptions[Math.floor(Math.random() * descriptions.length)];

      await ctx.reply(
        `💼 <b>Ворк завершён!</b>\n\n` +
        `Ты <b>${desc}</b> ${hoursWorked.toFixed(1)} ч.\n` +
        `Ставка: <b>${fmt(hourlyRate)} 💎/ч</b>\n\n` +
        `🎉 Заработано: <b>+${fmt(reward)} 💎</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("[work] Error:", err);
    }
  });
}
