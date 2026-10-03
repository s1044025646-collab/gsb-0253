import * as http from "node:http";
import { GameService, ApiError } from "./service";

const svc = new GameService();

async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ApiError("BAD_JSON", "请求体不是合法 JSON"); }
}

function send(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const m = url.pathname.match(/^\/games(?:\/(\d+)(?:\/(legal-moves|steps|replay|export|play|play-sequence)(?:\/(\d+))?)?)?$/);
      if (!m) throw new ApiError("NOT_FOUND", "路由不存在", 404);
      const id = m[1] ? Number(m[1]) : null;
      const sub = m[2];
      const b = await body(req);

      if (req.method === "POST" && !id) return send(res, 201, svc.createGame((b as any).board, (b as any).sequence));
      if (!id) throw new ApiError("BAD_REQUEST", "缺少 gameId");
      if (req.method === "GET" && !sub) return send(res, 200, svc.getState(id));
      if (req.method === "GET" && sub === "legal-moves") return send(res, 200, svc.legalMoves(id));
      if (req.method === "GET" && sub === "steps" && !m[3]) return send(res, 200, svc.listSteps(id));
      if (req.method === "GET" && sub === "steps" && m[3]) return send(res, 200, svc.getStep(id, Number(m[3])));
      if (req.method === "GET" && sub === "replay") return send(res, 200, svc.replay(id));
      if (req.method === "GET" && sub === "export") return send(res, 200, svc.exportGame(id));
      if (req.method === "POST" && sub === "play") return send(res, 200, svc.playStep(id, b as any));
      if (req.method === "POST" && sub === "play-sequence") return send(res, 200, svc.playSequence(id, (b as any).moves));
      throw new ApiError("NOT_FOUND", "路由或方法不支持", 404);
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.http, { error: { code: e.code, message: e.message } });
      send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 0; // 默认选择空闲端口
  server.listen(port, () => {
    const addr = server.address();
    console.log(`harddrop API 已启动: http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
  });
}
