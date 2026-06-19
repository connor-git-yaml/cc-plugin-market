# Feature 200 — M8 文档收口：用户文档与 M8 实际行为对齐

> **Mode**: spec-driver-story（纯文档，无生产代码）
> **Milestone**: M8（收官件，原 plan §2.6 的 F192 doc 收口角色——原 F191/F192 编号被 KB 轨道占用，重新认定为 F200）
> **状态**: spec

## 背景与问题

M8 改了大量对外行为（增量默认语义、`--version`、npm 4.3.0、委派契约、`graph-only`、KB 新 CLI + MCP），但用户文档尚未同步收口，已坐实多处系统性漂移。

### 已 verify 的漂移点

1. 🔴 **`docs/shared/agent-mainline-focus.md` 活漂移**：仍写"主线 = panoramic Phase 1（Feature 040/041/051）"。该文件经 `npm run docs:sync:agents` 注入 `CLAUDE.md` / `AGENTS.md`，**每个新会话都被它误导**到一条已经不是主线的方向。需重写为 M8 后真实主线。
2. **`docs/spectra-cli-reference.md` 缺三项 M8 能力**：
   - F186 `spectra --version` 现输出 build commit 后缀（区分新旧 binary），文档未提
   - F195 `batch --mode graph-only`（纯 AST · 零 LLM · 无需认证 · <2min 量级）——`--mode` 取值表缺 `graph-only`
   - F190 `spectra scaffold-kb` 新命令族（build / ingest / serve / query）整组缺失
3. **`docs/spec-driver-modes.md` / `docs/configuration.md` 缺 F185 委派契约说明**：委派硬约束已扩展到全 skill（含 resume），orchestration phase 覆盖仅 feature 模式运行时生效的 caveat 未文档化。
4. **`README.md` M8 行未 Delivered**：Project Milestones 表 M8 仍 `📋 Planning`；缺 KB 能力一行；npm 4.3.0 / build 元数据未体现在叙述层。
5. **缺 scaffold-kb 用户使用指南**：F190/F192 自带 demo fixture（`plugins/demo-kb-{zh,en}/`）与设计文档，但 `docs/` 下无面向"厂商构建定制 KB plugin"的 how-to。
6. **历史 roadmap 文档无归档标注**：`spectra-v4-hotfix-roadmap.md` / `spectra-v4.1-feature-b-plan.md` / `spectra-v4.1-mapreduce-architecture.md` 状态仍写"待启动 / 排期中 / 规划已定稿"，易误导读者以为是当前活跃路线。

## M8 真实主线（ground truth，源自 milestone-M8 设计文档 amendment_2026-06-19）

- **轨道 A — 可信度修复**：F182（增量缓存正确性）/ F183（graph 一致性收口）/ F184（子代理 MCP 触发率工程）/ F185（spec-driver 委派契约与编排单源化）/ F186（分发可靠性，contract 4.3.0 + `--version` build 元数据，**npm publish 待显式授权**）/ F187（评测设施 v2，FAIL_TO_PASS oracle）/ F188（M7 数据离线重判 + 触发率复测，**就绪待派**）
- **轨道 B — 旗舰启动**：F189（AST-anchored spec drift detection，**仅 spec + prototype，不求 ship**）
- **轨道 C — 领域知识 AI 脚手架**（M8 最大计划外扩张）：F190（scaffold-kb MVP：doc-graph + FTS5 + KB MCP 双层联查）→ F191（research 预查注入 Phase 1.5）→ F192（Phase 2：API 实体层 + 三方导入 + 冲突仲裁 + `kb_api_lookup`）
- **计划外 ship**：F193（graph id 相对化 + worktree 开箱）/ F194（walker .gitignore 收紧）/ F195（graph-only 纯 AST 建图）/ F196（MCP description 漂移守护）/ F197（评测公正性收口）/ F198+F199（zod 缺失优雅降级）/ F176（swebench 预注册冻结）

