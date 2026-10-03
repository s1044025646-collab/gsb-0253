import { DatabaseSync } from "node:sqlite";
import {
  Board, PieceType, PIECES, pieceCells, validateBoard, hardDrop, legalColumns, DropResult,
} from "./engine";
import { openDb } from "./db";

export class ApiError extends Error {
  constructor(public code: string, message: string, public http = 400) {
    super(message);
  }
}

export interface PieceInput { type: PieceType; rotation: number; left?: number }
export interface StepInput extends PieceInput { expectedStep: number; left: number }

function validatePiece(p: unknown, needLeft: boolean): asserts p is PieceInput {
  const o = p as PieceInput;
  if (!o || typeof o !== "object") throw new ApiError("BAD_PIECE", "方块参数必须是对象");
  if (!(o.type in PIECES)) throw new ApiError("BAD_PIECE", `未知方块类型: ${String(o.type)}`);
  if (!Number.isInteger(o.rotation) || o.rotation < 0 || o.rotation > 3)
    throw new ApiError("BAD_ROTATION", "rotation 必须是 0..3 的整数");
  if (needLeft && (!Number.isInteger((o as StepInput).left) || (o as StepInput).left < 0))
    throw new ApiError("BAD_COLUMN", "left 必须是非负整数");
}

export class GameService {
  constructor(private db: DatabaseSync = openDb()) {}

  createGame(board: unknown, sequence: unknown) {
    const err = validateBoard(board);
    if (err) throw new ApiError("BAD_BOARD", err);
    if (!Array.isArray(sequence) || sequence.length === 0 || sequence.length > 10000)
      throw new ApiError("BAD_SEQUENCE", "sequence 必须是 1..10000 个方块描述");
    sequence.forEach((p) => validatePiece(p, false));
    const b = board as Board;
    const info = this.db
      .prepare("INSERT INTO games (width, height, initial_board, sequence) VALUES (?,?,?,?)")
      .run(b[0].length, b.length, JSON.stringify(b), JSON.stringify(sequence));
    return { gameId: Number(info.lastInsertRowid), width: b[0].length, height: b.length };
  }

  private loadGame(gameId: number) {
    const g = this.db.prepare("SELECT * FROM games WHERE id=?").get(gameId) as
      | { id: number; width: number; height: number; initial_board: string; sequence: string }
      | undefined;
    if (!g) throw new ApiError("GAME_NOT_FOUND", `对局 ${gameId} 不存在`, 404);
    return {
      id: g.id,
      width: g.width,
      height: g.height,
      initialBoard: JSON.parse(g.initial_board) as Board,
      sequence: JSON.parse(g.sequence) as PieceInput[],
    };
  }

  private lastStep(gameId: number): number {
    const r = this.db.prepare("SELECT MAX(step) AS s FROM steps WHERE game_id=?").get(gameId) as { s: number | null };
    return r.s ?? 0;
  }

  private boardAt(gameId: number): Board {
    const r = this.db
      .prepare("SELECT board_after FROM steps WHERE game_id=? ORDER BY step DESC LIMIT 1")
      .get(gameId) as { board_after: string } | undefined;
    if (r) return JSON.parse(r.board_after);
    return this.loadGame(gameId).initialBoard;
  }

  getState(gameId: number) {
    const g = this.loadGame(gameId);
    const step = this.lastStep(gameId);
    return {
      gameId: g.id, width: g.width, height: g.height, step,
      nextPiece: g.sequence[step] ?? null,
      sequenceLength: g.sequence.length,
      board: this.boardAt(gameId),
    };
  }

  legalMoves(gameId: number) {
    const g = this.loadGame(gameId);
    const step = this.lastStep(gameId);
    const piece = g.sequence[step];
    if (!piece) throw new ApiError("SEQUENCE_DONE", "方块序列已全部执行完毕", 409);
    const board = this.boardAt(gameId);
    return { step: step + 1, piece, legalColumns: legalColumns(board, piece.type, piece.rotation) };
  }

