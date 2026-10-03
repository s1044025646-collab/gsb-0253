import { GameService, ApiError } from "./service";
import { renderBoard } from "./engine";
import * as fs from "node:fs";

const svc = new GameService();

function parseBoardFile(p: string) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function show(board: number[][]) {
  console.log(renderBoard(board));
}

function usage() {
  console.log(`用法: node dist/cli.js <命令> [参数]
  create <board.json> <sequence.json>     创建对局
  state <gameId>                          查看当前状态与棋盘
  legal <gameId>                          查看当前方块的合法横向落点
  play <gameId> <expectedStep> <type> <rotation> <left>   执行一块
  play-seq <gameId> <left,left,...>       按序列执行多块
  steps <gameId>                          列出步骤
  step <gameId> <n>                       查询某一步
  replay <gameId>                         从头回放并校对
  export <gameId> [out.json]              导出对局`);
}

function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case "create": {
      const r = svc.createGame(parseBoardFile(a[0]), parseBoardFile(a[1]));
      console.log("创建成功:", r);
      break;
    }
    case "state": {
      const s = svc.getState(Number(a[0]));
      console.log(`game=${s.gameId} step=${s.step}/${s.sequenceLength} next=${JSON.stringify(s.nextPiece)}`);
      show(s.board);
      break;
    }
    case "legal": {
      const r = svc.legalMoves(Number(a[0]));
      console.log(`step=${r.step} piece=${JSON.stringify(r.piece)} 合法列: ${r.legalColumns.join(",")}`);
      break;
    }
    case "play": {
      const r = svc.playStep(Number(a[0]), {
        expectedStep: Number(a[1]), type: a[2] as any, rotation: Number(a[3]), left: Number(a[4]),
      });
      console.log(`step=${r.step} status=${r.status} drop=${r.dropDistance ?? "-"} cleared=[${(r.clearedRows ?? []).join(",")}]`);
      if (r.reason) console.log("原因:", r.reason);
      show(r.board);
      break;
    }
    case "play-seq": {
      const moves = a[1].split(",").map((s) => ({ left: Number(s) }));
      const r = svc.playSequence(Number(a[0]), moves);
      console.log(`执行 ${r.count} 步（从第 ${r.from} 步起）`);
      r.results.forEach((x) => console.log(`  step=${x.step} ${x.status} cleared=[${(x.clearedRows ?? []).join(",")}]`));
      break;
    }
    case "steps":
      console.log(svc.listSteps(Number(a[0])));
      break;
    case "step": {
      const r = svc.getStep(Number(a[0]), Number(a[1]));
      console.log(JSON.stringify({ step: r.step, status: r.status, piece: r.piece, result: r.result }, null, 2));
      show(r.board);
      break;
    }
    case "replay": {
      const r = svc.replay(Number(a[0]));
      console.log(`回放 ${r.steps} 步完成，最终棋盘:`);
      show(r.finalBoard);
      break;
    }
    case "export": {
      const data = svc.exportGame(Number(a[0]));
      const json = JSON.stringify(data, null, 2);
      if (a[1]) { fs.writeFileSync(a[1], json); console.log("已导出到", a[1]); }
      else console.log(json);
      break;
    }
    default:
      usage();
      if (cmd) process.exitCode = 1;
  }
}

try { main(); } catch (e) {
  if (e instanceof ApiError) { console.error(`错误 [${e.code}] ${e.message}`); process.exit(2); }
  throw e;
}
