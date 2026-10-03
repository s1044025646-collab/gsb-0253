# 方块硬降落位与消行回放后端

离线 TypeScript + Node.js + SQLite 后端：管理矩形棋盘与按顺序给定的七种四格方块（I/O/T/S/Z/J/L），计算指定朝向与横向位置下的硬降落点与同时消行结果，支持逐步事件持久化与从头回放校对。仅 API 与 CLI，无图形界面。

## 环境要求

- Windows 本地，Node.js >= 22.5（使用内置 `node:sqlite`，无需原生编译、Docker 或外部服务）
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）

## 快速开始

```powershell
npm install
npm run build     # 编译到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动 API（默认自动选择空闲端口；PORT=8080 可指定）
npm run demo      # 运行四个内置场景演示（终端字符棋盘）
npm run cli -- <命令>   # 使用 CLI
```

数据保存在项目内 `data/` 目录（可用环境变量 `HARDDROP_DATA_DIR` 覆盖）。

## 规则要点

- 方块朝向以最小包围盒规范化的格子坐标公开（`src/engine.ts` 中 `PIECES`），rotation 取 0..3，重复朝向自动去重（O 1 种、I/S/Z 2 种、T/J/L 4 种）。
- 方块包围盒顶对齐棋盘第 0 行、按给定列 `left` 进入；首次位置已碰撞则该步以 `failed` 结束且不改变棋盘。
- 硬降逐行下移，停在“再降一行必越界或碰撞”的位置；锁定后一次性找出全部满行同时移除，顶部补空行。
- 棋盘必须是 4..64 行 × 4..64 列的矩形，单元值为 0..7 的整数（0 为空，1..7 可用于标记方块身份，不影响占用判断）。
- 每步必须携带 `expectedStep`：等于当前进度 +1 才执行；重复/陈旧步号返回 `STALE_STEP`，跳步返回 `STEP_GAP`，均不会多落方块。失败步骤（生成碰撞）会记录事件但棋盘不变。

## HTTP API

默认端口为空闲端口（启动时打印），`PORT` 环境变量可指定。所有错误返回 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/games` | 创建对局：`{board, sequence:[{type,rotation}]}` |
| GET | `/games/:id` | 当前状态（进度、下一块、棋盘） |
| GET | `/games/:id/legal-moves` | 当前方块的合法横向落点 |
| POST | `/games/:id/play` | 执行一块：`{expectedStep,type,rotation,left}` |
| POST | `/games/:id/play-sequence` | 按序列执行多块：`{moves:[{left},...]}` |
| GET | `/games/:id/steps` | 步骤列表 |
| GET | `/games/:id/steps/:n` | 查询某一步（落点、落距、锁定格、消行、棋盘） |
| GET | `/games/:id/replay` | 从初始布局逐步重放并返回每步棋盘 |
| GET | `/games/:id/export` | 导出完整对局 JSON |

错误码：`BAD_BOARD` / `BAD_SEQUENCE` / `BAD_PIECE` / `BAD_ROTATION` / `BAD_COLUMN` / `BAD_STEP` / `BAD_JSON`（参数校验），`GAME_NOT_FOUND` / `STEP_NOT_FOUND`（404），`STALE_STEP` / `STEP_GAP` / `PIECE_MISMATCH` / `SEQUENCE_DONE`（409），`OUT_OF_BOUNDS`（横向越界），`REPLAY_MISMATCH`（500）。

每步成功结果包含：`top`/`left`（落点包围盒）、`dropDistance`（落距）、`lockedCells`（锁定格绝对坐标）、`clearedRows`（被消除的原始行号）、`board`（更新后棋盘）。

## CLI

```powershell
node dist/src/cli.js create board.json sequence.json   # 创建对局
node dist/src/cli.js state <gameId>                    # 查看状态与字符棋盘
node dist/src/cli.js legal <gameId>                    # 合法横向落点
node dist/src/cli.js play <gameId> <expectedStep> <type> <rotation> <left>
node dist/src/cli.js play-seq <gameId> 3,4,0           # 按序列执行多块
node dist/src/cli.js steps <gameId> / step <gameId> <n>
node dist/src/cli.js replay <gameId>                   # 回放校对
node dist/src/cli.js export <gameId> [out.json]
```

## 演示场景

`npm run demo` 依次运行：平地落块、凹槽填补、连续两行消除、顶部堵塞（无法生成），展示落子前后棋盘、被消除行号，并对每个场景做逐步回放校对。

## 测试

`npm test` 覆盖：七种方块各朝向、最左/最右边界、悬空平台、下方孔洞、一次清除相邻多行、带空隙行不算满行、顶部无法生成、棋盘校验、失败/非法输入不改状态、陈旧步号拒绝且历史保留、重启后步骤读取，以及逐步重放与落子结果一致、占用格数守恒（旧格数 + 4 − 消行数 × 宽度）、锁定格不重叠且不能再下降。

## 目录结构

- `src/engine.ts` 方块定义、碰撞、硬降、同时消行、棋盘渲染
- `src/service.ts` 对局服务（步号幂等、校验、回放、导出）
- `src/db.ts` SQLite 持久化（games / steps 两表）
- `src/server.ts` HTTP API
- `src/cli.ts` 命令行
- `src/demo.ts` 四个演示场景
- `test/engine.test.ts` 测试

## 假设与限制

- 方块从顶行进入，不做缓冲区/部分超出顶部的生成；顶部碰撞即该步失败（游戏结束语义由调用方决定）。
- 仅单分支线性历史，不支持撤销与分支。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，属正常现象。
- 方块身份（1..7）仅用于展示，占用判断只看是否非 0。