  playStep(gameId: number, input: StepInput) {
    if (!Number.isInteger(input?.expectedStep) || input.expectedStep < 1)
      throw new ApiError("BAD_STEP", "expectedStep 必须是 >=1 的整数");
    validatePiece(input, true);
    const g = this.loadGame(gameId);
    const cur = this.lastStep(gameId);
    if (input.expectedStep <= cur) {
      const existing = this.getStep(gameId, input.expectedStep);
      throw new ApiError("STALE_STEP", `步号 ${input.expectedStep} 已执行（当前进度 ${cur}），拒绝重复落块`, 409);
    }
    if (input.expectedStep > cur + 1)
      throw new ApiError("STEP_GAP", `期望步号 ${input.expectedStep}，但当前进度为 ${cur}，请按顺序提交`, 409);
    const piece = g.sequence[cur];
    if (!piece) throw new ApiError("SEQUENCE_DONE", "方块序列已全部执行完毕", 409);
    if (piece.type !== input.type || piece.rotation !== input.rotation)
      throw new ApiError("PIECE_MISMATCH", `第 ${cur + 1} 步应为 ${piece.type}/rot${piece.rotation}`, 409);
    const board = this.boardAt(gameId);
    const maxC = Math.max(...pieceCells(input.type, input.rotation).map((c) => c[1]));
    if (input.left + maxC >= board[0].length)
      throw new ApiError("OUT_OF_BOUNDS", `横向位置 ${input.left} 越界（棋盘宽 ${board[0].length}）`);
    const result: DropResult = hardDrop(board, input.type, input.rotation, input.left);
    const boardAfter = result.ok ? result.boardAfter! : board; // 失败不改状态
    this.db
      .prepare("INSERT INTO steps (game_id, step, status, piece, result, board_after) VALUES (?,?,?,?,?,?)")
      .run(gameId, cur + 1, result.ok ? "ok" : "failed",
        JSON.stringify({ type: input.type, rotation: input.rotation, left: input.left }),
        JSON.stringify(result), JSON.stringify(boardAfter));
    return { step: cur + 1, status: result.ok ? "ok" : "failed", ...result, board: boardAfter };
  }

  playSequence(gameId: number, moves: { left: number }[]) {
    const cur = this.lastStep(gameId);
    const results = [];
    for (let i = 0; i < moves.length; i++) {
      const g = this.loadGame(gameId);
      const piece = g.sequence[this.lastStep(gameId)];
      if (!piece) throw new ApiError("SEQUENCE_DONE", `序列在第 ${i} 步提前结束`, 409);
      results.push(this.playStep(gameId, {
        expectedStep: this.lastStep(gameId) + 1,
        type: piece.type, rotation: piece.rotation, left: moves[i].left,
      }));
    }
    return { from: cur + 1, count: results.length, results };
  }

  getStep(gameId: number, step: number) {
    const r = this.db.prepare("SELECT * FROM steps WHERE game_id=? AND step=?").get(gameId, step) as
      | { step: number; status: string; piece: string; result: string; board_after: string } | undefined;
    if (!r) throw new ApiError("STEP_NOT_FOUND", `步骤 ${step} 不存在`, 404);
    return {
      step: r.step, status: r.status,
      piece: JSON.parse(r.piece), result: JSON.parse(r.result), board: JSON.parse(r.board_after),
    };
  }

  listSteps(gameId: number) {
    this.loadGame(gameId);
    const rows = this.db.prepare("SELECT step, status FROM steps WHERE game_id=? ORDER BY step").all(gameId) as { step: number; status: string }[];
    return rows;
  }

  // 从初始布局逐步重放，返回每步棋盘与最终棋盘
  replay(gameId: number) {
    const g = this.loadGame(gameId);
    const rows = this.db
      .prepare("SELECT step, status, piece, result FROM steps WHERE game_id=? ORDER BY step")
      .all(gameId) as { step: number; status: string; piece: string; result: string }[];
    let board = g.initialBoard;
    const boards: Board[] = [];
    for (const r of rows) {
      const piece = JSON.parse(r.piece) as StepInput;
      const result = JSON.parse(r.result) as DropResult;
      if (r.status === "ok") {
        // 重新演算校验，而非直接信任事件
        const re = hardDrop(board, piece.type, piece.rotation, piece.left);
        if (!re.ok) throw new ApiError("REPLAY_MISMATCH", `第 ${r.step} 步重放失败`, 500);
        board = re.boardAfter!;
      } // failed 步不改变棋盘
      boards.push(board);
    }
    return { gameId, steps: rows.length, boards, finalBoard: board };
  }

  exportGame(gameId: number) {
    const g = this.loadGame(gameId);
    return {
      gameId: g.id, width: g.width, height: g.height,
      initialBoard: g.initialBoard, sequence: g.sequence,
      steps: this.listSteps(gameId).map((s) => this.getStep(gameId, s.step)),
      replayFinalBoard: this.replay(gameId).finalBoard,
    };
  }
}
