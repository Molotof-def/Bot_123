import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import {
  getUser, deductBetAtomic, refundBet, creditWin, recordLoss, recordDraw,
  createDuel, getDuel, deleteDuel, setDuelStatus,
} from "../db.js";
import { config } from "../config.js";
import { parseAmount, fmt, generateId, displayName } from "../utils.js";
import { sendResult } from "../media.js";

interface KnbGame {
  chatId: number;
  challengerId: number;
  challengerName: string;
  opponentId: number;
  opponentName: string;
  bet: number;
  challengerChoice: string | null;
  opponentChoice: string | null;
  messageId: number;
  expiresAt: number;
}

const knbGames = new Map<string, KnbGame>();
const KNB_WINS: Record<string, string> = { rock: "scissors", scissors: "paper", paper: "rock" };
const KNB_LABELS: Record<string, string> = { rock: "🪨 Камень", scissors: "✂️ Ножницы", paper: "📄 Бумага" };

function knbKb(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🪨", `knb_${id}_rock`)
    .text("✂️", `knb_${id}_scissors`)
    .text("📄", `knb_${id}_paper`);
}

export function registerDuelHandlers(bot: Bot<BotContext>): void {
  // ── дуэль [ставка] ───────────────────────────────────────────────────────
  bot.hears(/^дуэль (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") {
        await ctx.reply("⚠️ Дуэли доступны только в группах!"); return;
      }
      const args = ctx.match[1].trim().split(/\s+/);
      const bet = parseAmount(args[0]);
      if (!bet) { await ctx.reply("❌ Пример: <code>дуэль 5000 @user</code>", { parse_mode: "HTML" }); return; }

      const replyUser = ctx.message?.reply_to_message?.from;
      const textMention = ctx.message?.entities?.find(e => e.type === "text_mention");
      let opponentId: number | null = null;
      let opponentName = "";

      if (replyUser && !replyUser.is_bot) {
        opponentId = replyUser.id; opponentName = displayName(replyUser);
      } else if (textMention?.type === "text_mention" && textMention.user) {
        opponentId = textMention.user.id; opponentName = displayName(textMention.user);
      }
      if (!opponentId) { await ctx.reply("❌ Укажи соперника (ответь на сообщение или упомяни @username)."); return; }
      if (opponentId === ctx.from.id) { await ctx.reply("🤡 Нельзя вызвать самого себя!"); return; }

      const challenger = await getUser(ctx.from.id);
      if (!challenger || challenger.balance < bet) { await ctx.reply("❌ Недостаточно средств!"); return; }

      const ok = await deductBetAtomic(ctx.from.id, bet);
      if (!ok) { await ctx.reply("❌ Недостаточно средств!"); return; }

      const duelId = generateId();
      await createDuel({
        duel_id: duelId,
        chat_id: ctx.chat.id,
        challenger_id: ctx.from.id,
        challenger_name: displayName(ctx.from),
        opponent_id: opponentId,
        opponent_name: opponentName,
        bet,
        comment: "",
        status: "pending",
      });

      const kb = new InlineKeyboard()
        .text("✅ Принять", `duel_accept_${duelId}`)
        .text("❌ Отклонить", `duel_decline_${duelId}`);

      const msg = await ctx.reply(
        `⚔️ <b>ДУЭЛЬ!</b>\n\n<b>${displayName(ctx.from)}</b> вызывает <b>${opponentName}</b>!\n💰 Ставка: <b>${fmt(bet)} 💎</b>\n\n⏱️ 2 минуты на ответ.`,
        { parse_mode: "HTML", reply_markup: kb }
      );

      setTimeout(async () => {
        const d = await getDuel(duelId);
        if (d && d.status === "pending") {
          await refundBet(ctx.from!.id, bet);
          await deleteDuel(duelId);
          try {
            await ctx.api.editMessageText(ctx.chat!.id, msg.message_id,
              `⏱️ <b>Дуэль истекла.</b> Ставка возвращена.`, { parse_mode: "HTML" }
            );
          } catch { /* ignored */ }
        }
      }, config.DUEL_EXPIRY_MS);
    } catch (err) { console.error("[duel] Error:", err); }
  });

  bot.callbackQuery(/^duel_accept_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const duelId = ctx.match[1];
    const duel = await getDuel(duelId);
    if (!duel || duel.status !== "pending") { await ctx.editMessageText("❌ Дуэль уже завершена."); return; }
    if (ctx.from.id !== duel.opponent_id) { await ctx.answerCallbackQuery("❌ Это не твоя дуэль!"); return; }

    const ok = await deductBetAtomic(ctx.from.id, duel.bet);
    if (!ok) { await ctx.answerCallbackQuery("❌ Недостаточно средств!"); return; }

    await setDuelStatus(duelId, "active");
    const cr = Math.ceil(Math.random() * 6);
    const or = Math.ceil(Math.random() * 6);

    let caption: string;
    let img: string;
    if (cr > or) {
      const payout = Math.round(duel.bet * 2);
      await creditWin(duel.challenger_id, payout);
      await recordLoss(duel.opponent_id);
      img = config.WIN_IMG;
      caption = `⚔️ <b>ДУЭЛЬ ЗАВЕРШЕНА</b>\n\n<b>${duel.challenger_name}</b> 🆚 <b>${duel.opponent_name}</b>\n🎲 ${cr} vs ${or}\n\n🏆 Победил <b>${duel.challenger_name}</b>!\n💰 +<b>${fmt(payout)} 💎</b>`;
    } else if (cr < or) {
      const payout = Math.round(duel.bet * 2);
      await creditWin(duel.opponent_id, payout);
      await recordLoss(duel.challenger_id);
      img = config.WIN_IMG;
      caption = `⚔️ <b>ДУЭЛЬ ЗАВЕРШЕНА</b>\n\n<b>${duel.challenger_name}</b> 🆚 <b>${duel.opponent_name}</b>\n🎲 ${cr} vs ${or}\n\n🏆 Победил <b>${duel.opponent_name}</b>!\n💰 +<b>${fmt(payout)} 💎</b>`;
    } else {
      await refundBet(duel.challenger_id, duel.bet);
      await refundBet(duel.opponent_id, duel.bet);
      await recordDraw(duel.challenger_id);
      await recordDraw(duel.opponent_id);
      img = config.DRAW_IMG;
      caption = `⚔️ <b>ДУЭЛЬ ЗАВЕРШЕНА</b>\n\n<b>${duel.challenger_name}</b> 🆚 <b>${duel.opponent_name}</b>\n🎲 ${cr} vs ${or}\n\n🤝 <b>Ничья!</b> Ставки возвращены.`;
    }
    await deleteDuel(duelId);
    await ctx.deleteMessage().catch(() => {});
    await sendResult(ctx, { imageUrl: img, caption });
  });

  bot.callbackQuery(/^duel_decline_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const duelId = ctx.match[1];
    const duel = await getDuel(duelId);
    if (!duel) { await ctx.editMessageText("❌ Дуэль не найдена."); return; }
    if (ctx.from.id !== duel.opponent_id && ctx.from.id !== duel.challenger_id) {
      await ctx.answerCallbackQuery("❌ Это не твоя дуэль!"); return;
    }
    await refundBet(duel.challenger_id, duel.bet);
    await deleteDuel(duelId);
    await ctx.editMessageText(`❌ <b>Дуэль отклонена.</b> Ставка возвращена.`, { parse_mode: "HTML" });
  });

  // ── кнб [ставка] @user ───────────────────────────────────────────────────
  bot.hears(/^кнб (.+)$/i, async (ctx) => {
    try {
      if (!ctx.from || !ctx.chat || ctx.chat.type === "private") {
        await ctx.reply("⚠️ КНБ доступно только в группах!"); return;
      }
      const args = ctx.match[1].trim().split(/\s+/);
      const bet = parseAmount(args[0]);
      if (!bet) { await ctx.reply("❌ Пример: <code>кнб 5000 @user</code>", { parse_mode: "HTML" }); return; }

      const replyUser = ctx.message?.reply_to_message?.from;
      const mention = ctx.message?.entities?.find(e => e.type === "text_mention");
      let opponentId: number | null = null;
      let opponentName = "";

      if (replyUser && !replyUser.is_bot) {
        opponentId = replyUser.id; opponentName = displayName(replyUser);
      } else if (mention?.type === "text_mention" && mention.user) {
        opponentId = mention.user.id; opponentName = displayName(mention.user);
      }
      if (!opponentId) { await ctx.reply("❌ Укажи соперника."); return; }
      if (opponentId === ctx.from.id) { await ctx.reply("🤡 Нельзя играть с собой!"); return; }

      const user = await getUser(ctx.from.id);
      if (!user || user.balance < bet) { await ctx.reply("❌ Недостаточно средств!"); return; }
      const ok = await deductBetAtomic(ctx.from.id, bet);
      if (!ok) { await ctx.reply("❌ Недостаточно средств!"); return; }

      const id = generateId();
      const msg = await ctx.reply(
        `✊ <b>КАМЕНЬ-НОЖНИЦЫ-БУМАГА!</b>\n\n<b>${displayName(ctx.from)}</b> 🆚 <b>${opponentName}</b>\n💰 Ставка: <b>${fmt(bet)} 💎</b>\n\nОба делают выбор. ⏱️ 3 минуты.`,
        { parse_mode: "HTML", reply_markup: knbKb(id) }
      );

      knbGames.set(id, {
        chatId: ctx.chat.id,
        challengerId: ctx.from.id,
        challengerName: displayName(ctx.from),
        opponentId,
        opponentName,
        bet,
        challengerChoice: null,
        opponentChoice: null,
        messageId: msg.message_id,
        expiresAt: Date.now() + config.KNB_EXPIRY_MS,
      });

      setTimeout(async () => {
        const g = knbGames.get(id);
        if (g) {
          knbGames.delete(id);
          await refundBet(g.challengerId, g.bet);
          if (g.opponentChoice !== null) await refundBet(g.opponentId, g.bet);
          try {
            await ctx.api.editMessageText(g.chatId, g.messageId,
              "⏱️ <b>КНБ истекло.</b> Ставки возвращены.", { parse_mode: "HTML" }
            );
          } catch { /* ignored */ }
        }
      }, config.KNB_EXPIRY_MS);
    } catch (err) { console.error("[knb] Error:", err); }
  });

  bot.callbackQuery(/^knb_([^_]+)_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    const choice = ctx.match[2];
    const g = knbGames.get(id);
    if (!g) { await ctx.answerCallbackQuery("❌ Игра истекла."); return; }
    if (Date.now() > g.expiresAt) { knbGames.delete(id); await ctx.answerCallbackQuery("⏱️ Время вышло."); return; }

    const isChallenger = ctx.from.id === g.challengerId;
    const isOpponent = ctx.from.id === g.opponentId;
    if (!isChallenger && !isOpponent) { await ctx.answerCallbackQuery("❌ Это не твоя игра!"); return; }

    if (isChallenger) {
      if (g.challengerChoice) { await ctx.answerCallbackQuery("✅ Выбор уже сделан!"); return; }
      g.challengerChoice = choice;
      await ctx.answerCallbackQuery(`✅ ${KNB_LABELS[choice]} — ждём соперника.`);
    } else {
      if (g.opponentChoice) { await ctx.answerCallbackQuery("✅ Выбор уже сделан!"); return; }
      const opOk = await deductBetAtomic(ctx.from.id, g.bet);
      if (!opOk) { await ctx.answerCallbackQuery("❌ Недостаточно средств!"); return; }
      g.opponentChoice = choice;
      await ctx.answerCallbackQuery(`✅ ${KNB_LABELS[choice]} — ждём результата.`);
    }

    if (!g.challengerChoice || !g.opponentChoice) return;

    knbGames.delete(id);
    const cc = g.challengerChoice;
    const oc = g.opponentChoice;
    let caption: string;
    let img: string;

    if (cc === oc) {
      await refundBet(g.challengerId, g.bet);
      await refundBet(g.opponentId, g.bet);
      img = config.DRAW_IMG;
      caption = `✊ <b>КНБ — НИЧЬЯ!</b>\n${KNB_LABELS[cc]} vs ${KNB_LABELS[oc]}\n\nСтавки возвращены.`;
    } else if (KNB_WINS[cc] === oc) {
      const payout = Math.round(g.bet * 2);
      await creditWin(g.challengerId, payout);
      await recordLoss(g.opponentId);
      img = config.WIN_IMG;
      caption = `✊ <b>КНБ ЗАВЕРШЕНО!</b>\n${KNB_LABELS[cc]} vs ${KNB_LABELS[oc]}\n\n🏆 Победил <b>${g.challengerName}</b>!\n💰 +<b>${fmt(payout)} 💎</b>`;
    } else {
      const payout = Math.round(g.bet * 2);
      await creditWin(g.opponentId, payout);
      await recordLoss(g.challengerId);
      img = config.WIN_IMG;
      caption = `✊ <b>КНБ ЗАВЕРШЕНО!</b>\n${KNB_LABELS[cc]} vs ${KNB_LABELS[oc]}\n\n🏆 Победил <b>${g.opponentName}</b>!\n💰 +<b>${fmt(payout)} 💎</b>`;
    }

    try {
      await ctx.api.deleteMessage(g.chatId, g.messageId);
    } catch { /* ignored */ }
    await sendResult(ctx, { imageUrl: img, caption });
  });
}
