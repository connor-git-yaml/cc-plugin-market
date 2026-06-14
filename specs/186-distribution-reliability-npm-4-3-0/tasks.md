---
feature: F186
title: 分发可靠性修复 — npm 重发 4.3.0 + 防漂移门禁
mode: fix
status: ready-to-implement
created: 2026-06-14
---

# F186 修复任务清单 — 分发可靠性（npm 4.3.0）

**实施顺序（plan.md 定义）**: T1 → T6 → T5 → T4 → T3 → T2 → [全量门禁] → Publish 准备 → T7（best-effort）

**并行机会**: T1 / T5 / T6 三组彼此独立，可并行执行。T4 建议在 T1 版本号稳定后再动（虽然不强依赖，但确认版本后再写 telemetry 日志前缀更安全）。T3 建议在 T2 之前完成（wrapper 校验脚本引入新工具方法后完整测试更稳）。

**提交约定**: 显式路径提交，禁 `git add -A`，`specs/src.spec.md` 排除出 commit。

---

## 🔴 FINAL 设计审查处置（Codex 对抗审查后，覆盖下方一切冲突项）

> 本节为权威定稿。下方 Phase 各任务凡与本节冲突，**一律以本节为准**。处置依据见 plan.md 末「Codex 对抗审查处置」。

**[CRITICAL-2 已采纳] T2 — 缺 `Source SHA256:` = FAIL（不是 warn）**
- 仓库内 wrapper 由 `codex-skills.sh` 重新生成，全部会带 sha。缺 sha 即视为漂移/被手改 → `status: fail`（否则 `repo:check` 以 0 退出，门禁被旁路）。
- 删除 T016 用例 3「旧格式 → warn」，改为「无 `Source SHA256:` 行 → **fail**」。T018 同步：missing → fail。

**[WARNING-1 已采纳] T2 — 抽单一 Node body 提取 helper（消除双实现逐字节风险）**
- 新建 `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`，导出 `extractWrapperBody(sourceSkillPath): string`（awk 等价的 frontmatter 剥除 + `rewrite_codex_runtime_text` 的 9 条替换的纯 JS 等价）与 `computeWrapperBodySha256(sourceSkillPath): string`。
- `codex-skills.sh` 的 `write_skill_body` 改为调用 `node .../extract-wrapper-body.mjs <source>` 产出 body；`write_wrapper_source_contract` 调 helper 算 sha 写 `- Source SHA256: <hash>`。**两端共用同一 helper，杜绝分叉**。
- T019 一致性验证升级为「重生成 8 个 wrapper 后 `git diff` body 部分必须为空（字节等同旧 awk|sed 产出）」+「helper 单测覆盖 frontmatter 剥除 + 9 条替换」。
- 重新生成全部 8 个 wrapper（带 sha 行），纳入 commit。

**[WARNING-2 + INFO-2 已采纳] T3 — 复用 F176 盖章机制，废弃 build-info.ts**
- **作废** T012（gen-build-info.mjs）、`src/build-info.ts`、T014 的 `.gitignore` 追加与 prebuild 改动中关于 build-info 的部分。
- 改为：`src/cli/index.ts` 的 `--version` 运行时 `readFileSync` + try/catch 读取 `dist/.spectra-build-meta.json`（F176 `stampBuild` 产出，字段 `{commit, dirty, builtAtIso}`），有则输出 `spectra v${version} (${commit前7位})`，无/读失败则退回 `spectra v${version}`（优雅降级）。**无任何静态 import gitignored 文件** → clean checkout tsc/vitest 不受影响。
- 确保 publish build 会盖章：在 `package.json` 增 `postbuild` 调 `stampBuild`（或令 `prepublishOnly` 走 `build:stamped`），使 `npm run build` 后 `dist/.spectra-build-meta.json` 存在。`dist/` 已在 `files`，随包发布。
- T011 version 测试改为：mock/临时写 `dist/.spectra-build-meta.json` → 含括号后缀；删除该文件 → 退回纯版本号。T015 pack 验证改为确认 `dist/.spectra-build-meta.json` 在包内、无 `src/build-info.ts`。

