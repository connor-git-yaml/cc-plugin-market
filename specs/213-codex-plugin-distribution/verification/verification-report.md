# Feature 213（A1）— Codex Plugin 一体分发 验证报告

**分支**: `claude/codex-plugin-distribution-2940d3`
**环境**: macOS Darwin 25.5.0，`codex-cli 0.144.6`（PATH 内 `/opt/homebrew/bin/codex`）
**范围**: Wave 3（T013-T022）验证证据留存

---

## T021 — 本机真实 Codex CLI 全链路手动验证（FR-010(b)，风险3 闭环，SC-001/SC-002）

**目的**：结构性测试无法暴露"manifest 路径解析假设本身错误"这类风险（plan §6 风险3）。本节在本机用真实 codex binary 跑通 `marketplace add → plugin add → list → mcp list → 完整清理`，作为该假设的真实验证。

**方法**：mkdtemp fixture 副本（copy `plugins/spectra` + `plugins/spec-driver` + `.agents/plugins/marketplace.json`，marketplace `name` 改写为测试专属随机名），杜绝对真实 worktree 注册全局状态。

### 真实命令与输出

```text
### codex --version
codex-cli 0.144.6

### codex plugin marketplace add <FIXTURE>
Added marketplace `cc-plugin-market-e2e-178454081815814` from /private/var/folders/.../tmp.RELqXdNa9y.
Installed marketplace root: /private/var/folders/.../tmp.RELqXdNa9y

### codex plugin add spectra@cc-plugin-market-e2e-178454081815814
Added plugin `spectra` from marketplace `cc-plugin-market-e2e-178454081815814`.
Installed plugin root: /Users/connorlu/.codex/plugins/cache/cc-plugin-market-e2e-.../spectra/4.3.0

### codex plugin add spec-driver@cc-plugin-market-e2e-178454081815814
Added plugin `spec-driver` from marketplace `cc-plugin-market-e2e-178454081815814`.
Installed plugin root: /Users/connorlu/.codex/plugins/cache/cc-plugin-market-e2e-.../spec-driver/4.3.0

### codex plugin list --json （本市场条目）
[
  { "name": "spectra",     "marketplaceName": "cc-plugin-market-e2e-...", "version": "4.3.0", "installed": true, "enabled": true },
  { "name": "spec-driver", "marketplaceName": "cc-plugin-market-e2e-...", "version": "4.3.0", "installed": true, "enabled": true }
]

### codex mcp list --json （spectra server 条目）
{
  "name": "spectra",
  "enabled": true,
  "transport": { "type": "stdio", "command": "spectra", "args": ["mcp-server"], ... },
  "auth_status": "unsupported"
}

### 清理链
Removed plugin `spectra` from marketplace `cc-plugin-market-e2e-...`.
Removed plugin `spec-driver` from marketplace `cc-plugin-market-e2e-...`.
Removed marketplace `cc-plugin-market-e2e-...`.

### 清理后校验
markets with e2e: 0
mcp count: 8 has spectra: false   （回落至 8 个基线 MCP server，spectra 已注销）
```

### 结论

- **SC-001（Codex 用户一次安装获得 Spectra 全部能力）达成**：`plugin add spectra@<market>` 成功安装，`plugin list --json` 显示 `installed: true`，`mcp list --json` 出现 `spectra` stdio server（`command: spectra, args: [mcp-server]`）——即 manifest 的 `mcpServers: "./.mcp.json"` 引用被 Codex 正确解析并注册 MCP。
- **SC-002（Codex 用户一次安装获得 Spec Driver 全部 8 个 Codex 适配 skills）达成——三方联合证据链**（不采信"安装成功即达成"的直跳推断，需实证安装后 Codex 侧可见 skill 的数量与身份与合同一致）：
  1. **安装态**：`plugin add spec-driver@<market>` 成功，`plugin list --json` 显示 `installed: true`，manifest 的 `skills: "./skills-codex/"` 被接受（无路径错误）。
  2. **cache 实测枚举**（关键补证）：安装后枚举 `~/.codex/plugins/cache/<market>/spec-driver/4.3.0/skills-codex/` —— **8 个目录，每个含 `SKILL.md`**，身份集合 `{spec-driver-constitution, spec-driver-doc, spec-driver-feature, spec-driver-fix, spec-driver-implement, spec-driver-resume, spec-driver-story, spec-driver-sync}`，与 `wrapper-source-of-truth.yaml` 的 8 条 `codexWrappers.entries` **逐一 `diff` 结果 IDENTICAL**（数量 + 身份双维一致）。
  3. **矩阵 check 佐证**：`codex-plugin-consistency:skills-reference:spec-driver`（引用目录存在 + skill id 集合 == wrapper entries）与 `skill-count:spec-driver-codex-dir`（数量 == entries.length=8）在 repo:check/release:check 双链均 pass。
  4. **字节完整性佐证（Wave 1）**：`skills-codex/` 由 `codex-skills.sh --sync-plugin-distribution` copy-after-generate 产出，与 `.codex/skills` 逐字节相同（含内嵌 `Source SHA256` 行），repo-maintenance-sync-check.test.ts 已守护"repo:sync 重建 8 项且与 .codex/skills byte-equal"。
  说明：canonical 有 9 个 skill（含 `spec-driver-refactor`），Codex 侧 8 个是**设计内**缺口（A2 待补），经 waiver 显式豁免——SC-002 的"全部 Codex 适配 skills"指的是当前 8 个已适配项，与合同 entries 完全对齐，非 canonical 全集。
