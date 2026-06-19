# Feature 200 — 任务分解（tasks）

> 顺序：内容编辑 → sync → 验证。所有提交用显式路径，禁 `git add -A`，排除 `specs/**/src.spec.md`。

## 批① — source-of-truth 与 sync 链路（最高优先，影响每个新会话）

- [ ] **T001** 重写 `docs/shared/agent-mainline-focus.md` 为 M8 后真实主线（FR-001）
  - 保留 `## 当前主线焦点` heading（sync 识别）；正文 bullet 改为三轨能力 + 既有抽象指引
- [ ] **T002** 跑 `npm run docs:sync:agents`，检视 `CLAUDE.md`/`AGENTS.md` 仅同步区块变化（FR-002）
- [ ] **T003** 跑 `npm run repo:check`，确认 agent-block-sync 等全绿（FR-002 / AC-1）

## 批② — CLI reference 增补（FR-003/004/005）

- [ ] **T004** `docs/spectra-cli-reference.md` `--mode` 取值/命令区补 `graph-only`（纯 AST·零 LLM·无需认证·<2min）
- [ ] **T005** 新增 `scaffold-kb` 命令族小节（build/ingest/serve/query + 参数）+ KB MCP 三工具说明 + untrusted-evidence 边界
- [ ] **T006** 增补 `spectra --version` build commit 元数据说明
- [ ] **T007** See Also 区链接到新建的 scaffold-kb 指南

## 批③ — spec-driver 文档（FR-006/007）

- [ ] **T008** `docs/spec-driver-modes.md` 补 F185 委派硬约束（全 skill 含 resume）说明
- [ ] **T009** `docs/configuration.md` 补 orchestration phase 覆盖"仅 feature 运行时生效"caveat

## 批④ — README 非受控区（FR-008）

- [ ] **T010** Project Milestones 表 M8 行改 `✅ Delivered` + 更新 Highlights（KB/graph-only/eval v2/drift/npm 4.3.0）
- [ ] **T011** 叙述层补 KB 能力行；Documentation 区加 scaffold-kb 指南链接
- [ ] **T012** diff 复核：`spec-driver:section:*` 受控区零改动（EC-2 / NFR-004）

## 批⑤ — 新增 KB 指南 + 历史归档（FR-009/010）

- [ ] **T013** 新增 `docs/scaffold-kb-guide.md`（厂商自建 KB plugin how-to，通用化表述）
- [ ] **T014** 三历史 roadmap 文档顶部加归档标注

## 批⑥ — 验证（AC-1..AC-8）

- [ ] **T015** 命令实跑抽查：`--version` / `batch --help`（graph-only）/ `scaffold-kb --help`（NFR-003）
- [ ] **T016** 通用化 grep 扫描（无客户/公司名，NFR-001）+ 确认无 `src/` 改动（NFR-005）
- [ ] **T017** 终验：`npm run repo:check` + `npm run release:check`（如涉及）全绿
- [ ] **T018** codex 对抗审查（聚焦 mainline-focus 重写 + 关键文案准确性）

## 依赖

- T002/T003 依赖 T001
- T007 依赖 T013（链接落点）
- T012 依赖 T010/T011
- 批⑥ 依赖 批①-⑤ 全部完成