**[CRITICAL-1 处置：维持用户定 3 处] T4 — 只脱敏 agent-context 的 3 处 projectRoot/err 漏口，stale 全部不动**
- **删除 T009 第 4 点（L140 stale 脱敏）与 T008 用例 3（stale 场景）**。仅修：
  1. L104-107 `runAgentContextTool` catch → 固定文案 `'内部错误，请稍后重试'`，drop stack；保留 `internal-error` code + telemetry 内部记录。
  2. L129 缺图分支 → `'graph 未构建'` + hint `'请先运行 \`spectra batch\` 生成图谱'`（去 projectRoot）。
  3. L148 其他加载失败 → 同上固定文案。
- 理由：stale 消息（`graph-format-stale: …（${node.id}）`）含的是**外来图节点绝对路径**，是「你的图 copy 自别处」的**故意诊断信号**，且 agent-context L140 / graph-tools L177 / file-nav L132 **三处当前一致**。只动 L140 会造成半修不一致；用户决定维持原 #5 的 3 处范围、stale 三处保持现状不动。

**[WARNING-3 已采纳] T7 — 从 F186 剥离源码改动，仅留文档/follow-up**
- **作废** T028（orchestrator-cli zod 源码改）、T029（mcp-server.ts volta 源码改）。这两项是独立缺陷、不属于「重发 4.3.0 + 防漂移」最小面，且不能排在 publish 之后。转为后续独立 fix 候选（收尾用 spawn_task 记）。
- T030（plugin 同名冲突纯文档）若 trivial 可留为 best-effort；否则一并转 follow-up。

---

## Phase 1: T6 — Synopsis 定点断言 + 帮助文本校正

> **最小改动、最先验收的护栏加固。先做 T6 确保 synopsis 漏项被显式断言覆盖，再推进其他修复。**

**目标**: 帮助文本 synopsis 行与详细行对齐（补 `graph-only`）；升级弱断言为定点断言，防止未来再次漂移。

**独立验证**: `npx vitest run tests/unit/cli/helptext.test.ts` 全绿；`spectra --help` 实际输出 synopsis 行含 `graph-only`。

### 关键风险点说明

现有 `helptext.test.ts` L35-40 的整文件 `toContain('graph-only')` 断言已经通过（因为详细行 L99 已含 graph-only），但 **无法抓住 synopsis L43 漏项**。正确护栏必须是**先加 synopsis 定点断言确认它红（因 L43 当前漏 graph-only），再修 L43 转绿**。

### TDD 子任务

- [ ] T001 **[红测] 在 `tests/unit/cli/helptext.test.ts` 追加 synopsis 定点断言 it**
  - 文件: `tests/unit/cli/helptext.test.ts`
  - 新增 `it('synopsis 行包含全部 4 个 mode 值（定点断言）', ...)` — 定位含 `spectra batch` 且含 `--mode` 的行，断言含 `full` / `reading` / `code-only` / `graph-only`
  - **此时 `graph-only` 断言必须失败**（红）——确认是真正的新护栏，而非假绿
  - 执行: `npx vitest run tests/unit/cli/helptext.test.ts` → 预期新 it 失败，原 4 个 it 仍绿

- [ ] T002 **[实现] 修复 `src/cli/index.ts` L43 synopsis 行补 `graph-only`**
  - 文件: `src/cli/index.ts`
  - 将 `--mode <full|reading|code-only>` 改为 `--mode <full|reading|code-only|graph-only>`（与详细行 L99 对齐）
  - 执行: `npx vitest run tests/unit/cli/helptext.test.ts` → 全部 5 个 it 绿（含新 synopsis 定点 it）
  - 验证: `node dist/cli/index.js --help 2>&1 | grep 'mode'` 输出含 `graph-only`（需先 `npm run build`）

