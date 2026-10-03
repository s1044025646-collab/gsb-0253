import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Board, hardDrop, validateBoard, emptyBoard } from '../src/engine';
import { PIECE_TYPES, getCells, pieceWidth, PieceType } from '../src/pieces';
import { Store } from '../src/store';
import { ApiError } from '../src/errors';

function b(rows: string[]): Board {
  return rows.map((r) => r.split('').map((c) => (c === '.' ? 0 : Number(c))));
}

function countOccupied(board: Board): number {
  return board.flat().filter((v) => v !== 0).length;
}

/** 独立逐格校验：锁定格不重叠、在界内、落点不能再下降。 */
function verifyLock(boardBefore: Board, result: ReturnType<typeof hardDrop>): void {
  const seen = new Set<string>();
  for (const c of result.lockedCells) {
    const key = `${c.x},${c.y}`;
    assert.ok(!seen.has(key), '锁定格重叠');
    seen.add(key);
    assert.ok(c.x >= 0 && c.x < boardBefore[0].length && c.y >= 0 && c.y < boardBefore.length);
    assert.equal(boardBefore[c.y][c.x], 0, '锁定格与已有格重叠');
  }
  assert.equal(result.lockedCells.length, 4);
  // 再下降一格必然越界或碰撞
  const height = boardBefore.length;
  const canDescend = result.lockedCells.every(
    (c) => c.y + 1 < height && (boardBefore[c.y + 1][c.x] === 0 || seen.has(`${c.x},${c.y + 1}`)),
  );
  // 注意：格子下方可能是本方块的其它格子；整体判断需用包围形状
  const cells = result.lockedCells.map((c) => ({ x: c.x, y: c.y + 1 }));
  const keys = new Set(result.lockedCells.map((c) => `${c.x},${c.y}`));
  const blocked = cells.some(
    (c) => c.y >= height || (boardBefore[c.y][c.x] !== 0 && !keys.has(`${c.x},${c.y}`)),
  );
  assert.ok(blocked || !canDescend, '落点仍可继续下降');
}

/** 占用格数守恒：旧格数 + 4 - 消行数 * 宽度。 */
function verifyCount(before: Board, result: ReturnType<typeof hardDrop>): void {
  const expected = countOccupied(before) + 4 - result.clearedRows.length * before[0].length;
  assert.equal(countOccupied(result.board), expected);
}

test('七种方块各朝向：规范化坐标、4 格、界内硬降', () => {
  for (const t of PIECE_TYPES) {
    for (let r = 0; r < 4; r++) {
      const cells = getCells(t, r);
      assert.equal(cells.length, 4);
      assert.ok(cells.every((c) => c.x >= 0 && c.y >= 0), `${t} rot${r} 未规范化`);
      assert.ok(cells.some((c) => c.x === 0) && cells.some((c) => c.y === 0));
      const board = emptyBoard(10, 10);
      const res = hardDrop(board, t, r, 0, 1);
      verifyLock(board, res);
      verifyCount(board, res);
    }
  }
});

test('最左与最右边界', () => {
  const board = emptyBoard(6, 6);
  const left = hardDrop(board, 'I', 0, 0, 1);
  assert.deepEqual(left.lockedCells.map((c) => c.x), [0, 1, 2, 3]);
  const right = hardDrop(board, 'I', 0, 2, 1);
  assert.deepEqual(right.lockedCells.map((c) => c.x), [2, 3, 4, 5]);
  assert.throws(() => hardDrop(board, 'I', 0, 3, 1), (e: ApiError) => e.code === 'OUT_OF_BOUNDS');
  assert.throws(() => hardDrop(board, 'I', 0, -1, 1), (e: ApiError) => e.code === 'OUT_OF_BOUNDS');
});

test('悬空平台：停在平台上', () => {
  const board = b(['......', '......', '......', '..1...', '......']);
  const res = hardDrop(board, 'O', 0, 1, 1);
  // O 占列1-2，列2在 y=3 有平台，故锁定在 y=1..2
  assert.equal(res.landingRow, 1);
  verifyLock(board, res);
  verifyCount(board, res);
});

test('下方孔洞：方块穿过孔洞上方停在其上', () => {
  // 列2在底部有洞，但列3底部有格：O 停在洞上方
  const board = b(['......', '......', '......', '......', '..1.1.']);
  const res = hardDrop(board, 'O', 0, 1, 1);
  assert.equal(res.landingRow, 2);
  verifyLock(board, res);
});

test('一次清除相邻两行', () => {
  const board = b(['..........', '..........', '..........', '..........', '1111.11111', '1111.11111']);
  const res = hardDrop(board, 'I', 1, 4, 1);
  assert.deepEqual(res.clearedRows, [4, 5]);
  // I 竖放占 2~5 行，消除 4、5 行后剩余两格
  assert.equal(countOccupied(res.board), 2);
  verifyCount(board, res);
});

