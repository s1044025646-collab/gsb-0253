import { Store, defaultDbPath } from './store';
import { renderBoard } from './render';
import { legalColumns, Board } from './engine';
import { PieceType } from './pieces';
import { startServer } from './server';
import { ApiError } from './errors';

function parseBoard(s: string): Board {
  // 支持 JSON 或分号分隔行、逗号分隔列，如 "0,0,0;1,1,0"
  const t = s.trim();
  if (t.startsWith('[')) return JSON.parse(t) as Board;
  return t.split(';').map((row) => row.split(',').map((v) => Number(v.trim())));
}

function usage(): void {
  console.log(`用法: node dist/src/cli.js <命令> [参数]
命令:
  serve [端口]                          启动 HTTP API 服务（默认自动选空闲端口）
  create <高度> <宽度> <序列>           创建空棋盘对局，序列如 IOTSZJL
  create-with <棋盘> <序列>             用给定棋盘创建，棋盘如 "0,0;1,0" 或 JSON
  show <对局ID>                         查看当前棋盘
  legal <对局ID> [朝向]                 查看当前方块的合法横向落点
  play <对局ID> <朝向> <列> <预期步号>  执行一次硬降
  play-seq <对局ID> <朝向:列,...>       依次执行多步，如 "0:3,1:0"
  steps <对局ID>                        列出全部步骤
  replay <对局ID>                       从头回放并校对
  export <对局ID>                       导出 JSON
环境变量: TETRIS_DB 指定数据库路径（默认 ./data/tetris.db），PORT 指定端口`);
}

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (cmd === 'serve') {
    if (args[0]) process.env.PORT = args[0];
    await startServer();
    return;
  }
  const store = new Store(process.env.TETRIS_DB ?? defaultDbPath());
  try {
    switch (cmd) {
      case 'create': {
        const [h, w, seq] = args;
        const board = Array.from({ length: Number(h) }, () => new Array(Number(w)).fill(0));
        const id = store.createGame(board, seq.split('') as PieceType[]);
        console.log(`已创建对局 ${id}`);
        break;
      }
      case 'create-with': {
        const id = store.createGame(parseBoard(args[0]), args[1].split('') as PieceType[]);
        console.log(`已创建对局 ${id}`);
        break;
      }
      case 'show': {
        const id = Number(args[0]);
        const game = store.getGame(id);
        console.log(`对局 ${id}  当前步数 ${game.current_step}  序列 ${game.sequence}`);
        console.log(renderBoard(store.currentBoard(id)));
        break;
      }
      case 'legal': {
        const id = Number(args[0]);
        const rotation = Number(args[1] ?? '0');
        const game = store.getGame(id);
        const seq = JSON.parse(game.sequence) as PieceType[];
        const piece = seq[game.current_step];
        if (!piece) throw new ApiError('SEQUENCE_EXHAUSTED', '方块序列已用完', 409);
        const cols = legalColumns(store.currentBoard(id), piece, rotation);
        console.log(`下一块 ${piece} 朝向 ${rotation} 的合法列: ${cols.join(', ')}`);
        break;
      }
      case 'play': {
        const [id, rotation, column, expectedStep] = args.map(Number);
        const before = store.currentBoard(id);
        const r = store.playStep(id, rotation, column, expectedStep);
        console.log(`第 ${r.step} 步: ${r.piece} 朝向${r.rotation} 列${r.column} 落点行${r.landingRow} 落距${r.dropDistance}`);
        if (r.clearedRows.length) console.log(`消除行(原始行号): ${r.clearedRows.join(', ')}`);
        console.log(renderBoard(before));
        console.log('  ->');
        console.log(renderBoard(r.board));
        break;
      }
      case 'play-seq': {
        const id = Number(args[0]);
        for (const pair of args[1].split(',')) {
          const [rotation, column] = pair.split(':').map(Number);
          const game = store.getGame(id);
          const r = store.playStep(id, rotation, column, game.current_step + 1);
          console.log(`第 ${r.step} 步: ${r.piece} 落点行${r.landingRow} 消除行: [${r.clearedRows.join(', ')}]`);
        }
        console.log(renderBoard(store.currentBoard(id)));
        break;
      }
      case 'steps': {
        for (const s of store.listSteps(Number(args[0]))) {
          console.log(
            `#${s.step} ${s.piece} rot=${s.rotation} col=${s.column} 落点行=${s.landing_row} 落距=${s.drop_distance} 消行=${s.cleared_rows}`,
          );
        }
        break;
      }
      case 'replay': {
        const r = store.replay(Number(args[0]));
        console.log(`回放完成，共校对 ${r.stepsChecked} 步，最终棋盘:`);
        console.log(renderBoard(r.board));
        break;
      }
      case 'export': {
        const id = Number(args[0]);
        console.log(
          JSON.stringify(
            { game: store.getGame(id), steps: store.listSteps(id), replay: store.replay(id) },
            null,
            2,
          ),
        );
        break;
      }
      default:
        usage();
        if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`错误 [${err.code}] ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    store.close();
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2));
}