**Phase 1 Checkpoint**: `npx vitest run tests/unit/cli/helptext.test.ts` 5 个 it 全绿；synopsis 行字面值与详细行对齐。

---

## Phase 2: T5 — Prepare 工具 ESM 死代码修复

> **独立模块，与 T6 可并行。消除裸 `require()` 在 ESM 中必抛被吞的假绿现象。**

**目标**: `prepare` handler 的 `detectedLanguages` 逻辑从死代码变为真实运行；消除运行时 `require is not defined` 错误。

**独立验证**: `npx vitest run tests/unit/mcp/server-prepare-languages.test.ts` 全绿。

### TDD 子任务

- [ ] T003 **[P][红测] 新建 `tests/unit/mcp/server-prepare-languages.test.ts`**
  - 文件: `tests/unit/mcp/server-prepare-languages.test.ts`（新建）
  - 用例 1: mock `prepareContext` + `scanFiles`，给 `prepare` handler 传入目录路径 → 响应含 `detectedLanguages` 字段，不抛 `require is not defined`
  - 用例 2: 传入文件路径（非目录）→ `detectedLanguages` 不出现（跳过目录场景）
  - 执行: `npx vitest run tests/unit/mcp/server-prepare-languages.test.ts` → 目录场景测试失败（当前死代码导致 detectedLanguages 未注入）

- [ ] T004 **[实现] 修复 `src/mcp/server.ts` L105-106 ESM import**
  - 文件: `src/mcp/server.ts`
  - L105: `require('node:path').resolve(targetPath)` → 使用文件顶部已有的 `resolve` import（或补 `import { resolve } from 'node:path'`）
  - L106: `require('node:fs')` → 补顶部 ESM import `import { statSync } from 'node:fs'`（扩展已有 fs import）
  - try/catch 内 `statSync` 调用：增加目录场景明确断言
  - 执行: `npx vitest run tests/unit/mcp/server-prepare-languages.test.ts` → 全绿

**Phase 2 Checkpoint**: `npx vitest run tests/unit/mcp/server-prepare-languages.test.ts` 全绿；`prepare` handler 目录场景 detectedLanguages 正常注入。

---

## Phase 3: T1 — Release-Contract 版本 Bump

> **版本 bump 必须经由 contract + release:sync，禁止手改任何受控行。**

**目标**: `spectra-cli` npm 包版本从 4.2.0 bump 到 4.3.0；受控行（`plugin.json` / `marketplace.json` / `package-lock.json` / README badge）经 `release:sync` 自动同步。

**独立验证**: `npm run release:check` 零错误；`grep '"version"' plugins/spectra/.claude-plugin/plugin.json` 返回 `4.3.0`。

### 子任务

- [ ] T005 **修改 `contracts/release-contract.yaml` — 版本 bump + changelog**
  - 文件: `contracts/release-contract.yaml`
  - `products.spectra.version`: `4.2.0` → `4.3.0`
  - `productMappingDescription` 追加 4.3.0 changelog 行（涵盖 F175-F196 修复摘要 + 防漂移门禁）
  - **禁止** 同时手改 `plugin.json` / `marketplace.json` / `package-lock.json` / README

- [ ] T006 **执行 `npm run release:sync` 令受控行自动同步**
  - 执行: `npm run release:sync`
  - 验证: `git diff --name-only` 显示 `plugin.json` / `marketplace.json` 已变更（版本号为 4.3.0）

- [ ] T007 **执行 `npm run release:check` 确认一致性**
  - 执行: `npm run release:check` → 零错误
  - 执行: `grep '"version"' plugins/spectra/.claude-plugin/plugin.json` → 输出含 `4.3.0`
  - 执行: `git diff contracts/release-contract.yaml` 确认受控行仅通过 release:sync 变更（无手改痕迹）
  - 执行: `npx vitest run` → 确认无已有测试因版本号硬编码 `4.2.0` 而失败（如有，记录并修复断言）

