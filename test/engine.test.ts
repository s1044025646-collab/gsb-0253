import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Board, PIECES, PieceType, pieceCells, rotationCount, hardDrop, legalColumns,
  validateBoard, occupiedCount, collides,
} from "../src/engine";
import { GameService, ApiError } from "../src/service";
import { openDb, DATA_DIR } from "../src/db";

const TYPES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];
const emptyBoard = (h = 10, w = 10): Board => Array.from({ length: h }, () => new Array(w).fill(0));

test("七种方块各朝向：4 格、规范化、可落底", () => {
  for (const t of TYPES) {
    for (let rot = 0; rot < rotationCount(t); rot++) {
      const cells = pieceCells(t, rot);
      assert.equal(cells.length, 4, `${t} rot${rot} 应有 4 格`);
      assert.ok(cells.some(([r]) => r === 0) && cells.some(([, c]) => c === 0), "应规范化到最小包围盒");
      const b = emptyBoard();
      const r = hardDrop(b, t, rot, 0);
      assert.ok(r.ok, `${t} rot${rot} 平地应可落`);
      assert.equal(r.lockedCells!.length, 4);
    }
  }
  assert.equal(rotationCount("O"), 1);
  assert.equal(rotationCount("I"), 2);
  assert.equal(rotationCount("T"), 4);
});

test("最左最右边界与越界拒绝", () => {
  const b = emptyBoard(10, 10);
  assert.ok(hardDrop(b, "I", 0, 0).ok);          // 最左
  assert.ok(hardDrop(b, "I", 0, 6).ok);          // 最右（横向 I 宽 4）
  assert.equal(hardDrop(b, "I", 0, 7).ok, false); // 越界
  assert.equal(hardDrop(b, "I", 0, -1).ok, false);
  assert.ok(hardDrop(b, "I", 1, 9).ok);          // 竖向 I 最右
  assert.equal(hardDrop(b, "I", 1, 10).ok, false);
});

test("悬空平台：停在平台上且不能穿过", () => {
  const b = emptyBoard(10, 10);
  b[6][4] = 1; b[6][5] = 1; // 悬空平台
  const r = hardDrop(b, "O", 0, 4);
  assert.ok(r.ok);
  assert.equal(r.top, 4); // O 高 2，底行在 5，恰在平台上方
  assert.equal(r.dropDistance, 4);
});

test("下方孔洞：填满凹槽但不穿透底部", () => {
  const b = emptyBoard(10, 10);
  for (let c = 0; c < 10; c++) if (c !== 4) b[9][c] = 1;
  const r = hardDrop(b, "I", 1, 4); // 竖 I 落入单列凹槽
  assert.ok(r.ok);
  assert.equal(r.top, 6);
  assert.deepEqual(r.clearedRows, [9]); // 底行补满消除
  assert.equal(occupiedCount(r.boardAfter!), 3); // 竖 I 剩余 3 格留在凹槽上方
});

test("一次同时清除相邻两行", () => {
  const b = emptyBoard(10, 10);
  for (let c = 0; c < 10; c++) if (c !== 4) { b[9][c] = 1; b[8][c] = 1; }
  const r = hardDrop(b, "I", 1, 4);
  assert.ok(r.ok);
  assert.deepEqual(r.clearedRows, [8, 9]);
  assert.equal(occupiedCount(r.boardAfter!), 2); // 竖 I 剩余 2 格
});

test("有空隙的行不算满行", () => {
  const b = emptyBoard(10, 10);
  for (let c = 0; c < 10; c++) if (c !== 4 && c !== 7) b[9][c] = 1;
  const r = hardDrop(b, "I", 1, 4);
  assert.ok(r.ok);
  assert.deepEqual(r.clearedRows, []); // 第 7 列仍空
});

test("顶部堵塞：首次位置碰撞则失败", () => {
  const b = emptyBoard(10, 10);
  b[0][1] = 1;
  const r = hardDrop(b, "O", 0, 0);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /碰撞/);
});

test("棋盘校验：非矩形/尺寸/非法值", () => {
  assert.ok(validateBoard([[0, 0], [0]]));
  assert.ok(validateBoard(emptyBoard(3, 10)));
  assert.ok(validateBoard(emptyBoard(10, 3)));
  assert.ok(validateBoard([[0, 0, 0, 0], [0, 0, 0, 8], [0, 0, 0, 0], [0, 0, 0, 0]]));
  assert.equal(validateBoard(emptyBoard(10, 10)), null);
});

