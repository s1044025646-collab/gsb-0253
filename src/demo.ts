import { GameService } from "./service";
import { Board, renderBoard } from "./engine";

const svc = new GameService();

const W = 10, H = 12;
const empty = (): Board => Array.from({ length: H }, () => new Array(W).fill(0));

function bottomRows(spec: [number, number[]][]): Board {
  const b = empty();
  for (const [fromBottom, holes] of spec) {
    const row = H - fromBottom;
    for (let c = 0; c < W; c++) if (!holes.includes(c)) b[row][c] = 1;
  }
  return b;
}

interface Scenario { name: string; board: Board; sequence: { type: any; rotation: number }[]; moves: number[] }

const scenarios: Scenario[] = [
  {
    name: "1. 平地落块",
    board: empty(),
    sequence: [{ type: "I", rotation: 0 }, { type: "O", rotation: 0 }],
    moves: [3, 7],
  },
  {
    name: "2. 凹槽填补",
    board: bottomRows([[1, [4, 5]], [2, [4, 5]]]),
    sequence: [{ type: "O", rotation: 0 }],
    moves: [4],
  },
  {
    name: "3. 连续两行消除",
    board: bottomRows([[1, [4]], [2, [4]]]),
    sequence: [{ type: "I", rotation: 1 }],
    moves: [4],
  },
  {
    name: "4. 顶部堵塞（无法生成）",
    board: (() => { const b = bottomRows([[1, []]]); for (let r = 0; r < H - 1; r++) b[r][5] = 1; return b; })(),
    sequence: [{ type: "T", rotation: 0 }],
    moves: [4],
  },
];

for (const s of scenarios) {
  console.log("=".repeat(48));
  console.log(`场景 ${s.name}`);
  console.log("初始棋盘:");
  console.log(renderBoard(s.board));
  const { gameId } = svc.createGame(s.board, s.sequence);
  for (let i = 0; i < s.moves.length; i++) {
    const before = svc.getState(gameId).board;
    const p = s.sequence[i];
    const r = svc.playStep(gameId, { expectedStep: i + 1, type: p.type, rotation: p.rotation, left: s.moves[i] });
    console.log(`\n步骤 ${r.step}: ${p.type}/rot${p.rotation} @ col ${s.moves[i]} -> ${r.status}` +
      (r.ok ? ` 落距=${r.dropDistance} 消行=[${r.clearedRows!.join(",") || "无"}]` : ` 原因=${r.reason}`));
    if (r.ok) {
      console.log("落子前:");
      console.log(renderBoard(before));
      console.log("落子后:");
      console.log(renderBoard(r.board));
      if (r.clearedRows!.length) console.log(`被消除的原始行号: ${r.clearedRows!.join(", ")}`);
    }
  }
  const replay = svc.replay(gameId);
  const state = svc.getState(gameId);
  const same = JSON.stringify(replay.finalBoard) === JSON.stringify(state.board);
  console.log(`回放校对: ${same ? "一致 ✓" : "不一致 ✗"}`);
}
console.log("=".repeat(48));
console.log("演示完成");