## 用户故事

### US-1（P0）— 新会话不再被 mainline-focus 误导
**作为** 任何在本仓库启动新会话的 agent / 贡献者，
**我希望** `agent-mainline-focus.md`（及其同步进 CLAUDE.md/AGENTS.md 的区块）反映 M8 后真实主线，
**以便** 不被"主线 = panoramic Phase 1"的陈旧描述带偏。

### US-2（P1）— CLI 用户能查到 M8 新增的命令与行为
**作为** spectra CLI 用户，
**我希望** CLI reference 覆盖 `--version` build 元数据、`batch --mode graph-only`、`scaffold-kb` 命令族，
**以便** 不靠读源码就能用上 M8 能力。

### US-3（P1）— spec-driver 用户理解委派契约与 orchestration caveat
**作为** spec-driver 用户，
**我希望** modes / configuration 文档说明委派硬约束覆盖面与 phase 覆盖仅 feature 运行时生效的 caveat，
**以便** 正确预期 override 行为、不误以为 fix/story 的 phase 覆盖已生效。

### US-4（P1）— 厂商能照 how-to 构建定制 KB plugin
**作为** 想构建"精通其 SDK 的 AI 脚手架"的厂商 / 开发者，
**我希望** 有一份 scaffold-kb 使用指南（build → 打包 → 集成商开箱查询 + 项目级 ingest），
**以便** 不靠读 spec/源码就能上手。

### US-5（P2）— 读者能区分历史路线与当前路线
**作为** 浏览 docs 的读者，
**我希望** 历史 roadmap 文档有明确"已完成/历史归档"标注，
**以便** 不误把陈旧路线当成当前计划。

## 功能需求（Functional Requirements）

- **FR-001**：重写 `docs/shared/agent-mainline-focus.md`，描述 M8 后真实主线（trust-repair + KB 脚手架 + graph-only + drift 原型 + 评测设施 v2），并保留"处理相关任务优先沿用现有抽象"类长期稳定指引。删除 panoramic Phase 1 作为"当前主线"的表述（panoramic 已是既有能力而非活跃重心）。
- **FR-002**：改完 `agent-mainline-focus.md` 后运行 `npm run docs:sync:agents`，使 `CLAUDE.md` 与 `AGENTS.md` 的同步区块一致；`npm run repo:check` 的 agent-block-sync 校验必须绿。
- **FR-003**：`docs/spectra-cli-reference.md` 的 `--mode` 取值/批处理命令补 `graph-only`（纯 AST · 零 LLM · 无需认证 · <2min 量级 · 写 graph.json）。
- **FR-004**：`docs/spectra-cli-reference.md` 新增 `scaffold-kb` 命令族文档（build / ingest / serve / query 四子命令 + 参数）与 KB MCP 三工具（`kb_search` / `kb_doc_lookup` / `kb_api_lookup`）说明，含 untrusted-evidence 消费边界。
- **FR-005**：`docs/spectra-cli-reference.md` 说明 `spectra --version` 现含 build commit 元数据（区分新旧 binary，F186）。
- **FR-006**：`docs/spec-driver-modes.md` 说明 F185 委派硬约束已覆盖全 skill（含 resume），描述其语义。
- **FR-007**：`docs/configuration.md`（或 modes，择一最合适处）增加 orchestration phase 覆盖"仅 feature 模式运行时消费 get-phases，fix/story/refactor 的 phase 覆盖当前不在运行时生效"的 caveat。
- **FR-008**：`README.md` 非受控区（Project Milestones 表 + 叙述层）：M8 行标 `✅ Delivered` 并更新 Highlights（含 KB 脚手架 / graph-only / 评测设施 v2 / drift 原型 / npm 4.3.0）；新增/更新 KB 能力描述行。**不得手改 `<!-- spec-driver:section:* -->` 受控区**（由 release contract + `release:sync` 管辖）。
- **FR-009**：新增 `docs/scaffold-kb-guide.md`（或等价路径）——厂商构建定制 KB plugin 的 how-to，链接进 README Documentation 区与 CLI reference 的 See Also。
- **FR-010**：历史 roadmap 三文档（`spectra-v4-hotfix-roadmap.md` / `spectra-v4.1-feature-b-plan.md` / `spectra-v4.1-mapreduce-architecture.md`）顶部加轻量"✅ 已完成 / 历史归档"标注（不重写正文）。

