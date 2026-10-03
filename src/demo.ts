import { Store } from './store';
import { renderBoard } from './render';
import { Board } from './engine';
import { PieceType } from './pieces';
import { ApiError } from './errors';

function board(rows: string[]): Board {
  return rows.map((r) => r.split('').map((c) => (c === '.' ? 0 : Number(c))));
}

interface Scenario {
  title: string;
  initial: Board;
  sequence: PieceType[];
  moves: { rotation: number; column: number }[];
}

const SCENARIOS: Scenario[] = [
  {
    title: '1. 平地落块（I 横放在空棋盘）',
    initial: board(['..........', '..........', '..........', '..........', '..........', '..........']),
    sequence: ['I'],
    moves: [{ rotation: 0, column: 3 }],
  },
  {
    title: '2. 凹槽填补（I 竖向落入凹槽）',
    initial: board([
      '..........',
      '..........',
      '..........',
      '..........',
      '111...1111',
      '1111.11111',
    ]),
    sequence: ['I'],
    moves: [{ rotation: 1, column: 4 }],
  },
  {
    title: '3. 连续两行消除（I 竖放一次消两行）',
    initial: board([
      '..........',
      '..........',
      '..........',
      '..........',
      '1111.11111',
      '1111.11111',
    ]),
    sequence: ['I'],
    moves: [{ rotation: 1, column: 4 }],
  },
  {
    title: '4. 顶部堵塞（进入位置即碰撞，本步结束）',
    initial: board([
      '....1.....',
      '....1.....',
      '....1.....',
      '....1.....',
      '....1.....',
      '....1.....',
    ]),
    sequence: ['I'],
    moves: [{ rotation: 1, column: 4 }],
  },
];

export function runDemo(): void {
  const store = new Store(':memory:');
  try {
    for (const sc of SCENARIOS) {
      console.log('='.repeat(60));
      console.log(sc.title);
      console.log('初始棋盘:');
      console.log(renderBoard(sc.initial));
      const id = store.createGame(sc.initial, sc.sequence);
      for (const mv of sc.moves) {
        const game = store.getGame(id);
        try {
          const r = store.playStep(id, mv.rotation, mv.column, game.current_step + 1);
          console.log(
            `下一块 ${r.piece} 朝向${r.rotation} 列${r.column} -> 落点行${r.landingRow} 落距${r.dropDistance}`,
          );
          if (r.clearedRows.length) {
            console.log(`消除行(原始行号): ${r.clearedRows.join(', ')}`);
          }
          console.log('落位并消行后:');
          console.log(renderBoard(r.board));
        } catch (err) {
          if (err instanceof ApiError) {
            console.log(`步骤被拒绝 [${err.code}] ${err.message}`);
            console.log('棋盘保持不变:');
            console.log(renderBoard(store.currentBoard(id)));
          } else {
            throw err;
          }
        }
      }
      const replay = store.replay(id);
      console.log(`回放校对通过（${replay.stepsChecked} 步）。`);
    }
    console.log('='.repeat(60));
    console.log('5. 陈旧步号拒绝演示');
    const id = store.createGame(board(['......', '......', '......', '......']), ['O', 'O']);
    store.playStep(id, 0, 0, 1);
    try {
      store.playStep(id, 0, 2, 1);
    } catch (err) {
      if (err instanceof ApiError) {
        console.log(`重复提交步号 1 被拒绝 [${err.code}] ${err.message}`);
      }
    }
    console.log(`历史完整保留：共 ${store.listSteps(id).length} 步，当前步号 ${store.getGame(id).current_step}`);
  } finally {
    store.close();
  }
}

if (require.main === module) {
  runDemo();
}
