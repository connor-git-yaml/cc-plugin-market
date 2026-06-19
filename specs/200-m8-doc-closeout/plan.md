# Feature 200 — 技术规划（plan）

> 纯文档收口，无生产代码。核心风险在 **sync 链路一致性** 与 **文案与实际行为对齐**。

## 架构决策

### D1 — mainline-focus 改 source，不碰生成产物
`docs/shared/agent-mainline-focus.md` 是 source-of-truth；`CLAUDE.md` / `AGENTS.md` 的对应区块由 `npm run docs:sync:agents` 注入。只改 source + 跑 sync，禁止手改两个生成文件的区块（NFR-002）。验证用 `npm run repo:check`（含 agent-block-sync 断言）。

### D2 — CLI reference 以源码帮助文本为单一事实源
命令文案直接对齐 `src/cli/index.ts` 的 HELP_TEXT（已读取）与 `src/kb-mcp/server.ts` 工具清单。措辞复用源码里已校正过的诚实表述（如 graph-only "纯 AST / 零 LLM / 无需认证 / <2min 量级"），避免 over-claim（呼应 F183 帮助文本诚实校正、F186 synopsis 修复）。

### D3 — scaffold-kb 指南独立成文，与 demo FIXTURE.md 职责切分
新增 `docs/scaffold-kb-guide.md` 面向"如何自建并分发 KB plugin"；demo 的 `FIXTURE.md` 面向"这个 demo fixture 是什么"。指南内容来源：`spectra scaffold-kb` 四子命令帮助文本 + demo 的 `.mcp.json`/`plugin.json` 打包结构 + F190 spec 的双层（厂商只读 / 项目可写）模型。

### D4 — README 只动非受控区
Project Milestones 表、honest benchmark note 在 `spec-driver:section:*` 标记之外，可改；Documentation 链接区也在标记外（FR-009 链接落点）。受控区（badges/description/plugins-overview/spectra/spec-driver/plugin-installation/contributing/license）一律不碰。改前用标记定位边界（EC-2）。

### D5 — 历史 roadmap 轻量归档标注
三文档顶部 quote 区加一行 `> ✅ 历史归档（M8 时点）：……，当前主线见 …`，不重写正文（FR-010）。

## 受影响文件清单

| 文件 | 改动类型 | 关键约束 |
|------|---------|---------|
| `docs/shared/agent-mainline-focus.md` | 重写 | source-only，跑 sync |
| `CLAUDE.md` / `AGENTS.md` | 生成（sync 产出） | 不手改，由 D1 sync |
| `docs/spectra-cli-reference.md` | 增补 | graph-only + scaffold-kb + --version + See Also 链接 |
| `docs/spec-driver-modes.md` | 增补 | 委派契约说明 |
| `docs/configuration.md` | 增补 | orchestration phase 覆盖 caveat |
| `README.md` | 增补（非受控区） | Milestone M8 行 + KB 行 + Documentation 链接 |
| `docs/scaffold-kb-guide.md` | 新增 | how-to，通用化表述 |
| `docs/spectra-v4-hotfix-roadmap.md` | 标注 | 顶部归档行 |
| `docs/spectra-v4.1-feature-b-plan.md` | 标注 | 顶部归档行 |
| `docs/spectra-v4.1-mapreduce-architecture.md` | 标注 | 顶部归档行 |

## 验证策略

1. **sync 一致性**：`npm run docs:sync:agents` → `git diff` 检视 CLAUDE.md/AGENTS.md 仅同步区块变化 → `npm run repo:check` 全绿。
2. **命令实跑抽查**（NFR-003，verify 阶段）：
   - `spectra --version`（或 `npx tsx src/cli/index.ts --version`）确认含 build 后缀或优雅回退
   - `... batch --help` 确认 `--mode` 含 graph-only
   - `... scaffold-kb --help` / 子命令帮助确认四子命令存在
3. **受控区零改动**：`git diff README.md` 确认 `spec-driver:section:*` 区块内无改动；`npm run release:check` 绿。
4. **通用化扫描**：grep 新增/改动文档无具体客户/公司名（NFR-001）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| sync 脚本不识别改坏的源块格式（EC-1） | 保留原 heading 结构与标点，仅改正文 bullet |
| 误改 README 受控区（EC-2） | 改前按 section 标记定位，diff 复核 |
| dev 环境 `--version` 无 build 元数据（EC-4） | 文案措辞为"含 build commit 后缀（当 build 元数据存在时）" |
| 指南与 FIXTURE 重复（EC-3） | D3 职责切分 |

## 不引入

- 不新增依赖、不改 package.json、不改 release contract、不改 src/。