**Phase 3 Checkpoint**: `npm run release:check` 零错误；plugin.json 版本为 4.3.0；全量 vitest 无因版本号导致的失败。

---

## Phase 4: T4 — MCP 脱敏：3+1 处漏口

> **集中改一个文件 `src/mcp/agent-context-tools.ts` 的 4 处漏口，对齐 `file-nav-tools.ts:140` 先例。**

**目标**: `runAgentContextTool` + `loadGraphOrError` 的错误响应不再泄露 `err.message` / stack / `projectRoot` / 绝对路径节点 id 给 MCP 客户端；对齐固定文案先例。

**独立验证**: `npx vitest run tests/unit/mcp/agent-context-sanitize.test.ts` 全绿；14 个已用固定文案的 MCP 工具无改动。

### 关键风险说明

- L140 stale 分支的 `err.message` 由 `isGraphFormatStaleError` 内部构造，可能含绝对路径节点 id，需一并脱敏
- 脱敏后保留 `internal-error` / `graph-not-built` 等 `code` 字段不变（客户端只消费 code）
- telemetry 内部字段可继续记录原始 message，不外漏即可

### TDD 子任务

- [ ] T008 **[P][红测] 新建 `tests/unit/mcp/agent-context-sanitize.test.ts`**
  - 文件: `tests/unit/mcp/agent-context-sanitize.test.ts`（新建）
  - 用例 1: mock `getCachedGraphData` 抛含 `/Users/xxx/...` 绝对路径错误 → `loadGraphOrError` 返回的 error message 不含 `/Users/` / `/home/` 前缀
  - 用例 2: mock `runAgentContextTool` body 抛 Error（message 含路径）→ catch 结果 message 为固定文案 `'内部错误，请稍后重试'`，响应无 `stack` 字段
  - 用例 3: stale 场景 mock `isGraphFormatStaleError` 返回 true，err.message 含绝对路径 → 脱敏后 message 为 `'图格式已过期'`，不含绝对路径
  - 用例 4: 缺图场景 → error message 为 `'graph 未构建'`，含 hint `'请先运行 \`spectra batch\` 生成图谱'`，不含 projectRoot 内插
  - 执行: `npx vitest run tests/unit/mcp/agent-context-sanitize.test.ts` → 全部失败（当前均泄露路径）

- [ ] T009 **[实现] 修复 `src/mcp/agent-context-tools.ts` 4 处漏口**
  - 文件: `src/mcp/agent-context-tools.ts`
  - L104-107 `runAgentContextTool` catch: `err.message` + `stack.slice(0,200)` → 固定文案 `'内部错误，请稍后重试'`，drop stack；保留 `internal-error` code + telemetry 内部记录
  - L129 `loadGraphOrError` 缺图分支: `graph.json 不存在...(projectRoot=${projectRoot})` → `'graph 未构建'` + hint `'请先运行 \`spectra batch\` 生成图谱'`
  - L148 `loadGraphOrError` catch 其他加载失败: 同上固定文案
  - L140 `loadGraphOrError` stale 分支: `err.message` → 固定文案 `'图格式已过期'` + hint（hint 无绝对路径可留）；绝对路径信息仅写 telemetry 内部字段
  - 执行: `npx vitest run tests/unit/mcp/agent-context-sanitize.test.ts` → 全绿

- [ ] T010 **验证其余 14 个 MCP 工具无改动**
  - 执行: `git diff src/mcp/` → 仅 `agent-context-tools.ts` 有变更，其他文件无变化
  - 执行: `npx vitest run tests/unit/mcp/` → 现有 MCP 测试无失败

**Phase 4 Checkpoint**: 4 处脱敏漏口已修；脱敏测试全绿；其余 MCP 工具无改动；现有 MCP 测试无失败。

---

## Phase 5: T3 — CLI `--version` Build 元数据

> **新建 prebuild 脚本 + build-info 文件，令 `spectra --version` 可区分新旧 build。**

