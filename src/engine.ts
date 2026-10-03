export type Cell = number; // 0 = 空, >0 = 占用（可携带方块身份）
export type Board = Cell[][];

export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface PieceDef {
  type: PieceType;
  rotations: number[][][]; // 每个朝向：按最小包围盒规范化的格子坐标 [r,c]
}

function normalize(cells: number[][]): number[][] {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function rotateCW(cells: number[][]): number[][] {
  const maxR = Math.max(...cells.map((c) => c[0]));
  return normalize(cells.map(([r, c]) => [c, maxR - r]));
}

function buildRotations(base: number[][]): number[][][] {
  const rots: number[][][] = [normalize(base)];
  for (let i = 1; i < 4; i++) rots.push(rotateCW(rots[i - 1]));
  // 去重（如 O 四向相同、I/S/Z 两两相同）
  const seen = new Set<string>();
  return rots.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const BASE: Record<PieceType, number[][]> = {
  I: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T: [[0, 0], [0, 1], [0, 2], [1, 1]],
  S: [[0, 1], [0, 2], [1, 0], [1, 1]],
  Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
  J: [[0, 0], [0, 1], [0, 2], [1, 0]],
  L: [[0, 0], [0, 1], [0, 2], [1, 2]],
};

export const PIECES: Record<PieceType, PieceDef> = Object.fromEntries(
  (Object.keys(BASE) as PieceType[]).map((t) => [t, { type: t, rotations: buildRotations(BASE[t]) }])
) as Record<PieceType, PieceDef>;

export function rotationCount(type: PieceType): number {
  return PIECES[type].rotations.length;
}

export function pieceCells(type: PieceType, rotation: number): number[][] {
  const rots = PIECES[type].rotations;
  const r = ((rotation % rots.length) + rots.length) % rots.length;
  return rots[r];
}

// ---------------- 棋盘校验 ----------------

export const MIN_W = 4, MAX_W = 64, MIN_H = 4, MAX_H = 64;

export function validateBoard(board: unknown): string | null {
  if (!Array.isArray(board) || board.length < MIN_H || board.length > MAX_H)
    return `棋盘行数必须在 ${MIN_H}..${MAX_H}`;
  const w = (board[0] as unknown[]).length;
  if (!Array.isArray(board[0]) || w < MIN_W || w > MAX_W) return `棋盘列数必须在 ${MIN_W}..${MAX_W}`;
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== w) return "棋盘必须是矩形（每行长度一致）";
    for (const v of row) {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 7)
        return "单元值必须是 0..7 的整数（0 为空）";
    }
  }
  return null;
}

// ---------------- 碰撞与硬降 ----------------

export function collides(board: Board, cells: number[][], top: number, left: number): boolean {
  const h = board.length, w = board[0].length;
  for (const [r, c] of cells) {
    const br = top + r, bc = left + c;
    if (bc < 0 || bc >= w || br >= h) return true; // 横向越界或触底
    if (br >= 0 && board[br][bc] !== 0) return true; // 与已有格子重叠
  }
  return false;
}

export interface DropResult {
  ok: boolean;
  reason?: string;
  top?: number;        // 锁定后包围盒顶行
  left: number;
  dropDistance?: number;
  lockedCells?: number[][]; // 绝对坐标
  clearedRows?: number[];   // 原始行号（升序）
  boardAfter?: Board;
}

export function hardDrop(board: Board, type: PieceType, rotation: number, left: number): DropResult {
  const cells = pieceCells(type, rotation);
  const w = board[0].length;
  const maxC = Math.max(...cells.map((c) => c[1]));
  if (!Number.isInteger(left) || left < 0 || left + maxC >= w)
    return { ok: false, reason: "横向位置越界", left };
  // 从顶行进入：包围盒顶对齐棋盘第 0 行
  let top = 0;
  if (collides(board, cells, top, left))
    return { ok: false, reason: "生成位置已碰撞（顶部堵塞）", left };
  while (!collides(board, cells, top + 1, left)) top++;
  const dropDistance = top;
  const locked = cells.map(([r, c]) => [top + r, left + c]);
  const next: Board = board.map((row) => row.slice());
  const mark = (Object.keys(BASE) as PieceType[]).indexOf(type) + 1;
  for (const [r, c] of locked) next[r][c] = mark;
  // 同时找出全部满行
  const full: number[] = [];
  for (let r = 0; r < next.length; r++) if (next[r].every((v) => v !== 0)) full.push(r);
  const remaining = next.filter((_, r) => !full.includes(r));
  while (remaining.length < next.length) remaining.unshift(new Array(w).fill(0));
  return { ok: true, top, left, dropDistance, lockedCells: locked, clearedRows: full, boardAfter: remaining };
}

// 给定朝向下的所有合法横向落点
export function legalColumns(board: Board, type: PieceType, rotation: number): number[] {
  const cells = pieceCells(type, rotation);
  const maxC = Math.max(...cells.map((c) => c[1]));
  const out: number[] = [];
  for (let left = 0; left + maxC < board[0].length; left++) {
    if (!collides(board, cells, 0, left)) out.push(left);
  }
  return out;
}

export function occupiedCount(board: Board): number {
  return board.reduce((n, row) => n + row.filter((v) => v !== 0).length, 0);
}

export function renderBoard(board: Board): string {
  const glyphs = " IOTSZJL"; // 1..7
  const line = "+" + "-".repeat(board[0].length * 2) + "+";
  const rows = board.map(
    (row) => "|" + row.map((v) => (v === 0 ? " ." : " " + glyphs[v])).join("") + "|"
  );
  return [line, ...rows, line].join("\n");
}