test("legalColumns 返回全部合法横向落点", () => {
  const b = emptyBoard(10, 10);
  assert.deepEqual(legalColumns(b, "I", 0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(legalColumns(b, "I", 1), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  b[0][0] = 1; // 堵住左侧生成位
  assert.ok(!legalColumns(b, "O", 0).includes(0));
});

// ---------- 服务层（含 SQLite 持久化） ----------

function freshService(name: string) {
  const f = path.join(DATA_DIR, name);
  try { fs.unlinkSync(f); } catch {}
  return new GameService(openDb(name));
}

// 独立逐格校验：锁定格不重叠、不能再下降、占用数守恒
function verifyStep(before: Board, after: Board, locked: number[][], cleared: number[], w: number) {
  const keys = new Set(locked.map(([r, c]) => `${r},${c}`));
  assert.equal(keys.size, 4, "锁定格不得重叠");
  for (const [r, c] of locked) assert.equal(before[r][c], 0, "锁定格不得压在已有格上");
  // 作为整体再降一格必碰撞（越界或压格）
  const minR = Math.min(...locked.map(([r]) => r));
  const minC = Math.min(...locked.map(([, c]) => c));
  const rel = locked.map(([r, c]) => [r - minR, c - minC]);
  assert.ok(collides(before, rel, minR + 1, minC), "锁定后不能再下降");
  assert.equal(
    occupiedCount(after),
    occupiedCount(before) + 4 - cleared.length * w,
    "占用格数 = 旧格数 + 4 - 消行数*宽度"
  );
}

test("服务：完整流程、占用守恒、逐步重放一致", () => {
  const svc = freshService("t1.db");
  const b = emptyBoard(12, 10);
  for (let c = 0; c < 10; c++) if (c !== 4) { b[11][c] = 1; b[10][c] = 1; }
  const { gameId } = svc.createGame(b, [{ type: "I", rotation: 1 }, { type: "O", rotation: 0 }]);
  const before = svc.getState(gameId).board;
  const r1 = svc.playStep(gameId, { expectedStep: 1, type: "I", rotation: 1, left: 4 });
  assert.equal(r1.status, "ok");
  assert.deepEqual(r1.clearedRows, [10, 11]);
  verifyStep(before, r1.board, r1.lockedCells!, r1.clearedRows!, 10);
  const r2 = svc.playStep(gameId, { expectedStep: 2, type: "O", rotation: 0, left: 0 });
  verifyStep(r1.board, r2.board, r2.lockedCells!, r2.clearedRows!, 10);
  // 重放逐步一致
  const replay = svc.replay(gameId);
  assert.equal(replay.boards.length, 2);
  assert.deepEqual(replay.boards[0], r1.board);
  assert.deepEqual(replay.boards[1], r2.board);
  assert.deepEqual(replay.finalBoard, svc.getState(gameId).board);
});

test("服务：陈旧步号拒绝且历史保留；跳步拒绝", () => {
  const svc = freshService("t2.db");
  const { gameId } = svc.createGame(emptyBoard(10, 10), [{ type: "O", rotation: 0 }, { type: "O", rotation: 0 }]);
  svc.playStep(gameId, { expectedStep: 1, type: "O", rotation: 0, left: 0 });
  assert.throws(
    () => svc.playStep(gameId, { expectedStep: 1, type: "O", rotation: 0, left: 3 }),
    (e: ApiError) => e.code === "STALE_STEP"
  );
  assert.equal(svc.getState(gameId).step, 1); // 未多落
  assert.throws(
    () => svc.playStep(gameId, { expectedStep: 5, type: "O", rotation: 0, left: 3 }),
    (e: ApiError) => e.code === "STEP_GAP"
  );
  assert.equal(svc.listSteps(gameId).length, 1);
});

test("服务：失败步骤不改变棋盘", () => {
  const svc = freshService("t3.db");
  const b = emptyBoard(10, 10);
  b[0][4] = 1; b[0][5] = 1; b[1][5] = 1; // 堵住 T rot0 在 col4 的生成位
  const { gameId } = svc.createGame(b, [{ type: "T", rotation: 0 }]);
  const r = svc.playStep(gameId, { expectedStep: 1, type: "T", rotation: 0, left: 4 });
  assert.equal(r.status, "failed");
  assert.deepEqual(svc.getState(gameId).board, b);
});

test("服务：非法输入不改状态", () => {
  const svc = freshService("t4.db");
  const { gameId } = svc.createGame(emptyBoard(10, 10), [{ type: "O", rotation: 0 }]);
  assert.throws(() => svc.playStep(gameId, { expectedStep: 1, type: "O", rotation: 0, left: 9 }), (e: ApiError) => e.code === "OUT_OF_BOUNDS");
  assert.throws(() => svc.playStep(gameId, { expectedStep: 1, type: "T", rotation: 0, left: 0 }), (e: ApiError) => e.code === "PIECE_MISMATCH");
  assert.equal(svc.getState(gameId).step, 0);
  assert.throws(() => svc.createGame([[0, 0], [0]], [{ type: "O", rotation: 0 }]), (e: ApiError) => e.code === "BAD_BOARD");
});

test("服务：重启后步骤读取（新连接同一数据库文件）", () => {
  freshService("t5.db"); // 清空
  const svc1 = new GameService(openDb("t5.db"));
  const { gameId } = svc1.createGame(emptyBoard(10, 10), [{ type: "I", rotation: 0 }]);
  svc1.playStep(gameId, { expectedStep: 1, type: "I", rotation: 0, left: 3 });
  const svc2 = new GameService(openDb("t5.db")); // 模拟重启
  const s = svc2.getStep(gameId, 1);
  assert.equal(s.status, "ok");
  assert.equal(svc2.getState(gameId).step, 1);
  assert.deepEqual(svc2.replay(gameId).finalBoard, svc2.getState(gameId).board);
});
