# 方块硬降落位与消行回放后端

纯后端实现：TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生依赖、无外部服务）。
在 Windows 本地直接运行，提供 HTTP API 与命令行（CLI），演示通过终端字符棋盘完成。

## 功能

- 矩形棋盘（4~100 行/列），单元值 0~7（0 为空，1~7 对应 I/O/T/S/Z/J/L）。
- 七种四格方块，各 4 个朝向的格子坐标公开（`GET /api/pieces`），按最小包围盒规范化。
- 硬降：方块从棋盘顶行按给定列进入，停在下一步会越界或碰撞的位置；
  进入位置即碰撞则该步结束（`SPAWN_BLOCKED`），棋盘不变。
- 锁定后一次性找出全部满行并同时移除，顶部补空行（不漏相邻满行，空隙行不算满行）。
- 每步结果：落点行、落距、锁定格子、被清除的原始行号、更新后的棋盘。
- 步号防重：每步需携带 `expectedStep`，重复/陈旧/跳号一律拒绝（`STALE_STEP`）且不改状态。
- SQLite 持久化初始布局、方块序列与每步事件；支持从头逐步回放并逐格校对。

## 环境要求

- Node.js 22.5 以上（推荐 23+，`node:sqlite` 免标志可用；本仓库在 Node 25 上验证）
- Windows 本地，无需 Docker / WSL / 网络服务

## 构建 / 测试 / 启动 / 演示

```bat
npm install        :: 安装 devDependencies（typescript、@types/node）
npm run build      :: 编译到 dist/
npm test           :: 构建并运行全部测试
npm start          :: 启动 HTTP API（默认端口 3000，被占用时自动选空闲端口）
npm run demo       :: 运行四个内置示例 + 陈旧步号演示（内存数据库）
```

端口与数据库可用环境变量覆盖：`PORT=8080`、`TETRIS_DB=E:\path\to.db`。
默认数据库位于项目内 `data\tetris.db`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/pieces` | 七种方块各朝向的规范化格子坐标 |
| POST | `/api/games` | 创建对局，body: `{initialBoard, sequence}` |
| GET | `/api/games` 与 `/api/games/:id` | 列出 / 查看对局（含当前棋盘） |
| GET | `/api/games/:id/legal-columns?rotation=0` | 当前方块某朝向的合法横向落点 |
| POST | `/api/games/:id/steps` | 执行一块，body: `{rotation, column, expectedStep}` |
| GET | `/api/games/:id/steps` 与 `/api/games/:id/steps/:n` | 查询步骤 |
| POST | `/api/games/:id/replay` | 从头回放并逐步校对，返回最终棋盘 |
| GET | `/api/games/:id/export` | 导出对局、全部步骤与回放结果 |

错误响应统一为 `{"error": {"code": "...", "message": "..."}}`，错误码：
`INVALID_BOARD`、`INVALID_SEQUENCE`、`INVALID_ROTATION`、`INVALID_COLUMN`、
`OUT_OF_BOUNDS`、`SPAWN_BLOCKED`、`STALE_STEP`、`SEQUENCE_EXHAUSTED`、
`GAME_NOT_FOUND`、`STEP_NOT_FOUND`、`BAD_REQUEST`。

## CLI

```bat
node dist/src/cli.js serve [端口]
node dist/src/cli.js create 10 10 IOTSZJL        :: 空棋盘 + 方块序列
node dist/src/cli.js create-with "0,0;1,0" IOT   :: 指定初始棋盘（也支持 JSON）
node dist/src/cli.js show 1
node dist/src/cli.js legal 1 0
node dist/src/cli.js play 1 0 3 1                :: 对局1 朝向0 列3 预期步号1
node dist/src/cli.js play-seq 1 "0:3,1:0"
node dist/src/cli.js steps 1
node dist/src/cli.js replay 1
node dist/src/cli.js export 1
```

## 内置示例（npm run demo）

1. 平地落块；2. 凹槽填补；3. 连续两行消除；4. 顶部堵塞（进入即碰撞，状态不变）；
5. 陈旧步号拒绝且历史完整保留。每个示例展示前后棋盘与被消除的原始行号，并回放校对。

## 测试覆盖

- 七种方块 x 4 朝向的规范化坐标与硬降；最左/最右边界与越界拒绝。
- 悬空平台、下方孔洞、一次清除两行/四行、空隙行不算满行、无法生成。
- 独立逐格校验：锁定格不重叠、落点不能再下降；
  占用格数守恒（旧格数 + 4 - 消行数 x 宽度）。
- 失败步骤不改变状态；重启（重开数据库文件）后步骤读取与逐步回放一致。
- API 全流程：创建、合法列、执行、重复步号 409、步骤查询、回放、导出。

## 假设与限制

- 方块从顶行进入（包围盒顶与棋盘顶对齐），不做贴墙旋转与进入缓冲。
- 单分支线性历史，无撤销；重复提交以 `STALE_STEP` 拒绝而非幂等返回。
- 棋盘单元值保留方块身份（1~7）仅用于展示，占用判断只看是否非零。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，属正常现象。
