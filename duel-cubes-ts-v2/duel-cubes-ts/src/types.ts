export interface SessionData {
  ladderStep: number | null;
  ladderBet: number | null;
  ladderLastActivity: number | null;
}

export type BotContext = import("grammy").Context & {
  session: SessionData;
};