- **plan §6 风险3 闭环**：manifest `skills`/`mcpServers` 字段的"相对插件根解析"假设经真实 `codex 0.144.6` 验证成立，非仅结构性自洽。
- **plan §6 风险4 闭环**：全局 `~/.codex` 注册在测试后完整回收（marketplace + 2 plugin + spectra MCP 全部注销，MCP 计数回落 8 基线），无残留。

> T020 自动化 E2E（`tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`）以 `describe.skipIf(!hasCodex)` + `spawnSync` 清理链 + 末尾汇总断言复现同一链路，本机实跑 1 passed（6.4s）。

---

## T022 — 全量回归验证（收尾）

### 命令与退出码

| # | 命令 | 退出码 | 结论 |
|---|------|--------|------|
| 1 | `npm run build` | 0 | 类型检查零错误，postbuild 盖章成功 |
| 2 | `npm run repo:check` | 0 | status=pass，含 `codex-plugin-consistency:*` 全 12 check pass |
| 3 | `npm run release:check` | 0 | Release contract valid，`--json` 输出含 `codex-plugin-consistency:*` 12 条全 pass |
| 4 | `npx vitest run`（全量） | 1 | 8 failed / 5124 passed（见下方基线比对与失败归因） |

### Wave 3 新增/修改测试（全绿证据）

6 个 Wave 3 相关测试文件合并跑：**42 passed（6 files）**，含真实 codex E2E（`feature-213-codex-plugin-install.e2e.test.ts` 1 passed，真跑 codex 0.144.6）。

- `tests/unit/codex-plugin-consistency-core.test.ts`：16 passed（happy + manifest 缺失/非法 JSON/hooks key + mcp 缺 server + skill-count + skills-reference 负例族〔错误值/缺目录/身份不符〕+ waiver 精确删除〔error 指名 spec-driver-refactor〕/覆盖 + marketplace 缺条目/path 不匹配 + neutrality warn + 块级序列守护）
- `tests/integration/codex-plugin-manifest.test.ts`：14 passed（两 manifest 结构 + 受控字段闭环 + FR-006 hooks ship）
- `tests/integration/codex-plugin-marketplace.test.ts`：4 passed（schema + 路径存在性 + fresh-clone 物化）
- `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`：1 passed
- `tests/integration/repo-maintenance-sync-check.test.ts`：1 passed（含 `codex-plugin-consistency:*` 聚合断言）
- `tests/integration/release-contract-sync.test.ts`：6 passed（含 codex manifest 同步/漂移 + release:check 薄壳合并矩阵断言）

### 基线比对（T000 `baseline-pre-implement.txt`，commit 2466905）

| 指标 | T000 基线 | T022 本次 |
|------|-----------|-----------|
| Test Files | 428 passed \| 4 skipped（432） | 4 failed \| 428 passed \| 4 skipped（436） |
| Tests | 5079 passed \| 24 skipped \| 21 todo | 8 failed \| 5124 passed \| 18 skipped \| 21 todo |

文件总数 +4 = Wave 3 新增 4 个测试文件（consistency-core / manifest / marketplace / e2e），均在"passed"侧。

### 8 个失败归因 —— 均为共享 home 目录 baseline 图污染，非 Feature 213 回归

**失败文件（4）**：`tests/e2e/feature-180-graph-tools.e2e.test.ts`、`feature-180-file-nav-stdio.e2e.test.ts`、`feature-180-symbol-chain.e2e.test.ts`、`tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts`。

**根因链（已实证）**：

