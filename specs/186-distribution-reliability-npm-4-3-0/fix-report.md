# 问题修复报告 — F186 分发可靠性（npm 重发 4.3.0 + 防漂移）

## 问题描述

M8 轨道 A（SC-003）。npm 上的 `spectra-cli` 停在 **4.2.0**，不含 F175 起的所有修复（仓库现已到 F196）。"发布链滑了"是 M7 三教训之一。本 fix 重发 4.3.0 并机制化防止再次漂移，同时并入 5 个已 verify 的分发可靠性缺陷 + F195 帮助文本 synopsis 修复。

包含 7 个问题簇：

1. **npm 版本滞后** — canonical 在 `contracts/release-contract.yaml`（spectra.version=`4.2.0`），需 bump→4.3.0 + `release:sync` + `release:check`，禁手改 plugin.json/marketplace.json。
2. **codex wrapper 校验只查 header 标记不比对内容** — 实证漂移 11 天/66 commits 未被拦。
3. **`spectra --version` 无法区分新旧 build** — 只读 package.json version，缺 build 元数据。
4. **prepare 工具 detectedLanguages 是 ESM 死代码** — 裸 `require()` 在 ESM 必抛被吞，假绿。
5. **3/17 工具脱敏漏口** — 绝对路径泄露给 MCP 客户端。
6. **附带串（best-effort）** — orchestrator-cli/脚本 zod 缺依赖优雅降级、MCP server volta 启动鲁棒性、plugin 同名冲突行为文档化。
7. **F195 help synopsis 自相矛盾** — synopsis 行漏 `graph-only`。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | npm 为何停在 4.2.0？ | F170a 后没有再触发 `npm publish`，contract 版本也未 bump |
| Why 2 | 为何没人发现滞后？ | 没有任何门禁比对"已发布版本 vs 仓库版本"，CI 不含 publish gate |
| Why 3 | wrapper 漂移为何 11 天未拦？ | `validateWrapperMarkers` 只校验 4 个 header 片段 + 2 个 source/contract marker，**从不比对 body 内容**（`validate-wrapper-sources.mjs:62-126`）|
| Why 4 | 为何只校验 header？ | 初版假设"只要 wrapper 带正确 source 指针，人就会手动同步内容"——该假设在多 worktree/高频迭代下不成立 |
| Why 5 | 为何这些缺陷集体未被捕获？ | 测试用**整文件 `toContain`** 粗断言（helptext.test.ts）、脱敏点用**逐字 behavior-preserve** 豁免（agent-context-tools.ts:83-86 注释明确"不在重新脱敏范围"）、死代码用 try/catch 静默吞——三类盲区都缺**定点/语义断言** |

**Root Cause**: 分发链与一致性校验缺少**内容级（语义级）门禁**——版本、wrapper body、help synopsis、脱敏文案都靠"标记存在/整文件包含/逐字保留"这类**结构性弱断言**把关，无法捕获内容漂移与语义矛盾。

**Root Cause Chain**: npm 停 4.2.0 → 无 publish/版本比对门禁 → wrapper 只查 header 不查 body → 弱断言假设"人会手动同步" → 死代码/脱敏/synopsis 缺定点语义断言 → 缺陷集体逃逸。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `contracts/release-contract.yaml` | `products.spectra.version` | 版本滞后 | bump 4.2.0→4.3.0 + 更新 productMappingDescription（追加 4.3.0 changelog 行）→ `npm run release:sync` |
| `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | `validateWrapperMarkers` L62-126 | header-only 校验 | 写入并比对 source body sha256（见决策）|
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | entries | 无 body 指纹字段 | 增 `sourceSha256` 字段或在 wrapper header 嵌入 sha 标记 |
| `src/cli/index.ts` | L31-35, L137 | version 无 build 元数据 | 嵌入 commit hash（见决策）|
| `src/mcp/server.ts` | prepare handler L105-106 | 裸 `require('node:path'/'node:fs')` | 改用顶部已 import 的 `resolve` + 补 `statSync` import；try/catch 内补目录场景断言 |
| `src/mcp/agent-context-tools.ts` | `runAgentContextTool` catch L102-109 | 回传 err.message + stack.slice(0,200) | 脱敏为固定文案，drop stack（保留 `internal-error` code + telemetry）|
| `src/mcp/agent-context-tools.ts` | `loadGraphOrError` L129 | `graph.json 不存在...(projectRoot=${projectRoot})` | 对齐固定文案 `graph 未构建` + hint，去 projectRoot 内插 |
| `src/mcp/agent-context-tools.ts` | `loadGraphOrError` L148 | `graph.json 加载失败 (projectRoot=${projectRoot})` | 同上固定文案 |
| `src/cli/index.ts` | synopsis L43 | `--mode <full\|reading\|code-only>` 漏 graph-only | 补 `graph-only`，与详细行 L99 对齐 |
| `tests/unit/cli/helptext.test.ts` | 整文件 toContain | 弱断言放过 synopsis 漏项 | 升级为 synopsis 行定点断言 |

**固定文案先例（对齐目标）**: `src/mcp/file-nav-tools.ts:140`
`buildErrorResponse('graph-not-built', 'graph 未构建', '请先运行 \`spectra batch\` 生成图谱')` — 无 projectRoot 内插，14 个其他工具已是此形态，agent-context 三工具（impact/context/detect_changes，共享 `runAgentContextTool` + `loadGraphOrError`）是仅剩 3 个漏口。

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/mcp/agent-context-tools.ts` | `loadGraphOrError` stale 分支 L140 | `err.message` 直接回传 | 待评估：stale message 由 `isGraphFormatStaleError` 内部构造，是否含绝对路径需 plan 阶段确认；若含则一并脱敏（不破坏 3 处主修） |
| 其他 14 个 MCP 工具 | — | graph-not-built 文案 | `[安全]` 已用固定文案，无需改 |

