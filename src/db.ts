import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export const DATA_DIR = process.env.HARDDROP_DATA_DIR || path.join(process.cwd(), "data");

export function openDb(file = "harddrop.db"): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, file));
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      initial_board TEXT NOT NULL,
      sequence TEXT NOT NULL,      -- JSON: [{type, rotation, left?}]
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS steps (
      game_id INTEGER NOT NULL,
      step INTEGER NOT NULL,       -- 1-based 步号
      status TEXT NOT NULL,        -- 'ok' | 'failed'
      piece TEXT NOT NULL,         -- JSON: {type, rotation, left}
      result TEXT NOT NULL,        -- JSON: DropResult
      board_after TEXT NOT NULL,   -- JSON: Board（失败时为未变化的棋盘）
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game_id, step)
    );
  `);
  return db;
}
