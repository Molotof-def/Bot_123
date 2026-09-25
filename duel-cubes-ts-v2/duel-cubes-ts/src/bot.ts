import { Bot, session, GrammyError, HttpError } from "grammy";
import type { SessionData, BotContext } from "./types.js";
import { config } from "./config.js";
import { initSchema, pool, getOrCreateUser, incrementMsgCount, getChatSettings } from "./db.js";
import { startHttpServer } from "./server.js";
import { displayName } from "./utils.js";

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

async function main(): Promise<void> {
  // 1. HTTP keepalive — must bind before anything else to pass Render port scan
  startHttpServer();

  // 2. DB schema + safe migrations
  await initSchema();

  // 3. Bot
  const bot = new Bot<BotContext>(config.BOT_TOKEN);

  // 4. Session (in-memory, per chat+user)
  bot.use(session({
    initial: (): SessionData => ({
      ladderStep: null,
      ladderBet: null,
      ladderLastActivity: null,
    }),
    getSessionKey: (ctx) =>
      ctx.chat && ctx.from ? `${ctx.chat.id}_${ctx.from.id}` : undefined,
  }));

  // 5. Global middleware — user upsert + message count + bot_enabled gate
  bot.use(async (ctx, next) => {
    try {
      const from = ctx.from;
      if (from && !from.is_bot) {
        const name = displayName(from);
        await getOrCreateUser(from.id, name, from.username ?? null);
        const chat = ctx.chat;
        if (chat && chat.type !== "private" && ctx.message) {
          await incrementMsgCount(chat.id, from.id).catch(() => {});
          // Respect bot_enabled setting (skip for admins/commands)
          if (ctx.message.text && !ctx.message.text.startsWith("/")) {
            const settings = await getChatSettings(chat.id).catch(() => ({ bot_enabled: true, rp_enabled: true }));
            if (!settings.bot_enabled) return; // silently ignore
          }
        }
      }
    } catch (err) {
      console.error("[MW] Error:", err);
    }
    await next();
  });

  // 6. Register handlers (specific before generic)
  registerCaptchaHandlers(bot);
  registerAdminHandlers(bot);
  registerBalanceHandlers(bot);
  registerWorkHandlers(bot);
  registerBusinessHandlers(bot);
  registerSocialHandlers(bot);
  registerClanHandlers(bot);
  registerCheckHandlers(bot);
  registerDuelHandlers(bot);
  registerGameHandlers(bot);
  registerTopHandlers(bot);
  registerQuizHandlers(bot);
  registerSupportHandlers(bot);
  registerRpHandlers(bot); // last — broad regex

  // 7. Error handler
  bot.catch((err) => {
    console.error(`[Bot] Update ${err.ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) console.error("[Bot] Telegram:", e.description);
    else if (e instanceof HttpError) console.error("[Bot] HTTP:", e);
    else console.error("[Bot] Unknown:", e);
  });

  // 8. Drop stale webhook → start polling
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  console.log("[Bot] Starting long polling...");

  await bot.start({
    allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"],
    onStart: (info) => console.log(`[Bot] @${info.username} running.`),
  });
}

process.once("SIGINT", async () => { await pool.end(); process.exit(0); });
process.once("SIGTERM", async () => { await pool.end(); process.exit(0); });

main().catch((err) => { console.error("[Fatal]", err); process.exit(1); });
