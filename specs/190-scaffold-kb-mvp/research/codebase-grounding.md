# Codebase Grounding — F190 plan 阶段输入

主线程在 specify 后、plan 前对仓内可复用资产的实测盘点（read-only），供 plan 直接引用。

## 1. CLI 接线点（F186 协调）

- `src/cli/index.ts` 是 `spectra <subcommand>` 调度器（dispatcher）。`scaffold-kb` 应作为**新 subcommand**接入：
  - 新增 `import { runScaffoldKb } from './commands/scaffold-kb.js'`（约 :12-28 区）
  - switch 新增 `case 'scaffold-kb':`（约 :146-198 区，prompt 所指 ":150 区命令注册"）
  - HELP_TEXT 增一行（约 :43 batch 行附近 → **F186 也改 :43/--version**，冲突区 → 先 ship 先 push，后者 rebase）
  - 命令形态：`spectra scaffold-kb build --llms-txt <URL> | --dir <path> --output <kb/>`（不新增 bin，避免改 package.json bin + release contract）
- 命令实现放 `src/cli/commands/scaffold-kb.ts`，构建逻辑放 `src/scaffold-kb/`。

## 2. MCP 骨架复用（FR-006 零回归核心）

`src/mcp/server.ts` 现注册 **17 工具**（5 直注 + graph/agent-context/file-nav 三组 register*）。复用模式：
- `server.tool(name, description, zodSchema, withTelemetry(name, handler))`
- `{code}` 错误契约：`buildErrorResponse('invalid-input' | 'internal-error', msg)`（`src/mcp/lib/tool-response.ts`）—— 注意脱敏：内部错误不回传绝对路径原文（F177）
- telemetry：`withTelemetry(toolName, handler)`（`src/mcp/lib/telemetry.ts`）
- `instructions` / `TOOL_GUIDE`（F184，≤1600 字符，server 级一次性导览）

**零回归路径（强烈推荐）**：KB MCP 走**独立 server**——新建 `src/kb-mcp/server.ts` 的 `createKbMcpServer()`，复用 `src/mcp/lib/{tool-response,telemetry}`，**完全不碰** `src/mcp/server.ts`（17 工具一行不动 → SC-008 天然成立）。新 server 经新 CLI 子命令或 demo plugin 的 `.mcp.json` 启动。KB 工具用 `registerKbTools(server)` 模块化注册。

## 3. SQLite 依赖选型约束（FR-014 / NFR 8.2）

- `package.json` engines = **node >=20.0.0** → 内置 `node:sqlite`（Node 22.5+）**不可用**（除非抬高 node 下限，代价大）。
- 现有 deps 无任何 sqlite。这是**全新运行时依赖**（宪法原则 IX）。
- 现实候选收窄为二选一：`better-sqlite3`（native addon，arm64/x64 需预编译，打包随平台）vs WASM sqlite（`sql.js` / `wa-sqlite`，零跨平台编译但需验证 FTS5 + P95≤200ms 性能）。plan 必须给出选型 + 跨平台打包验证方案 + 不破坏 `npm run build`/CI 的论证。

## 4. plugin / marketplace 打包（FR-012 demo plugin）

- `.claude-plugin/marketplace.json` 列已发布 plugin（spectra / spec-driver）；`plugins/<name>/.claude-plugin/plugin.json` + `.mcp.json`（指向 MCP server）。
- 🔴 marketplace.json 与 plugin 版本元数据受 **`contracts/release-contract.yaml` + `npm run release:sync`** 管控，禁手改受控行。
- **待 plan/clarify 决策**：demo-kb-{zh,en} 是进真实 marketplace.json（发布品，含三方 SDK 文档 → license 风险）还是只作**测试夹具 marketplace**（test-only，不发布）？倾向后者：demo 仅验证"安装即用"分发路径，用 test fixture marketplace，不污染发布合同。

## 5. 复用清单（设计文档 §1.5 已列，落到具体路径）

| 资产 | 路径 | 复用点 |
|------|------|--------|
| MCP 工具骨架 + {code} + telemetry | `src/mcp/{server,lib}` | KB MCP server |
| panoramic doc-graph 思路 | `src/panoramic/` | doc-graph.json 构建（需泛化输入到任意文档目录）|
| F174 fuzzy match | （graph 侧）| API 符号容错查询参考 |
| marketplace 分发 | `.claude-plugin/` + `plugins/` | demo plugin 分发底座 |
| 文件扫描 | `src/utils/file-scanner.ts` | `--dir` 文档目录扫描 |

## 6. WASM sqlite 实证（plan 阶段主线程亲测，2026-06-14）

- 🔴 **`sql.js` 默认 npm 发行版不含 FTS5**：`/tmp` 实测 `CREATE VIRTUAL TABLE t USING fts5(...)` → `no such module: fts5`。**plan 初版选 sql.js 是错的**，会在 implement 期爆。
- ✅ **`@sqlite.org/sqlite-wasm` 含 FTS5 且 Node 可用**：实测 SQLite 3.53.0、FTS5 AVAILABLE、`unicode61` 对空格分隔的 CJK 单字正常索引匹配、`sqlite3.capi.sqlite3_js_db_export(db)` 导出字节可落盘 `chunks.sqlite`。→ **改用此包**（保持 WASM/零原生编译 = 用户 NC-004 决策不变）。
- 用法：`import sqlite3InitModule from '@sqlite.org/sqlite-wasm'; const sqlite3 = await sqlite3InitModule(); const db = new sqlite3.oo1.DB(':memory:')`；查询 `db.exec({sql, rowMode:'array', resultRows})`；纯内存 DB → 落盘用 export 字节、加载用读字节后 import。
- bigram 预切验证：空格分隔的 CJK 字符（`错 误 码`）被 unicode61 逐字索引 → 写入侧 unigram+bigram 预切方案成立。

## 7. plugin .mcp.json 启动约定（实测）

- 现有 `plugins/spectra/.mcp.json` = `{"mcpServers":{"spectra":{"command":"spectra","args":["mcp-server"]}}}` —— **复用已装的 `spectra` bin**，不写绝对路径、不写 node 入口文件。
- `${CLAUDE_PLUGIN_ROOT}` 是 plugin 相对路径变量（hooks.json/postinstall.sh/README 已用）。
- → demo plugin .mcp.json 应为：`{"command":"spectra","args":["scaffold-kb","serve","--vendor-kb","${CLAUDE_PLUGIN_ROOT}/kb"]}`。**`scaffold-kb serve` 因此是 MVP 必需子命令**（plan 初版标"可暂缓"是错的）；不要用 `kb-server-entry.js` + 绝对路径（安装态会失效）。

## 8. 错误码契约（读 src/mcp/lib/tool-response.ts 确认）

- `ErrorCode` 是固定 union（graph-not-built / invalid-input / internal-error 等），KB 业务码（INVALID_QUERY 等）不在其中。
- `buildErrorResponse(code, message, hint?, context?)` 把 `{code,message,hint?,context?}` 序列化进 payload —— `code` 与 `context` 都是可被 `JSON.parse(result.content[0].text)` 机械断言的结构化字段。
- → KB 校验错误用 `buildErrorResponse('invalid-input', msg, hint, { kbCode: 'INVALID_TOP_K' })`，EC-010 断言 `context.kbCode`；**不改 tool-response.ts 的 union**（零回归不碰 src/mcp）。
