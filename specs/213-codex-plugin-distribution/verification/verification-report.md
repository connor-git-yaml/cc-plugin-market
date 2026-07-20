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
