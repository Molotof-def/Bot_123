import { Bot, session } from "grammy";
import type { SessionData, BotContext } from "./types.js";
import { config } from "./config.js";
import { initSchema } from "./db.js";
import { startHttpServer } from "./server.js";

// Импорты всех хэндлеров
import { registerBalanceHandlers } from "./handlers/balance.js";
import { registerWorkHandlers } from "./handlers/work.js";
import { registerGameHandlers } from "./handlers/games.js";
import { registerDuelHandlers } from "./handlers/duel.js";
import { registerSocialHandlers } from "./handlers/social.js";
import { registerClanHandlers } from "./handlers/clans.js";
import { registerCheckHandlers } from "./handlers/checks.js";
import { registerRpHandlers } from "./handlers/rp.js";
import { registerQuizHandlers } from "./handlers/quiz.js";
import { registerTopHandlers } from "./handlers/top.js";
import { registerAdminHandlers } from "./handlers/admin.js";
import { registerCaptchaHandlers } from "./handlers/captcha.js";
import { registerBusinessHandlers } from "./handlers/businesses.js";
import { registerSupportHandlers } from "./handlers/support.js";

// 1. Создаем бота на глобальном уровне файла:
export const bot = new Bot<BotContext>(config.BOT_TOKEN);

// 2. Сессии (с заполнением типов, чтобы убрать ошибку TS239 по session):
bot.use(
  session({
    initial: (): SessionData => ({
      ladderStep: 0,
      ladderBet: 0,
      ladderLastActivity: 0
    })
  })
);

// 3. Регистрация всех хэндлеров
registerBalanceHandlers(bot);
registerWorkHandlers(bot);
registerGameHandlers(bot);
registerDuelHandlers(bot);
registerSocialHandlers(bot);
registerClanHandlers(bot);
registerCheckHandlers(bot);
registerRpHandlers(bot);
registerQuizHandlers(bot);
registerTopHandlers(bot);
registerAdminHandlers(bot);
registerCaptchaHandlers(bot);
registerBusinessHandlers(bot);
registerSupportHandlers(bot);

// 4. Главная точка входа
async function main(): Promise<void> {
  // Запуск веб-сервера для Render
  startHttpServer();

  // Инициализация базы данных
  console.log("Запускаю initSchema()...");
  await initSchema();
  console.log("[DB] Schema OK");

  // Очистка старых вебхуков от прошлых запусков
  console.log("Сбрасываю старый webhook...");
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  console.log("Запускаю polling...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`🚀 [Bot] @${botInfo.username} УСПЕШНО ЗАПУЩЕН И ОТВЕЧАЕТ!`);
    }
  });
}

main().catch((err) => {
  console.error("❌ ФАТАЛЬНАЯ ОШИБКА ПРИ СТАРТЕ БОТА:", err);
});