1. 这 4 个文件在 **T000 基线全部 pass**（`grep` baseline 日志：`✓ feature-180-graph-tools (9 tests) 1066ms` 等四行）。
2. 它们经 `installRelativizedBaseline()` 读取共享 home 图 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`，断言符号级节点 `micrograd/nn.py#MLP`（`#` 分隔符）。
3. 该 home 图在本次会话 **17:34 被改写**（同目录 `GRAPH_REPORT.md`/`docs-bundle.yaml`/`graph.html`/`batch-summary-*.md` mtime 均 17:34），当前内容退化为 **spec-doc 级节点**（`../.../modules/nn.spec.md`、`micrograd/__init__.py`），已无 `#MLP` 符号节点 → 图查询返回 `undefined` → 断言 `expected undefined to be 'micrograd/nn.py#MLP'` 失败。
4. 改写者是套件内某个跑 full `spectra batch` 的测试（写入同一 home 输出目录），属 **跨测试共享 home 目录可变状态**（`~/.spectra-baselines/` 跨 worktree 共享，CLAUDE.local.md 与 MEMORY 均记录此类 hazard），**顺序/时序依赖**、非确定性——T000 那次运行未被 clobber，故 pass。
5. 叠加 **`#`/`::` 符号 ID 格式漂移**（M9 轨道 B 明列"统一 `#`/`::` symbol ID"为待办）：当前代码 `batch --mode graph-only` 产出 `::` 分隔符（实测 `micrograd/nn.py::MLP`），与测试硬编码的 `#` 不兼容，且无 `::`↔`#` 归一化，故即便重建符号图也无法匹配旧 `#` 基线——这是 M9 待办范围，不在 Feature 213（A1）内。

**与 Feature 213 改动的正交性证明**：本 wave 全部改动文件 = `contracts/codex-plugin-consistency.yaml`、`scripts/lib/codex-plugin-consistency-core.mjs`、`scripts/lib/repo-maintenance-core.mjs`（import + 1 处 aggregateValidation 注册）、`scripts/validate-release-contracts.mjs`（薄壳合并）、及 codex 相关测试文件。**零触碰** Spectra graph/CLI/MCP server/micrograd fixture。失败的 4 个文件仅依赖 Spectra 图运行时与 home baseline，不 import 任何被本 wave 修改的模块。

**结论**：8 个失败为 **pre-existing 共享 home baseline 污染 + M9 待办的符号 ID 格式漂移**，非 Feature 213 引入的回归。恢复需 `npm run baseline:collect -- --target karpathy/micrograd`（重建 home 符号图 fixture，需 LLM/auth）或 M9 track B 落地 `#`/`::` 统一，两者均超出本 A1 wave 范围，作为后续项。

### 收尾状态

- 受控产物噪声已还原（`git checkout -- specs/src.spec.md`）；worktree 无其他脏 tracked 文件（`specs/_meta/graph.json` 为 gitignored，不入库）。
- FR-011（Claude 侧零变化）：涉及 `.claude-plugin/**`、canonical `skills/**`、`.mcp.json`、`hooks/hooks.json` 的既有用例通过结果与 T000 一致（无新增失败，8 个失败与这些路径无关）。
- SC-004/SC-005：build + repo:check + release:check 三命令零失败；vitest 唯一失败簇经上文归因为环境态，非代码回归。

---

## 最终独立验证（verify 子代理）

**验证时间**: 2026-07-20；**HEAD**: `cbc08fa`（8 个 feature commit，基线锚点 `2466905`）
**独立性声明**：以下全部命令由本子代理独立实跑并采集真实退出码，未采信任何 implement/上文报告的达标声明；上文历史章节（T021/T022）仅作交叉印证，不作为结论依据。

### 逐命令表

| # | 命令 | 退出码 | 结论 |
|---|------|--------|------|
| 1 | `npm run build` | **0** | `tsc` 类型检查零错误；postbuild 盖章 `commit=cbc08fa6` |
| 2 | `npm run repo:check` | **0** | `status=pass`；`codex-plugin-consistency:*` 恰 **12 条**全 pass（manifest-exists×2、no-hooks-field×2、mcp-servers-reference×1、skill-count×2、skills-reference×2、spectra-skill-neutrality×1、canonical-vs-codex-gap×1、marketplace-entries×1） |
| 3 | `npm run release:check` | **0** | 终端输出 "Release contract valid"；实测源码确认 `scripts/validate-release-contracts.mjs` 直接 `import { validateCodexPluginConsistency }`（`scripts/lib/codex-plugin-consistency-core.mjs`），与 repo:check 复用同一矩阵（同 12 check）；`release-contract-core.mjs` 中确认 `codex-plugin-version:*` / `codex-plugin-description:*` 各 2 条（spectra + spec-driver）= 4 条 expectEqual，均在 repo:check 输出中验证为 pass（release:check 复用同一底层校验函数） |
| 4 | Feature 213 相关 9 个测试文件合跑 | **0** | `Test Files 9 passed (9)` / `Tests 79 passed (79)`，含真实 codex E2E `feature-213-codex-plugin-install.e2e.test.ts`（1 passed，13.6s，真跑 codex CLI 全链路） |
| 5 | `npx vitest run`（全量） | **1** | `Test Files 4 failed \| 428 passed \| 4 skipped (436)`；`Tests 8 failed \| 5130 passed \| 18 skipped \| 21 todo (5177)` |
| 6 | SC-003 漂移拦截抽测 | 见下 | 通过 |
| 7 | 全局态复查 | 见下 | 通过 |

