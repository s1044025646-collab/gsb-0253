import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Board, StepResult, validateBoard, hardDrop } from './engine';
import { PieceType, isPieceType } from './pieces';
import { ApiError } from './errors';

export interface GameRow {
  id: number;
  height: number;
  width: number;
  initial_board: string;
  sequence: string;
  current_step: number;
  created_at: string;
}

export interface StepRow {
  game_id: number;
  step: number;
  piece: string;
  rotation: number;
  column: number;
  landing_row: number;
  drop_distance: number;
  locked_cells: string;
  cleared_rows: string;
  board_after: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        height INTEGER NOT NULL,
        width INTEGER NOT NULL,
        initial_board TEXT NOT NULL,
        sequence TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS steps (
        game_id INTEGER NOT NULL,
        step INTEGER NOT NULL,
        piece TEXT NOT NULL,
        rotation INTEGER NOT NULL,
        column INTEGER NOT NULL,
        landing_row INTEGER NOT NULL,
        drop_distance INTEGER NOT NULL,
        locked_cells TEXT NOT NULL,
        cleared_rows TEXT NOT NULL,
        board_after TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (game_id, step)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createGame(initialBoard: Board, sequence: PieceType[]): number {
    validateBoard(initialBoard);
    if (!Array.isArray(sequence) || sequence.length === 0 || sequence.length > 10000) {
      throw new ApiError('INVALID_SEQUENCE', '方块序列必须是 1~10000 个元素');
    }
    for (const p of sequence) {
      if (!isPieceType(p)) throw new ApiError('INVALID_SEQUENCE', `非法方块类型: ${String(p)}`);
    }
    const stmt = this.db.prepare(
      'INSERT INTO games (height, width, initial_board, sequence) VALUES (?, ?, ?, ?)',
    );
    const r = stmt.run(
      initialBoard.length,
      initialBoard[0].length,
      JSON.stringify(initialBoard),
      JSON.stringify(sequence),
    );
    return Number(r.lastInsertRowid);
  }

  getGame(id: number): GameRow {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    if (!row) throw new ApiError('GAME_NOT_FOUND', `对局 ${id} 不存在`, 404);
    return row;
  }

  listGames(): GameRow[] {
    return this.db.prepare('SELECT * FROM games ORDER BY id').all() as unknown as GameRow[];
  }

  currentBoard(id: number): Board {
    const game = this.getGame(id);
    if (game.current_step === 0) return JSON.parse(game.initial_board) as Board;
    const step = this.getStep(id, game.current_step);
    return JSON.parse(step.board_after) as Board;
  }

  getStep(gameId: number, step: number): StepRow {
    const row = this.db
      .prepare('SELECT * FROM steps WHERE game_id = ? AND step = ?')
      .get(gameId, step) as StepRow | undefined;
    if (!row) throw new ApiError('STEP_NOT_FOUND', `对局 ${gameId} 不存在第 ${step} 步`, 404);
    return row;
  }

  listSteps(gameId: number): StepRow[] {
    this.getGame(gameId);
    return this.db
      .prepare('SELECT * FROM steps WHERE game_id = ? ORDER BY step')
      .all(gameId) as unknown as StepRow[];
  }

  /**
   * 执行一步。expectedStep 必须等于 current_step + 1；
   * 重复提交或跳号一律拒绝且不改变状态。
   */
  playStep(gameId: number, rotation: number, column: number, expectedStep: number): StepResult {
    const game = this.getGame(gameId);
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
      throw new ApiError('INVALID_ROTATION', '朝向必须是 0~3 的整数');
    }
    if (!Number.isInteger(column)) {
      throw new ApiError('INVALID_COLUMN', '列必须是非负整数');
    }
    if (!Number.isInteger(expectedStep) || expectedStep !== game.current_step + 1) {
      throw new ApiError(
        'STALE_STEP',
        `预期步号应为 ${game.current_step + 1}，收到 ${expectedStep}；重复或陈旧步号已被拒绝`,
        409,
      );
    }
    const sequence = JSON.parse(game.sequence) as PieceType[];
    if (game.current_step >= sequence.length) {
      throw new ApiError('SEQUENCE_EXHAUSTED', '方块序列已用完', 409);
    }
    const piece = sequence[game.current_step];
    const board = this.currentBoard(gameId);
    const result = hardDrop(board, piece, rotation, column, expectedStep);
    this.db.prepare(
      `INSERT INTO steps (game_id, step, piece, rotation, column, landing_row, drop_distance, locked_cells, cleared_rows, board_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      gameId,
      expectedStep,
      piece,
      rotation,
      column,
      result.landingRow,
      result.dropDistance,
      JSON.stringify(result.lockedCells),
      JSON.stringify(result.clearedRows),
      JSON.stringify(result.board),
    );
    this.db.prepare('UPDATE games SET current_step = ? WHERE id = ?').run(expectedStep, gameId);
    return result;
  }

  /** 从头回放：逐步重放事件并核对每步棋盘与记录一致，返回最终棋盘。 */
  replay(gameId: number): { board: Board; stepsChecked: number } {
    const game = this.getGame(gameId);
    let board = JSON.parse(game.initial_board) as Board;
    const steps = this.listSteps(gameId);
    for (const s of steps) {
      const result = hardDrop(board, s.piece as PieceType, s.rotation, s.column, s.step);
      if (JSON.stringify(result.board) !== s.board_after) {
        throw new ApiError('BAD_REQUEST', `回放第 ${s.step} 步与记录不一致`, 500);
      }
      board = result.board;
    }
    return { board, stepsChecked: steps.length };
  }
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), 'data', 'tetris.db');
}