## 非功能需求 / 约束

- **NFR-001（通用定位红线）**：所有入库文档不得写入具体客户 / 公司名 / 行业绑定；客户一律抽象为"某 SDK 厂商 / 某垂直行业 / 集成商"。Apache ECharts 等公开开源项目仅作"某公开 SDK"的实例呈现可保留。
- **NFR-002（sync 链路）**：`docs/shared/*` 改动只改 source，经 `docs:sync:agents` 同步，禁止手改 `CLAUDE.md` / `AGENTS.md` 的受控区块。
- **NFR-003（文案准确性）**：文档中出现的命令以源码（`src/cli/index.ts` 帮助文本 / `src/kb-mcp/server.ts` 工具清单）为准；关键命令（`--version` / `batch --mode graph-only` / `scaffold-kb`）在 verify 阶段实跑抽查确认文案准确。
- **NFR-004（受控区不触碰）**：README 的 `spec-driver:section:*` 区块、badges 行、版本号行由 release contract 管辖，本 feature 不动。
- **NFR-005（无生产代码）**：本 feature 仅改 `*.md` 与运行 sync 脚本产出的同步区块，不改 `src/` 任何源代码。

## Edge Cases

- **EC-1**：`docs:sync:agents` 同步后若 `repo:check` 仍报 agent-block-sync drift → 说明源块格式（heading/标点）被改坏，需回退到 sync 可识别格式。
- **EC-2**：README 受控区与非受控区边界——Milestone 表与 honest benchmark note 在 section 标记之外（可改），description/badges/plugins-overview/spectra/spec-driver/plugin-installation 等在标记之内（不可改）。
- **EC-3**：scaffold-kb how-to 若与 demo fixture 的 FIXTURE.md 重复——指南应面向"如何自建"，FIXTURE.md 面向"这个 demo 是什么"，二者职责不同不重复。
- **EC-4**：`--version` build 元数据在未跑过盖章脚本的 dev 环境可能只回退到裸版本号——文档措辞需说明"含 build commit 后缀（当 build 元数据存在时）"，不 over-claim。

## 验收标准（Acceptance Criteria）

- **AC-1**：`agent-mainline-focus.md` 反映真实主线；`docs:sync:agents` 后 `CLAUDE.md`/`AGENTS.md` 同步区块一致；`repo:check` 全绿（含 agent-block-sync）。
- **AC-2**：CLI reference 含 `graph-only` / `scaffold-kb` 命令族 / `--version` build 元数据；抽查命令实跑与文案一致。
- **AC-3**：modes/configuration 含委派契约 + orchestration caveat。
- **AC-4**：README M8 行 `✅ Delivered` + KB 能力行；受控区零改动。
- **AC-5**：`docs/scaffold-kb-guide.md` 存在且被 README / CLI reference 链接。
- **AC-6**：历史 roadmap 三文档有归档标注。
- **AC-7**：全程无具体客户/公司名/行业绑定；无 `src/` 改动。
- **AC-8**：`repo:check` + `docs:sync:agents` 全绿（`release:check` 若 README 受控区未动则保持绿）。

## 非目标（Out of Scope）

- 不做 npm publish（对外不可逆，F186 已声明待显式授权）。
- 不产出 PUBLISH-REPORT-M8（F188 评测产物，另轨）。
- 不改 release contract / 版本号 / 受控 release 行。
- 不改任何 `src/` 生产代码或测试。
- 不重写历史 roadmap 正文（仅加轻量归档标注）。