### 同步更新清单

- **调用方**: `spectra --version` 改动 → 检查 `tests/` 下现有 CLI 版本断言（不能破坏）；helptext 断言升级需匹配新 synopsis 字面值
- **测试**: 新增 wrapper body 漂移检测测试（造漂移→校验失败）、prepare 目录场景 detectedLanguages 断言、3 处脱敏不泄露绝对路径断言、--version 含 commit hash 断言、synopsis 定点断言
- **文档**: plugin 同名冲突行为文档化（#6）；4.3.0 changelog 进 productMappingDescription
- **受控 release 行（禁手改，经 release:sync 生成）**: plugin.json / marketplace.json / package-lock.json / README badge

## 修复策略

### 方案 A（推荐）— 分层修复 + 语义门禁加固

按"先修内容漂移根因（门禁），再修个体缺陷"组织，TDD 优先：

1. **release-contract**: 改 contract 版本 + changelog → `release:sync` → `release:check`（不碰受控行）
2. **wrapper body 指纹**: 在 wrapper header 写入 source body `sha256` 标记，`validateWrapperMarkers` 增加 body 重算+比对（决策点见下）
3. **--version build 元数据**: prebuild 脚本生成 `src/build-info`（commit hash），`--version` 输出 `vX.Y.Z (<commit>)`
4. **prepare 死代码**: `require`→ESM import，补目录断言
5. **3 处脱敏**: 对齐 `file-nav-tools.ts:140` 固定文案
6. **synopsis + helptext 定点断言**
7. **#6 附带串**: best-effort（zod 优雅降级 / volta 鲁棒 / 同名冲突文档），不阻塞主验收

### 方案 B（备选）— 仅修 1+3+4+5+7，#2 wrapper 内容门禁延后

成本更低但**留下根因**（wrapper 内容仍可漂移），违背"机制化防再漂移"目标。**不推荐**。

### 🔑 待 plan 阶段二选一决策（用户/plan 拍板）

**#2 wrapper 内容比对方式**:
- **(a) hash 源文件 body**: wrapper header 嵌 `Source SHA256: <hash>`，校验时重算 canonical SKILL.md body sha256 比对。轻量、快。
- **(b) regenerate-and-diff**: 校验时重新生成 wrapper 与磁盘内容全文 diff。更强但慢、需可复现生成器。
- **先例**: spectra mirror 有"全文比对"先例（`secret-redactor.ts` 等用 createHash）。倾向 **(a)** — 与 mirror 全文比对精神一致但更轻。

**#3 commit hash 注入时机**: prebuild 生成 build-info 文件（npm 包无 `.git`，运行时 spawn git 不可行）→ 必须 build/publish 时 bake。需决定该文件是否入库（建议 gitignore + prebuild 生成，避免每次 commit 噪声）。

## Spec 影响

- 需要更新的 spec: **无需更新现有 spec.md**（本 fix 不改产品行为契约，只补分发可靠性与一致性门禁）。release-contract 的 productMappingDescription 追加 4.3.0 changelog 属受控元数据，非 spec。

## 范围提示

本 fix 触及 **~8 个文件 / 4 个模块**（contracts、scripts、src/cli、src/mcp），接近 fix 模式的范围上限但仍是一个**内聚的"分发可靠性"主题**，且用户已显式以 fix 模式 + 编号 186 启动并逐条 verify。判断：**继续 fix 模式**，以语义门禁为核心组织最小化修复；#6 附带串按 best-effort 分流，不扩散到工具源码大改。