**目标**: `spectra --version` 输出 `spectra v4.3.0 (abc1234)` 格式（7 位 commit hash）；build-info.ts 源码不入库、不入 npm 包；dist/build-info.js 入包（baked 值）。

**独立验证**: `npx vitest run tests/unit/cli/version.test.ts` 全绿；`npm run build` 后 `dist/cli/index.js` 含 commit hash；`npm pack --dry-run` 确认 `src/build-info.ts` 不在文件清单。

### 关键风险说明（降级路径）

- build-info.ts 缺失时（如 CI 未跑 prebuild）必须**优雅降级**：`BUILD_COMMIT` 缺失时 `--version` 退回输出 `spectra v4.3.0`（不含括号后缀），不抛错
- `src/build-info.ts` gitignore，避免每次 commit 触发噪声 diff

### TDD 子任务

- [ ] T011 **[P][红测] 新建 `tests/unit/cli/version.test.ts`**
  - 文件: `tests/unit/cli/version.test.ts`（新建）
  - 用例 1: mock `BUILD_COMMIT = 'abc1234'` → 验证 version 逻辑路径输出含 `v4.3.0 (abc1234)` 格式
  - 用例 2: mock `BUILD_COMMIT = 'unknown'` 或空字符串 → 输出 `v4.3.0`（无括号后缀，优雅降级）
  - 用例 3: 检查现有 CLI 测试中无硬编码 `v4.2.0` 或特定 version 输出格式的脆弱断言（grep 验证）
  - 执行: `npx vitest run tests/unit/cli/version.test.ts` → 版本格式相关用例视当前实现可能通过或失败

- [ ] T012 **[P][实现] 新建 `scripts/gen-build-info.mjs`**
  - 文件: `scripts/gen-build-info.mjs`（新建）
  - 执行 `git rev-parse --short HEAD` 获取 7 位 commit hash；失败时 fallback 到 `'unknown'`
  - 生成 `src/build-info.ts`，内容：
    ```typescript
    // 此文件由 scripts/gen-build-info.mjs 在 build 时生成，不入库
    export const BUILD_COMMIT = '<hash>';
    ```
  - 验证: `node scripts/gen-build-info.mjs` 执行后 `src/build-info.ts` 存在且含当前 commit hash

- [ ] T013 **[实现] 修改 `src/cli/index.ts` 引入 build 元数据**
  - 文件: `src/cli/index.ts`
  - 顶部引入 `BUILD_COMMIT`（使用 try/catch 动态 import 或条件 import，缺文件时 `BUILD_COMMIT = ''`）
  - `--version` 输出路径：`BUILD_COMMIT && BUILD_COMMIT !== 'unknown'` 时输出 `spectra v${version} (${BUILD_COMMIT})`，否则输出 `spectra v${version}`
  - 依赖: T012（需 build-info.ts 存在才能验证 import 路径正确）

- [ ] T014 **[实现] 修改 `package.json` prebuild + `.gitignore`**
  - 文件: `package.json`（修改 `prebuild` 字段，在现有命令前追加 `node scripts/gen-build-info.mjs &&`）
  - 文件: `.gitignore`（追加 `src/build-info.ts`）
  - 验证: `npm run build` → 先执行 gen-build-info，后执行 tsc；`git status` 显示 `src/build-info.ts` 为 ignored

- [ ] T015 **验证 build 产物和 npm pack 文件清单**
  - 执行: `npm run build` → 零错误
  - 执行: `grep -r 'BUILD_COMMIT\|build-info' dist/cli/index.js` → 确认 baked commit hash 已嵌入 dist
  - 执行: `npm pack --dry-run 2>&1 | grep build-info` → 确认 `src/build-info.ts` 不在清单，`dist/build-info.js` 在清单
  - 执行: `npx vitest run tests/unit/cli/version.test.ts` → 全绿

