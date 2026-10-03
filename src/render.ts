import { Board } from './engine';

const CHARS = ['.', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export function renderBoard(board: Board, highlightRows: number[] = []): string {
  const hl = new Set(highlightRows);
  const width = board[0].length;
  const lines: string[] = [];
  lines.push('+' + '-'.repeat(width) + '+');
  board.forEach((row, y) => {
    const mark = hl.has(y) ? '*' : '|';
    lines.push(mark + row.map((v) => CHARS[v] !== undefined ? CHARS[v] : '?').join('') + mark);
  });
  lines.push('+' + '-'.repeat(width) + '+');
  return lines.join('\n');
}
