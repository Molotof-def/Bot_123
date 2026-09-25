import type { BotContext } from "./types.js";
import type { InlineKeyboardMarkup } from "grammy/types";

interface SendResultOptions {
  imageUrl: string;
  caption: string;
  replyMarkup?: InlineKeyboardMarkup;
}

/**
 * Send a game result with a banner image.
 * Falls back to plain text reply if the image CDN is unreachable.
 */
export async function sendResult(
  ctx: BotContext,
  opts: SendResultOptions
): Promise<void> {
  try {
    await ctx.replyWithPhoto(opts.imageUrl, {
      caption: opts.caption,
      parse_mode: "HTML",
      reply_markup: opts.replyMarkup,
    });
  } catch {
    // CDN failure — fallback to text
    await ctx.reply(opts.caption, {
      parse_mode: "HTML",
      reply_markup: opts.replyMarkup,
    });
  }
}