**Phase 5 Checkpoint**: version 测试全绿；`npm run build` 含 prebuild gen-build-info；`src/build-info.ts` 在 gitignore；dist 含 baked hash；pack 清单正确。

---

## Phase 6: T2 — Wrapper Body SHA256 指纹校验

> **改动面最广、涉及 shell + JS 两端一致性，放最后集中验证。先做红测确认漂移场景可被检测。**

**目标**: wrapper header 写入 source body sha256；`validateWrapperMarkers` 重算比对，不一致时报 fail；旧格式 wrapper 触发 warn 不 fail（兼容渐进迁移）。

**独立验证**: `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` 全绿（3 场景：pass / fail / warn）；`npm run spec-driver:check:wrappers` 干净安装后通过。

### 关键风险说明（一致性陷阱）

**JS 校验端（validate-wrapper-sources.mjs）重算 body sha256 时，必须与生成端（codex-skills.sh 的 frontmatter 剥除 + runtime text rewrite sed 管道）产出逐字节一致的 body 文本，否则所有 wrapper 都会 sha 不匹配（假阳性 fail）。**

验证方式：对同一 SKILL.md source 分别跑两端各算一次 sha256，比对输出相等。

### TDD 子任务

- [ ] T016 **[P][红测] 新建 `tests/unit/spec-driver/wrapper-sha256.test.ts`**
  - 文件: `tests/unit/spec-driver/wrapper-sha256.test.ts`（新建）
  - 用例 1（漂移场景）: 安装 wrapper 后手动改 source SKILL.md 一行 → `validateWrapperSources()` 返回 `status: fail`，错误信息含 sha 不匹配提示
  - 用例 2（正常场景）: 安装后立即校验 → `status: pass`
  - 用例 3（旧格式兼容）: 无 `Source SHA256:` 行的 wrapper → `status: warn`（不 fail）
  - 执行: `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` → 用例 1 失败（当前只校验 header，漂移抓不到）；用例 2/3 视现有行为可能通过或失败

- [ ] T017 **[实现] 修改 `plugins/spec-driver/scripts/codex-skills.sh` 生成端写入 sha**
  - 文件: `plugins/spec-driver/scripts/codex-skills.sh`
  - `write_wrapper_source_contract` 函数中，计算 canonical SKILL.md body 的 sha256（frontmatter 剥除 + runtime text rewrite sed 管道产出的文本）
  - 使用 `shasum -a 256`（macOS 兼容）或 `sha256sum`（Linux 兼容，加 fallback 判断）
  - 在 wrapper header `Canonical source` 行下方追加：`- Source SHA256: <hash>`

- [ ] T018 **[实现] 修改 `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` 校验端重算比对**
  - 文件: `plugins/spec-driver/scripts/validate-wrapper-sources.mjs`
  - `validateWrapperMarkers` 函数新增逻辑：
    - 从 wrapper 文件解析 `Source SHA256: <hash>` 提取嵌入 hash
    - 读取对应 source SKILL.md，重走相同 body 提取逻辑（剥 frontmatter + runtime text rewrite，纯 JS 实现）计算 sha256
    - 比对不一致 → 追加 fail 条目 `wrapper body sha256 不匹配（期望 X，实际 Y）`
    - 无 `Source SHA256:` 行 → warn 不 fail（旧格式兼容）

- [ ] T019 **[关键验证] JS body 提取与 shell 管道一致性验证**
  - 对同一 SKILL.md source 文件：
    - Shell 端: `bash plugins/spec-driver/scripts/codex-skills.sh` 执行后从 wrapper header 读取 sha 值
    - JS 端: 调用 `validate-wrapper-sources.mjs` 内部 body 提取函数计算 sha 值
  - **两端 sha256 必须完全相同**；不同则说明 body 提取逻辑不一致，必须先对齐再进行下一步
  - 执行: `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` → 全 3 用例绿