### 命令 5 详情 —— 全量测试 8 个失败的独立复核

**失败文件（4，与上文 T022 章节一致）**：
`tests/e2e/feature-180-file-nav-stdio.e2e.test.ts`、`tests/e2e/feature-180-graph-tools.e2e.test.ts`、`tests/e2e/feature-180-symbol-chain.e2e.test.ts`（5 个用例失败）、`tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts`。

**独立复核方法与结论**：

1. **孤立重跑二次，结果确定性一致**（非本次运行的偶发 flaky）：单独跑这 4 个文件两次，均为 `4 failed | 17 passed (25)`，退出码均为 1。
2. **F213 diff 零触碰验证**：`git diff --stat 2466905 cbc08fa -- src/` 输出为空 —— **F213 全部 8 个 commit 未修改 `src/` 任何文件**；`git diff 2466905 cbc08fa -- tests/e2e/helpers/stdio-client.ts` 与 `-- src/knowledge-graph/relativize.ts` 均为空 diff；`git diff --stat ... -- tests/baseline/` 与失败测试文件本身均无 diff。F213 的全部改动面仅限 `contracts/`、`scripts/`（lib + 顶层）、`.codex-plugin/`、`skills-codex/`、`specs/213-*/`、若干测试文件（均与失败的 4 个文件无 import 关系）。
3. **根因独立定位到仓外共享状态**：失败测试经 `installRelativizedBaseline()` 读取 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`（**该路径在仓库 git 树之外，`homedir()` 拼接，跨 worktree 共享，不受 F213 commit 管辖**）。实测该文件 `nodes[].id` 当前为 `micrograd/nn.py::MLP`（`::` 分隔符），而失败用例硬编码期望 `micrograd/nn.py#MLP`（`#` 分隔符）；`git diff` 确认 `src/knowledge-graph/relativize.ts`（负责该转换的源码）未被 F213 触碰。该 home 目录文件 mtime 为运行时刻附近（本会话执行 baseline 相关命令与套件内跑 `spectra batch` 的测试均会写入该共享路径），与 `specs/213-.../baseline-pre-implement.txt`（T000，捕获于 08:40，彼时该 4 个文件全部 `✓` pass）比对，证明这是**捕获基线之后、仓外共享状态被覆写**导致的漂移，而非 F213 代码引入。
4. **结论与上文 T022 章节（implement 侧自行归因）交叉印证一致**：均指向"共享 home baseline 图污染 + M9 待办的 `#`/`::` symbol ID 格式统一（M9 轨道 B 明列待办）"，与 Feature 213（A1）改动面正交。

**SC-004 终判（如实标注 PARTIAL，非静默判过）**：SC-004 字面要求"全量测试套件…均零失败通过"。当前全量 `npx vitest run` 退出码为 1、8 个失败，**字面上未满足**。但独立证据链（上第 2/3 点）证明该失败与 F213 变更集正交、根因在仓外共享环境状态，不属于本 feature 引入的回归。**裁决指针**：是否将 SC-004 判定为"满足（环境态豁免）"或"要求先修复外部 baseline 漂移才能收口"超出本子代理裁量权限，需编排器/用户在 GATE_VERIFY 环节裁决；本报告如实记录字面未达标 + 根因证据，不代为下最终结论。

### 命令 6 详情 —— SC-003 漂移拦截实证

**方法**：`mv plugins/spec-driver/skills-codex/spec-driver-doc /tmp/...` → 跑 `npm run repo:check` → 记录退出码与报错 → `mv` 移回 → 重跑确认恢复 pass。

| 步骤 | 命令 | 退出码 | 结果 |
|------|------|--------|------|
| 漂移后 | `npm run repo:check` | **1** | `status=fail`；报错精确指向缺失字段：`[spec-driver-wrappers] 缺少 Codex 包装技能，请先运行 npm run repo:sync：plugins/spec-driver/skills-codex/spec-driver-doc/SKILL.md` 及 `[codex-plugin-consistency] spec-driver manifest.skills 引用目录 skill id 集合与期望不符：期望 [...spec-driver-doc...]，实际 [...]`（少 `spec-driver-doc`） |
| 恢复后 | `npm run repo:check` | **0** | `status=pass` |

