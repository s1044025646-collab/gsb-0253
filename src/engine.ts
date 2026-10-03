import { Cell, PieceType, getCells, pieceWidth } from './pieces';
import { ApiError } from './errors';

export const MIN_DIM = 4;
export const MAX_DIM = 100;

export type Board = number[][];

export interface StepResult {
  step: number;
  piece: PieceType;
  rotation: number;
  column: number;
  /** 锁定后包围盒左上角所在行 */
  landingRow: number;
  /** 从顶行进入位置到下落的行数 */
  dropDistance: number;
  lockedCells: Cell[];
  clearedRows: number[];
  board: Board;
}

export function validateBoard(board: unknown): asserts board is Board {
  if (!Array.isArray(board) || board.length < MIN_DIM || board.length > MAX_DIM) {
    throw new ApiError('INVALID_BOARD', `棋盘行数必须在 ${MIN_DIM}~${MAX_DIM} 之间`);
  }
  if (!Array.isArray(board[0]) || board[0].length < MIN_DIM || board[0].length > MAX_DIM) {
    throw new ApiError('INVALID_BOARD', `棋盘列数必须在 ${MIN_DIM}~${MAX_DIM} 之间`);
  }
  const width = board[0].length;
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new ApiError('INVALID_BOARD', '棋盘必须是矩形：每行长度一致');
    }
    for (const v of row) {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 7) {
        throw new ApiError('INVALID_BOARD', '棋盘单元值必须是 0~7 的整数（0 表示空）');
      }
    }
  }
}

export function cloneBoard(board: Board): Board {
  return board.map((r) => r.slice());
}

export function emptyBoard(height: number, width: number): Board {
  return Array.from({ length: height }, () => new Array(width).fill(0));
}

function collides(board: Board, cells: Cell[], row: number, col: number): boolean {
  const height = board.length;
  const width = board[0].length;
  for (const c of cells) {
    const x = col + c.x;
    const y = row + c.y;
    if (x < 0 || x >= width || y >= height) return true;
    if (y >= 0 && board[y][x] !== 0) return true;
  }
  return false;
}

/** 计算某朝向在某列的全部合法横向落点列。 */
export function legalColumns(board: Board, piece: PieceType, rotation: number): number[] {
  const width = board[0].length;
  const w = pieceWidth(piece, rotation);
  const cols: number[] = [];
  for (let col = 0; col + w <= width; col++) {
    cols.push(col);
  }
  return cols;
}

const PIECE_VALUE: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

/**
 * 在当前棋盘上执行一次硬降。
 * 方块从顶行（row=0，包围盒顶对齐棋盘顶）按 column 进入。
 * 首次位置即碰撞则抛 SPAWN_BLOCKED（该步结束，棋盘不变）。
 */
export function hardDrop(
  board: Board,
  piece: PieceType,
  rotation: number,
  column: number,
  step: number,
): StepResult {
  const cells = getCells(piece, rotation);
  const width = board[0].length;
  if (!Number.isInteger(column) || column < 0 || column + pieceWidth(piece, rotation) > width) {
    throw new ApiError('OUT_OF_BOUNDS', `列 ${column} 越界：该朝向宽度为 ${pieceWidth(piece, rotation)}，棋盘宽 ${width}`);
  }
  if (collides(board, cells, 0, column)) {
    throw new ApiError('SPAWN_BLOCKED', '方块在进入位置即与已有格子碰撞，本步结束', 409);
  }
  let row = 0;
  while (!collides(board, cells, row + 1, column)) {
    row++;
  }
  const dropDistance = row;
  const next = cloneBoard(board);
  const lockedCells: Cell[] = cells.map((c) => ({ x: column + c.x, y: row + c.y }));
  const value = PIECE_VALUE[piece];
  for (const c of lockedCells) {
    next[c.y][c.x] = value;
  }
  // 同时找出全部满行并一次性移除，顶部补空行
  const clearedRows: number[] = [];
  for (let y = 0; y < next.length; y++) {
    if (next[y].every((v) => v !== 0)) clearedRows.push(y);
  }
  let finalBoard = next;
  if (clearedRows.length > 0) {
    const cleared = new Set(clearedRows);
    const remaining = next.filter((_, y) => !cleared.has(y));
    const blanks = emptyBoard(clearedRows.length, width);
    finalBoard = blanks.concat(remaining);
  }
  return {
    step,
    piece,
    rotation,
    column,
    landingRow: row,
    dropDistance,
    lockedCells,
    clearedRows,
    board: finalBoard,
  };
}
