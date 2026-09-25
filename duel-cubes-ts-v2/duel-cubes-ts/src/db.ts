import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected error on idle PostgreSQL client:", err);
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  user_id: number;
  username: string;
  tg_username: string | null;
  custom_nick: string | null;
  referrer_id: number | null;
  balance: number;
  turnover: number;
  wins: number;
  losses: number;
  draws: number;
  warns: number;
  clan_id: number | null;
  spouse_id: number | null;
  marriage_date: Date | null;
  last_work_time: Date | null;
  last_active: Date;
  sponsor_bonus_claimed: boolean;
  claimed_promos: string[];
  created_at: Date;
}

export interface Clan {
  clan_id: number;
  name: string;
  tag: string;
  owner_id: number;
  balance: number;
  rating: number;
  created_at: Date;
}

export interface UserBusiness {
  id: number;
  user_id: number;
  business_key: string;
  last_collect: Date;
  created_at: Date;
}

export interface ActiveDuel {
  duel_id: string;
  chat_id: number;
  challenger_id: number;
  challenger_name: string;
  opponent_id: number;
  opponent_name: string;
  bet: number;
  comment: string;
  status: string;
  created_at: Date;
}

// ─── Schema init with safe migrations ────────────────────────────────────────

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    // Core tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT NOT NULL,
        tg_username TEXT,
        custom_nick TEXT DEFAULT NULL,
        referrer_id BIGINT DEFAULT NULL,
        balance BIGINT DEFAULT 10000 CHECK (balance >= 0),
        turnover BIGINT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        draws INT DEFAULT 0,
        warns INT DEFAULT 0,
        clan_id BIGINT DEFAULT NULL,
        spouse_id BIGINT DEFAULT NULL,
        marriage_date TIMESTAMP DEFAULT NULL,
        last_work_time TIMESTAMP DEFAULT NULL,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sponsor_bonus_claimed BOOLEAN DEFAULT FALSE,
        claimed_promos TEXT[] DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clans (
        clan_id BIGSERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        tag TEXT UNIQUE NOT NULL,
        owner_id BIGINT NOT NULL,
        balance BIGINT DEFAULT 0 CHECK (balance >= 0),
        rating BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_businesses (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
        business_key TEXT NOT NULL,
        last_collect TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, business_key)
      );

      CREATE TABLE IF NOT EXISTS chat_admins (
        chat_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        msg_count BIGINT DEFAULT 0,
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS chat_settings (
        chat_id BIGINT PRIMARY KEY,
        rp_enabled BOOLEAN DEFAULT TRUE,
        bot_enabled BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS chat_rules (
        chat_id BIGINT PRIMARY KEY,
        rules TEXT,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS active_duels (
        duel_id TEXT PRIMARY KEY,
        chat_id BIGINT,
        challenger_id BIGINT,
        challenger_name TEXT,
        opponent_id BIGINT,
        opponent_name TEXT,
        bet BIGINT,
        comment TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe migrations — add columns that may not exist in older installs
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_nick TEXT DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS claimed_promos TEXT[] DEFAULT ARRAY[]::TEXT[]`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS spouse_id BIGINT DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS marriage_date TIMESTAMP DEFAULT NULL`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS sponsor_bonus_claimed BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN DEFAULT TRUE`,
      `ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS rp_enabled BOOLEAN DEFAULT TRUE`,
    ];
    for (const sql of migrations) {
      await client.query(sql).catch(() => {/* column already exists */});
    }

    console.log("[DB] Schema OK");
  } finally {
    client.release();
  }
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function getOrCreateUser(
  userId: number,
  username: string,
  tgUsername: string | null
): Promise<User> {
  const res = await pool.query<User>(
    `INSERT INTO users (user_id, username, tg_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET username = EXCLUDED.username,
           tg_username = EXCLUDED.tg_username,
           last_active = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, username, tgUsername]
  );
  return res.rows[0];
}

export async function getUser(userId: number): Promise<User | null> {
  const res = await pool.query<User>(
    `SELECT * FROM users WHERE user_id = $1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

/** Atomically deduct bet + increment turnover. Returns false if insufficient funds. */
export async function deductBetAtomic(userId: number, bet: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE users
     SET balance = balance - $1,
         turnover = turnover + $1,
         last_active = CURRENT_TIMESTAMP
     WHERE user_id = $2 AND balance >= $1
     RETURNING balance`,
    [Math.round(bet), userId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function refundBet(userId: number, bet: number): Promise<void> {
  await pool.query(
    `UPDATE users SET balance = balance + $1, last_active = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [Math.round(bet), userId]
  );
}

export async function creditWin(userId: number, payout: number): Promise<void> {
  await pool.query(
    `UPDATE users
     SET balance = balance + $1, wins = wins + 1, last_active = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    [Math.round(payout), userId]
  );
}

export async function recordLoss(userId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET losses = losses + 1, last_active = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId]
  );
}

export async function recordDraw(userId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET draws = draws + 1, last_active = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId]
  );
}

export async function addBalance(userId: number, amount: number): Promise<void> {
  await pool.query(
    `UPDATE users SET balance = balance + $1, last_active = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [Math.round(amount), userId]
  );
}

/** Transfer with fee burn. Returns false if sender has insufficient funds. */
export async function transferMoney(
  senderId: number,
  recipientId: number,
  amount: number,
  received: number
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [lo, hi] = senderId < recipientId
      ? [senderId, recipientId]
      : [recipientId, senderId];
    await client.query(`SELECT balance FROM users WHERE user_id = $1 FOR UPDATE`, [lo]);
    await client.query(`SELECT balance FROM users WHERE user_id = $1 FOR UPDATE`, [hi]);
    const res = await client.query(
      `UPDATE users
       SET balance = balance - $1, turnover = turnover + $1, last_active = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
      [Math.round(amount), senderId]
    );
    if ((res.rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `UPDATE users SET balance = balance + $1, last_active = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [Math.round(received), recipientId]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function addWorkReward(userId: number, reward: number): Promise<void> {
  await pool.query(
    `UPDATE users
     SET balance = balance + $1, last_work_time = CURRENT_TIMESTAMP, last_active = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    [Math.round(reward), userId]
  );
}

export async function setCustomNick(userId: number, nick: string): Promise<void> {
  await pool.query(
    `UPDATE users SET custom_nick = $1, last_active = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [nick, userId]
  );
}

export async function addWarn(userId: number): Promise<number> {
  const res = await pool.query<{ warns: number }>(
    `UPDATE users SET warns = warns + 1 WHERE user_id = $1 RETURNING warns`,
    [userId]
  );
  return res.rows[0]?.warns ?? 0;
}

export async function resetWarns(userId: number): Promise<void> {
  await pool.query(`UPDATE users SET warns = 0 WHERE user_id = $1`, [userId]);
}

// ─── Marriage ─────────────────────────────────────────────────────────────────

export async function marry(userId1: number, userId2: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [lo, hi] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
    const check = await client.query(
      `SELECT spouse_id FROM users WHERE user_id IN ($1, $2) FOR UPDATE`,
      [lo, hi]
    );
    if (check.rows.some((r) => r.spouse_id !== null)) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `UPDATE users SET spouse_id = $1, marriage_date = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [userId2, userId1]
    );
    await client.query(
      `UPDATE users SET spouse_id = $1, marriage_date = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [userId1, userId2]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function divorce(
  initiatorId: number,
  spouseId: number,
  alimony: number
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [lo, hi] = initiatorId < spouseId
      ? [initiatorId, spouseId]
      : [spouseId, initiatorId];
    await client.query(
      `SELECT balance FROM users WHERE user_id IN ($1, $2) FOR UPDATE`,
      [lo, hi]
    );
    const res = await client.query(
      `UPDATE users
       SET balance = balance - $1, spouse_id = NULL, marriage_date = NULL, last_active = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
      [Math.round(alimony), initiatorId]
    );
    if ((res.rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `UPDATE users
       SET balance = balance + $1, spouse_id = NULL, marriage_date = NULL, last_active = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [Math.round(alimony), spouseId]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Clans ────────────────────────────────────────────────────────────────────

export async function createClan(
  name: string,
  tag: string,
  ownerId: number
): Promise<Clan | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<Clan>(
      `INSERT INTO clans (name, tag, owner_id) VALUES ($1, $2, $3) RETURNING *`,
      [name, tag, ownerId]
    );
    await client.query(
      `UPDATE users SET clan_id = $1 WHERE user_id = $2`,
      [res.rows[0].clan_id, ownerId]
    );
    await client.query("COMMIT");
    return res.rows[0];
  } catch {
    await client.query("ROLLBACK");
    return null;
  } finally {
    client.release();
  }
}

export async function getClan(clanId: number): Promise<Clan | null> {
  const res = await pool.query<Clan>(`SELECT * FROM clans WHERE clan_id = $1`, [clanId]);
  return res.rows[0] ?? null;
}

export async function getClanByTag(tag: string): Promise<Clan | null> {
  const res = await pool.query<Clan>(
    `SELECT * FROM clans WHERE LOWER(tag) = LOWER($1)`,
    [tag]
  );
  return res.rows[0] ?? null;
}

export async function getClanMembers(clanId: number): Promise<User[]> {
  const res = await pool.query<User>(
    `SELECT * FROM users WHERE clan_id = $1 ORDER BY balance DESC`,
    [clanId]
  );
  return res.rows;
}

export async function depositToClan(
  userId: number,
  clanId: number,
  amount: number
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `UPDATE users
       SET balance = balance - $1, turnover = turnover + $1, last_active = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
      [Math.round(amount), userId]
    );
    if ((res.rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `UPDATE clans SET balance = balance + $1, rating = rating + $1 WHERE clan_id = $2`,
      [Math.round(amount), clanId]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export async function getTopByBalance(limit = 10): Promise<User[]> {
  const res = await pool.query<User>(
    `SELECT * FROM users ORDER BY balance DESC LIMIT $1`, [limit]
  );
  return res.rows;
}

export async function getTopByTurnover(limit = 10): Promise<User[]> {
  const res = await pool.query<User>(
    `SELECT * FROM users ORDER BY turnover DESC LIMIT $1`, [limit]
  );
  return res.rows;
}

export async function getTopByWins(limit = 10): Promise<User[]> {
  const res = await pool.query<User>(
    `SELECT * FROM users ORDER BY wins DESC LIMIT $1`, [limit]
  );
  return res.rows;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function incrementMsgCount(chatId: number, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO chat_members (chat_id, user_id, msg_count) VALUES ($1, $2, 1)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET msg_count = chat_members.msg_count + 1`,
    [chatId, userId]
  );
}

export async function getChatTopMessages(
  chatId: number,
  limit = 10
): Promise<Array<{ user_id: number; msg_count: number; username: string }>> {
  const res = await pool.query(
    `SELECT cm.user_id, cm.msg_count, u.username
     FROM chat_members cm JOIN users u ON u.user_id = cm.user_id
     WHERE cm.chat_id = $1 ORDER BY cm.msg_count DESC LIMIT $2`,
    [chatId, limit]
  );
  return res.rows;
}

export async function getChatSettings(
  chatId: number
): Promise<{ rp_enabled: boolean; bot_enabled: boolean }> {
  await pool.query(
    `INSERT INTO chat_settings (chat_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [chatId]
  );
  const res = await pool.query<{ rp_enabled: boolean; bot_enabled: boolean }>(
    `SELECT rp_enabled, bot_enabled FROM chat_settings WHERE chat_id = $1`,
    [chatId]
  );
  return res.rows[0] ?? { rp_enabled: true, bot_enabled: true };
}

export async function setChatSetting(
  chatId: number,
  field: "rp_enabled" | "bot_enabled",
  value: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_settings (chat_id, ${field}) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET ${field} = EXCLUDED.${field}`,
    [chatId, value]
  );
}

export async function getChatRules(chatId: number): Promise<string | null> {
  const res = await pool.query<{ rules: string }>(
    `SELECT rules FROM chat_rules WHERE chat_id = $1`,
    [chatId]
  );
  return res.rows[0]?.rules ?? null;
}

export async function setChatRules(
  chatId: number,
  rules: string,
  updatedBy: string
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_rules (chat_id, rules, updated_by, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (chat_id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [chatId, rules, updatedBy]
  );
}

export async function syncChatAdmins(chatId: number, adminIds: number[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM chat_admins WHERE chat_id = $1`, [chatId]);
    for (const id of adminIds) {
      await client.query(
        `INSERT INTO chat_admins (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [chatId, id]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Businesses ───────────────────────────────────────────────────────────────

export async function getUserBusiness(
  userId: number,
  key: string
): Promise<UserBusiness | null> {
  const res = await pool.query<UserBusiness>(
    `SELECT * FROM user_businesses WHERE user_id = $1 AND business_key = $2`,
    [userId, key]
  );
  return res.rows[0] ?? null;
}

export async function getAllUserBusinesses(userId: number): Promise<UserBusiness[]> {
  const res = await pool.query<UserBusiness>(
    `SELECT * FROM user_businesses WHERE user_id = $1`,
    [userId]
  );
  return res.rows;
}

export async function buyBusiness(
  userId: number,
  key: string,
  cost: number
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `UPDATE users SET balance = balance - $1, turnover = turnover + $1, last_active = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
      [Math.round(cost), userId]
    );
    if ((res.rowCount ?? 0) === 0) { await client.query("ROLLBACK"); return false; }
    await client.query(
      `INSERT INTO user_businesses (user_id, business_key, last_collect) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [userId, key]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function collectBusiness(
  userId: number,
  key: string,
  income: number
): Promise<void> {
  await pool.query(
    `UPDATE user_businesses SET last_collect = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND business_key = $2`,
    [userId, key]
  );
  await pool.query(
    `UPDATE users SET balance = balance + $1, last_active = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [Math.round(income), userId]
  );
}

// ─── Duels ────────────────────────────────────────────────────────────────────

export async function createDuel(d: Omit<ActiveDuel, "created_at">): Promise<void> {
  await pool.query(
    `INSERT INTO active_duels
       (duel_id, chat_id, challenger_id, challenger_name, opponent_id, opponent_name, bet, comment, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [d.duel_id, d.chat_id, d.challenger_id, d.challenger_name,
     d.opponent_id, d.opponent_name, d.bet, d.comment, d.status]
  );
}

export async function getDuel(id: string): Promise<ActiveDuel | null> {
  const res = await pool.query<ActiveDuel>(
    `SELECT * FROM active_duels WHERE duel_id = $1`, [id]
  );
  return res.rows[0] ?? null;
}

export async function deleteDuel(id: string): Promise<void> {
  await pool.query(`DELETE FROM active_duels WHERE duel_id = $1`, [id]);
}

export async function setDuelStatus(id: string, status: string): Promise<void> {
  await pool.query(`UPDATE active_duels SET status = $1 WHERE duel_id = $2`, [status, id]);
}

// ─── Promo ────────────────────────────────────────────────────────────────────

export async function claimPromo(
  userId: number,
  code: string,
  reward: number
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE users
     SET claimed_promos = array_append(claimed_promos, $1),
         balance = balance + $2,
         last_active = CURRENT_TIMESTAMP
     WHERE user_id = $3 AND NOT ($1 = ANY(claimed_promos))
     RETURNING user_id`,
    [code, Math.round(reward), userId]
  );
  return (res.rowCount ?? 0) > 0;
}