**SC-003 终判**：**通过**。人为制造漂移后 `repo:check` 100% 检出并精确指出差异字段（skill id 集合缺项 + 缺失 wrapper 路径），符合 SC-003 "至少一项在 100% 测试运行中检出并报错，指出具体差异字段"的要求。

**收尾清理**：恢复后发现 `specs/src.spec.md` 因 `repo:check` 副作用产生 3 行自动再生 diff（受控产物，按项目惯例不入库噪声），已执行 `git checkout -- specs/src.spec.md` 还原；`git status --porcelain` 确认工作区干净。本次验证过程未修改除该次自动还原外的任何文件。

### 命令 7 详情 —— 全局态复查

| 检查 | 命令 | 结果 |
|------|------|------|
| marketplace 无 e2e 残留 | `codex plugin marketplace list` | 仅 3 条：`openai-primary-runtime`、`openai-bundled`、`openai-curated`，**无** `cc-plugin-market-e2e-*` 条目 |
| 插件缓存无 e2e 残留 | `ls ~/.codex/plugins/cache/` | 仅 4 条：`openai-bundled`、`openai-curated`、`openai-curated-remote`、`openai-primary-runtime`，**无** `cc-plugin-market-e2e-*` 目录 |

结论：T021 手动验证与 T022/e2e 自动化测试的清理链路均彻底回收全局 Codex 状态，无残留污染。

### SC-001 ~ SC-006 终判

| SC | 判定 | 依据 |
|----|------|------|
| SC-001 | ✅ 通过 | T021 真实 codex CLI 全链路（marketplace add → plugin add → mcp list）已验证 Spectra MCP 被发现注册；本次全局态复查确认无残留（交叉印证环境干净、非污染态下的假通过） |
| SC-002 | ✅ 通过 | `codex-plugin-consistency:skill-count`/`skills-reference` 系列 4 check 全 pass；waiver（`spec-driver-refactor`）在 `contracts/codex-plugin-consistency.yaml` 中显式登记，非未追踪错误 |
| SC-003 | ✅ 通过 | 本次独立漂移拦截抽测实证：100% 检出 + 精确报错字段指向 |
| SC-004 | ⚠️ **PARTIAL** | build/repo:check/release:check 三项零失败；全量 vitest 8 个失败（字面未达"均零失败"），但独立证据链证明与 F213 变更集正交、根因在仓外共享 baseline 状态（`#`/`::` symbol ID 格式漂移，M9 轨道 B 待办范围）。裁决指针见上 |
| SC-005 | ✅ 通过 | 涉及 `.claude-plugin/**`、canonical `skills/**`、`.mcp.json`、`hooks/hooks.json` 路径的既有用例结果与基线一致（8 个失败均在 Spectra graph/e2e 路径，与 Claude 侧受控路径无关，无新增失败也无"意外变绿"） |
| SC-006 | ✅ 通过（交叉印证） | `codex-plugin-marketplace.test.ts` fresh-clone 物化用例本次独立合跑中 pass（4 tests 含该用例） |

### 总结论

**READY-FOR-GATE（附带一项需编排器/用户裁决的 PARTIAL 项）**

**理由**：
1. 四门禁命令中三项（build/repo:check/release:check）**零失败**，独立实跑确认；`codex-plugin-consistency` 12-check 矩阵与 4 条 codex-plugin-version/description expectEqual 均在报告中如实核验为 pass。
2. Feature 213 全部 9 个直接相关测试文件（79 用例，含真实 codex E2E）**独立合跑 100% 通过**。
3. SC-003（漂移拦截，本 feature 核心交付价值）经本子代理**独立实证**通过，非引用式声明。
4. 全量 vitest 的 8 个失败经独立根因分析（diff 零触碰 `src/`、失败测试仅依赖仓外共享 home 目录、baseline 捕获后该外部状态被覆写导致符号 ID 格式不匹配）确证与 F213 改动**正交**，不构成本 feature 引入的回归；但该结论不能自动等价于 SC-004"均零失败"的字面达标——如实标记 PARTIAL，留待 GATE_VERIFY 由编排器/用户按项目惯例（环境态 vs 代码回归的区分标准）最终裁决，而非由本子代理单方面下"忽略此失败"的结论。
5. 全局 Codex 状态复查确认无 E2E 残留污染，交付环境干净。

