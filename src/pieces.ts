export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface Cell {
  x: number;
  y: number;
}

// 每种方块的 4 个朝向（0=初始, 1=顺时针90, 2=180, 3=顺时针270）。
// 坐标以最小包围盒左上角为原点，y 向下增长。
const SHAPES: Record<PieceType, string[]> = {
  I: ['####'],
  O: ['##', '##'],
  T: ['###', '.#.'],
  S: ['.##', '##.'],
  Z: ['##.', '.##'],
  J: ['#..', '###'],
  L: ['..#', '###'],
};

function rotateCW(cells: Cell[]): Cell[] {
  const maxY = Math.max(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: maxY - c.y, y: c.x }));
}

function normalize(cells: Cell[]): Cell[] {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells
    .map((c) => ({ x: c.x - minX, y: c.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function parseShape(rows: string[]): Cell[] {
  const cells: Cell[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') cells.push({ x, y });
    }
  });
  return cells;
}

const ROTATIONS: Record<PieceType, Cell[][]> = (() => {
  const out = {} as Record<PieceType, Cell[][]>;
  for (const t of Object.keys(SHAPES) as PieceType[]) {
    const rots: Cell[][] = [];
    let cells = normalize(parseShape(SHAPES[t]));
    for (let r = 0; r < 4; r++) {
      rots.push(cells);
      cells = normalize(rotateCW(cells));
    }
    out[t] = rots;
  }
  return out;
})();

export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export function isPieceType(v: unknown): v is PieceType {
  return typeof v === 'string' && (PIECE_TYPES as string[]).includes(v);
}

/** 返回某方块某朝向（0-3）的规范化格子坐标。 */
export function getCells(type: PieceType, rotation: number): Cell[] {
  return ROTATIONS[type][((rotation % 4) + 4) % 4];
}

export function pieceWidth(type: PieceType, rotation: number): number {
  return Math.max(...getCells(type, rotation).map((c) => c.x)) + 1;
}

export function pieceHeight(type: PieceType, rotation: number): number {
  return Math.max(...getCells(type, rotation).map((c) => c.y)) + 1;
}
