import * as http from 'node:http';
import * as net from 'node:net';
import { Store, defaultDbPath } from './store';
import { ApiError } from './errors';
import { legalColumns } from './engine';
import { PIECE_TYPES, getCells } from './pieces';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new ApiError('BAD_REQUEST', '请求体过大'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ApiError('BAD_REQUEST', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && url.pathname === '/api/pieces') {
        const out: Record<string, unknown> = {};
        for (const t of PIECE_TYPES) {
          out[t] = [0, 1, 2, 3].map((r) => getCells(t, r));
        }
        return send(res, 200, out);
      }
      if (method === 'POST' && url.pathname === '/api/games') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const id = store.createGame(body.initialBoard as never, body.sequence as never);
        return send(res, 201, { id });
      }
      if (method === 'GET' && url.pathname === '/api/games') {
        return send(res, 200, store.listGames());
      }
      if (parts[0] === 'api' && parts[1] === 'games' && parts.length >= 3) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) throw new ApiError('BAD_REQUEST', '对局 id 非法');
        const sub = parts[3];
        if (method === 'GET' && parts.length === 3) {
          const game = store.getGame(id);
          return send(res, 200, { ...game, board: store.currentBoard(id) });
        }
        if (method === 'GET' && sub === 'legal-columns' && parts.length === 4) {
          const game = store.getGame(id);
          const seq = JSON.parse(game.sequence) as string[];
          if (game.current_step >= seq.length) {
            throw new ApiError('SEQUENCE_EXHAUSTED', '方块序列已用完', 409);
          }
          const piece = seq[game.current_step];
          const rotation = Number(url.searchParams.get('rotation') ?? '0');
          const board = store.currentBoard(id);
          return send(res, 200, {
            piece,
            rotation,
            columns: legalColumns(board, piece as never, rotation),
          });
        }
        if (method === 'POST' && sub === 'steps' && parts.length === 4) {
          const body = (await readBody(req)) as Record<string, unknown>;
          const result = store.playStep(
            id,
            body.rotation as number,
            body.column as number,
            body.expectedStep as number,
          );
          return send(res, 201, result);
        }
        if (method === 'GET' && sub === 'steps' && parts.length === 4) {
          return send(res, 200, store.listSteps(id));
        }
        if (method === 'GET' && sub === 'steps' && parts.length === 5) {
          return send(res, 200, store.getStep(id, Number(parts[4])));
        }
        if (method === 'POST' && sub === 'replay' && parts.length === 4) {
          return send(res, 200, store.replay(id));
        }
        if (method === 'GET' && sub === 'export' && parts.length === 4) {
          const game = store.getGame(id);
          return send(res, 200, {
            game,
            steps: store.listSteps(id),
            replay: store.replay(id),
          });
        }
      }
      throw new ApiError('BAD_REQUEST', `未知路由: ${method} ${url.pathname}`, 404);
    } catch (err) {
      if (err instanceof ApiError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      return send(res, 500, { error: { code: 'BAD_REQUEST', message: String(err) } });
    }
  });
}

export function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => {
      const srv2 = net.createServer();
      srv2.listen(0, '127.0.0.1', () => {
        const addr = srv2.address() as net.AddressInfo;
        srv2.close(() => resolve(addr.port));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
    });
  });
}

export async function startServer(): Promise<void> {
  const dbPath = process.env.TETRIS_DB ?? defaultDbPath();
  const store = new Store(dbPath);
  const preferred = Number(process.env.PORT ?? 3000);
  const port = await findFreePort(preferred);
  const server = createServer(store);
  server.listen(port, '127.0.0.1', () => {
    console.log(`方块硬降服务已启动: http://127.0.0.1:${port}  (数据库: ${dbPath})`);
  });
}

if (require.main === module) {
  void startServer();
}