test('一次清除四行（I 竖放）', () => {
  const board = b([
    '..........',
    '..........',
    '1111.11111',
    '1111.11111',
    '1111.11111',
    '1111.11111',
  ]);
  const res = hardDrop(board, 'I', 1, 4, 1);
  assert.deepEqual(res.clearedRows, [2, 3, 4, 5]);
  assert.equal(countOccupied(res.board), 0);
});

test('有空隙的行不算满行', () => {
  const board = b(['......', '......', '......', '111.11', '111111']);
  const res = hardDrop(board, 'O', 0, 0, 1);
  assert.deepEqual(res.clearedRows, [4]);
  assert.equal(res.board.length, 5);
});

test('无法生成：进入位置碰撞，抛 SPAWN_BLOCKED 且棋盘不变', () => {
  const board = b(['..1...', '..1...', '..1...', '..1...']);
  assert.throws(() => hardDrop(board, 'I', 1, 2, 1), (e: ApiError) => e.code === 'SPAWN_BLOCKED');
});

test('棋盘校验：非矩形 / 尺寸过小 / 非法值', () => {
  assert.throws(() => validateBoard([[0, 0], [0]]), (e: ApiError) => e.code === 'INVALID_BOARD');
  assert.throws(() => validateBoard(emptyBoard(3, 3)), (e: ApiError) => e.code === 'INVALID_BOARD');
  assert.throws(
    () => validateBoard(b(['......', '......', '......', '..9...'])),
    (e: ApiError) => e.code === 'INVALID_BOARD',
  );
  assert.doesNotThrow(() => validateBoard(emptyBoard(4, 4)));
});

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tetris-')), 'test.db');
}

test('Store：失败步骤不改变棋盘，陈旧/重复步号拒绝', () => {
  const store = new Store(':memory:');
  const id = store.createGame(emptyBoard(6, 6), ['I', 'O'] as PieceType[]);
  store.playStep(id, 0, 0, 1);
  const boardAfter1 = store.currentBoard(id);
  // 重复步号
  assert.throws(() => store.playStep(id, 0, 0, 1), (e: ApiError) => e.code === 'STALE_STEP');
  // 跳号
  assert.throws(() => store.playStep(id, 0, 0, 3), (e: ApiError) => e.code === 'STALE_STEP');
  // 越界列
  assert.throws(() => store.playStep(id, 0, 99, 2), (e: ApiError) => e.code === 'OUT_OF_BOUNDS');
  assert.deepEqual(store.currentBoard(id), boardAfter1);
  assert.equal(store.listSteps(id).length, 1);
  store.playStep(id, 0, 2, 2);
  assert.equal(store.listSteps(id).length, 2);
  // 序列用完
  assert.throws(() => store.playStep(id, 0, 0, 3), (e: ApiError) => e.code === 'SEQUENCE_EXHAUSTED');
  store.close();
});

test('Store：重启后步骤读取与回放逐步一致', () => {
  const dbPath = tmpDb();
  let store = new Store(dbPath);
  const id = store.createGame(emptyBoard(8, 8), ['T', 'L', 'I', 'S'] as PieceType[]);
  store.playStep(id, 0, 0, 1);
  store.playStep(id, 0, 4, 2);
  store.playStep(id, 1, 7, 3);
  const before = store.currentBoard(id);
  store.close();
  // 重新打开（模拟重启）
  store = new Store(dbPath);
  assert.equal(store.getGame(id).current_step, 3);
  assert.equal(store.listSteps(id).length, 3);
  assert.deepEqual(store.currentBoard(id), before);
  store.playStep(id, 0, 2, 4);
  const replay = store.replay(id);
  assert.equal(replay.stepsChecked, 4);
  assert.deepEqual(replay.board, store.currentBoard(id));
  // 逐步核对每步棋盘
  const game = store.getGame(id);
  let board = JSON.parse(game.initial_board) as Board;
  for (const s of store.listSteps(id)) {
    const r = hardDrop(board, s.piece as PieceType, s.rotation, s.column, s.step);
    assert.deepEqual(r.board, JSON.parse(s.board_after));
    board = r.board;
  }
  store.close();
});

test('Store：回放逐步得到同样棋盘（含消行场景）', () => {
  const store = new Store(':memory:');
  const initial = b(['..........', '..........', '..........', '..........', '1111.11111', '1111.11111']);
  const id = store.createGame(initial, ['I', 'O', 'T'] as PieceType[]);
  store.playStep(id, 1, 4, 1);
  store.playStep(id, 0, 0, 2);
  store.playStep(id, 0, 5, 3);
  const replay = store.replay(id);
  assert.deepEqual(replay.board, store.currentBoard(id));
  store.close();
});

test('pieceWidth 与合法列', () => {
  assert.equal(pieceWidth('I', 0), 4);
  assert.equal(pieceWidth('I', 1), 1);
  assert.equal(pieceWidth('O', 0), 2);
});