- [ ] T020 **（可选）更新 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 补注释**
  - 文件: `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`
  - 在 `generator` 下补注释，说明 sha256 校验机制（无需增加强制字段，sha 嵌在 wrapper header）
  - 执行: `npm run spec-driver:check:wrappers` → 干净安装后通过

**Phase 6 Checkpoint**: wrapper-sha256 测试 3 用例全绿；JS/shell 两端 body 提取一致；`spec-driver:check:wrappers` 通过。

---

## Phase 7: 全量门禁验证

> **所有 T1-T6 实现完毕后必须全量通过，零容忍失败。**

- [ ] T021 **全量单元测试**
  - 执行: `npx vitest run`
  - 期望: 零失败（含所有新增 tests: wrapper-sha256、version、agent-context-sanitize、server-prepare-languages、helptext synopsis 定点）

- [ ] T022 **TypeScript 编译**
  - 执行: `npm run build`
  - 期望: 零 TypeScript 错误；dist/ 含 gen-build-info 产出的 baked commit hash

- [ ] T023 **仓库一致性检查**
  - 执行: `npm run repo:check`
  - 期望: wrapper 同步 + skill mirror 一致性全通

- [ ] T024 **Release contract 一致性检查**
  - 执行: `npm run release:check`
  - 期望: 零错误；版本号一致性确认

**全量门禁 Checkpoint**: 以上 4 项全部零失败，方可进入 Publish 准备阶段。

---

## Phase 8: Publish 准备（末步，列清单等用户授权）

> **此阶段不自动执行 `npm publish`。必须先列清单、等用户明确授权后再执行。**

- [ ] T025 **dry-run 确认包文件清单**
  - 执行: `npm run release:publish:dry`（或 `npm pack --dry-run`）
  - 验证: `src/build-info.ts` **不在**文件清单；`dist/build-info.js` **在**文件清单
  - 验证: `dist/cli/index.js` 含 baked commit hash 文本

- [ ] T026 **确认 npm registry 当前版本**
  - 执行: `npm view spectra-cli version`
  - 预期当前为 `4.2.0`（未被污染），确认 bump 到 4.3.0 是 next version

- [ ] T027 **向用户列出 Publish 准备清单并等待授权**
  - 列出以下 checklist 状态（所有项必须为 ✅）：
    - [ ] T1 合并：`contracts/release-contract.yaml` 已 bump 4.3.0，`release:check` 通过
    - [ ] T2 合并：wrapper sha 校验生效，`spec-driver:check:wrappers` pass
    - [ ] T3 合并：prebuild gen-build-info 执行，`dist/cli/index.js` 含 baked commit hash
    - [ ] T4 合并：agent-context-tools 脱敏测试全绿
    - [ ] T5 合并：prepare ESM 修复，prepare-languages 测试全绿
    - [ ] T6 合并：synopsis 定点断言通过
    - [ ] 全量门禁：vitest + build + repo:check + release:check 四项零失败
    - [ ] dry-run：pack 文件清单正确（无 src/build-info.ts，有 dist/build-info.js）
  - **等用户回复"确认 publish" / "publish" / "OK" 等明确授权后，执行 `npm publish`**
  - **不可逆操作，一次授权只对本次生效**

---

## Phase 9: T7 — 附带串（Best-Effort，不阻塞主验收）

> **仅在 T1-T6 全绿且 Publish 完成（或用户决定先不 publish）后，按剩余时间处理。不得因 T7 阻塞主验收或 publish 授权。**

- [ ] T028 **[best-effort][P] zod 缺依赖优雅降级**
  - 文件: `plugins/spec-driver/scripts/orchestrator-cli.mjs` 等相关脚本
  - zod import 失败时给出清晰错误提示，不 crash；建议 try/catch + 友好错误文案
  - 验证: 手动移除 zod 后执行 orchestrator-cli → 输出可读错误而非 unhandled rejection

- [ ] T029 **[best-effort][P] MCP server volta 鲁棒性**
  - 文件: `src/cli/commands/mcp-server.ts`（或 launch script）
  - 加 volta bypass 或 PATH 修补，防止 volta 版本管理工具引起 MCP server status:failed
  - 参考: `project_spectra_cli_volta_blocker.md` 记录的已知问题
  - 验证: volta 环境下 `spectra mcp-server` 启动不报错

- [ ] T030 **[best-effort][P] plugin 同名冲突行为文档化**
  - 文件: `plugins/spec-driver/README.md`（或 CLAUDE.md 相关节）
  - 补充同名冲突行为说明（当两个 plugin 注册相同 name 时的 resolution 规则）
  - 不改 `src/` 源码，纯文档

---

## 依赖关系与并行说明

### Phase 依赖链

```
Phase 1（T6 synopsis）    ─┐
Phase 2（T5 ESM）         ─┤ 可并行 → Phase 7 全量门禁
Phase 3（T1 版本 bump）   ─┤
Phase 4（T4 脱敏）        ─┤  建议 T1 后再做（版本稳定）
Phase 5（T3 build-info）  ─┤  建议 T3 后再做 T2
Phase 6（T2 wrapper sha） ─┘
          ↓
Phase 7（全量门禁）
          ↓
Phase 8（Publish 准备 + 等授权）
          ↓
Phase 9（T7 best-effort，有余量再做）
```

### 可并行的任务组

| 并行组 | 任务 | 可并行原因 |
|--------|------|-----------|
| 组 A | T001/T002（T6）、T003/T004（T5）、T005-T007（T1） | 操作不同文件，无内容依赖 |
| 组 B | T008/T009（T4 红测+实现）、T011/T012（T3 红测+脚本） | 操作不同文件，无内容依赖 |
| 组 C | T028、T029、T030（T7 各子项） | 完全独立的 best-effort 子项 |

### 强依赖关系

- T013（index.ts import build-info）→ T012（gen-build-info 脚本存在并能生成 build-info.ts）
- T019（JS/shell 一致性验证）→ T017（shell 生成端）+ T018（JS 校验端）均已实现
- Phase 7（全量门禁）→ Phase 1-6 所有任务全绿
- Phase 8（Publish）→ Phase 7 全量门禁通过

### TDD 执行顺序原则（每个 phase 内）

```
写红测（确认失败） → 实现（修改源码） → 转绿（跑测试确认通过） → 提交
```

---

## 新增测试文件汇总

| 文件 | 对应修复 | 关键断言点 |
|------|----------|-----------|
| `tests/unit/cli/helptext.test.ts`（追加 it） | T6 synopsis 定点 | synopsis 行含 full / reading / code-only / graph-only 四个 mode 值 |
| `tests/unit/mcp/server-prepare-languages.test.ts`（新建） | T5 ESM 死代码 | detectedLanguages 目录场景正常注入；无 require is not defined |
| `tests/unit/cli/version.test.ts`（新建） | T3 build 元数据 | 有 hash → 含括号后缀；无 hash → 优雅降级输出仅版本号 |
| `tests/unit/mcp/agent-context-sanitize.test.ts`（新建） | T4 脱敏 | 4 处漏口均无 /Users/ / /home/ / stack 字段；code 字段保留不变 |
| `tests/unit/spec-driver/wrapper-sha256.test.ts`（新建） | T2 wrapper sha | 漂移 → fail；正常 → pass；旧格式 → warn |

---

## 提交说明约定

每个 Phase 完成后按如下格式提交：

```bash
# 示例：T6 提交
git add tests/unit/cli/helptext.test.ts src/cli/index.ts
git commit -m "fix(186): T6 synopsis 定点断言 + 补 graph-only（红→绿）"

# 示例：T1 提交
git add contracts/release-contract.yaml plugins/spectra/.claude-plugin/plugin.json marketplace.json package-lock.json
git commit -m "fix(186): T1 release-contract bump 4.2.0→4.3.0 + release:sync"

# 注意：禁 git add -A，specs/src.spec.md 排除出 commit
```
