# Feature 200 — 验证报告

> Mode: spec-driver-story（纯文档）。无生产代码改动，验证聚焦 sync 一致性 + 文案与实际行为对齐 + 受控区不触碰。

## 验收对照

| AC | 状态 | 证据 |
|----|------|------|
| AC-1 mainline-focus 真实主线 + sync 一致 + repo:check 绿 | ✅ | `agent-mainline-focus.md` 重写；`docs:sync:agents` 注入 CLAUDE.md/AGENTS.md（diff 仅 mainline-focus 块）；`repo:check` rc=0（`preference-rules:agent-block-sync` pass） |
| AC-2 CLI reference 含 graph-only/scaffold-kb/--version + 实跑一致 | ✅ | 实跑：`spectra v4.3.0`、`batch --help` 含 `graph-only`、`scaffold-kb --help` 含 build/ingest/serve/query |
| AC-3 modes/configuration 含委派契约 + orchestration caveat | ✅ | modes.md「Delegation contract (M8, Feature 185)」节；configuration.md `modes.<mode>.phases` runtime caveat |
| AC-4 README M8 行 Delivered + KB 行 + 受控区零改动 | ✅ | M8 行 `✅ Delivered` + M8 note；Documentation 区 KB 指南链接；`spec-driver:section:*` marker 无增删 |
| AC-5 scaffold-kb-guide 存在且被链接 | ✅ | `docs/scaffold-kb-guide.md` 新增；README + cli-reference See Also 均链接 |
| AC-6 历史 roadmap 归档标注 | ✅ | v4-hotfix / v4.1-feature-b / v4.1-mapreduce 顶部加「✅ 历史归档」行 |
| AC-7 无客户名 + 无 src/ 改动 | ✅ | 通用化 grep 无命中；`git status` 无 `src/` 改动 |
| AC-8 repo:check + release:check 全绿 | ✅ | `repo:check` rc=0；`release:check` "Release contract valid" |

## 命令实跑抽查（NFR-003）

```
$ npx tsx src/cli/index.ts --version          → spectra v4.3.0   （dev 无 build 元数据 → 裸版本回退，符合 EC-4 文案）
$ npx tsx src/cli/index.ts batch --help       → 含 graph-only
$ npx tsx src/cli/index.ts scaffold-kb --help → build / ingest / serve / query
```

> 注：本 worktree 初始缺 `@sqlite.org/sqlite-wasm`（package.json 已声明，node_modules 未装），`npm install` 后 CLI 正常启动（package-lock.json 未变动）。

## 链接 / 锚点核查

- 新增相对链接目标文件均存在（scaffold-kb-guide / cli-reference / milestone-M8 / demo FIXTURE）
- guide → cli-reference 锚点 `#domain-knowledge-scaffold-scaffold-kb-feature-190192` 与标题一致
- guide → `../README.md#plugin-installation` 标题存在
- scaffold-kb 命令字面与 `src/cli/index.ts` HELP_TEXT 对齐（synopsis `[--output <kb/>]` 已对齐源码）

## 受控区 / 红线核查

- README `spec-driver:section:*` 受控区无改动（改动仅 Milestones 表 + M8 note + Documentation 链接，均在 marker 外）
- 无 `src/` 改动；package-lock.json 未变；无具体客户/公司名

## Codex 对抗审查结论与处置

审查 agent: `codex:codex-rescue`（只读对抗审查，36k token / 6.3min）。共 6 CRITICAL + 3 WARNING + 1 INFO，全部逐条对照源码复核。

| # | 档 | 发现 | 复核 | 处置 |
|---|----|------|------|------|
| C1 | CRITICAL | README M8 标 `✅ Delivered` 但 F188 未跑 | 属实 | **接受现状**：用户 task 明确要求"M8 Delivered 行"；相邻 M8 note 已诚实披露"eval re-judge 就绪待派 / npm 4.3.0 staged 待授权"，不构成误导 |
| C2 | CRITICAL | `code-only` 被描述为零 LLM | 属实（`index.ts:114`）| **已修** cli-reference(T004) + README:101（用户裁决 A：受控段 prose 更正，补 graph-only，零 LLM 指向 graph-only）|
| C3 | CRITICAL | cache 命令 `--list`/`--clear` 错 | 属实（应 `stats`/`clear`）| **已修** cli-reference:70-71 → `spectra cache stats` / `clear`，实跑确认 |
| C4 | CRITICAL | 裸 `spectra install` 说成 post-commit hook | 属实（需 `--git`，`install.ts:38-45`）| **已修** cli-reference 两处 → 裸 install = PreToolUse hook，`--git` 才装 post-commit；实跑确认 `--git` 存在 |
| C5 | CRITICAL | guide `--probe` 示例不执行查询 | 属实（`scaffold-kb.ts:21-24` 输出 sentinel 即 return）| **已修** guide → 预览示例去掉 `--probe`，另注明 `--probe` 是可用性探测 |
| C6 | CRITICAL | auth 漏写 Codex CLI | 属实（`index.ts:96-100` 三模式）| **已修** cli-reference auth 表补第三行 Codex CLI；实跑 helptext 确认三模式 |
| W7 | WARNING | "冲突仲裁"说得过宽 | 属实（`result-merger.ts` kb_search 仅 freshness hint；仲裁在 `kb_api_lookup` 实体级）| **已修** guide + cli-reference：限定 kb_search=双呈现+freshness、仲裁=kb_api_lookup 实体级 |
| W8 | WARNING | `parallel_scheduling 适用所有 mode`误导 | 属实（仅 feature 动态消费）| **已修** configuration caveat → gates 跨模式生效、parallel_scheduling 当前仅 feature |
| W9 | WARNING | 委派契约对 refactor 不清 | 属实（sync 清单仅 5 skill）| **已修** modes → 明确机器强制集为 5 个编排 skill，refactor 未纳入 |
| I10 | INFO | codex 探查不到 `plugins/scaffold-kb/cli/` | 我方文档**未**引用该路径（grep 零命中）| 无需处理 |

### 受控区 prose 更正（C2 README:101 + 同类 install README:172）— 用户裁决 A，已修

`README.md` 的 `<!-- spec-driver:section:spectra -->` 受控段内两处**预存**事实错误（非本次引入），
经用户明确授权（选项 A）在同 commit 手改：
- L101 `--mode code-only (skip all LLM, AST-only)` → `code-only (skip enrichment, still per-module spec-gen LLM) / graph-only (pure AST, zero LLM, no auth)`
- L172 `spectra install registers a post-commit hook` → `spectra install --git registers a post-commit hook`

复核：`<!-- spec-driver:section:* -->` marker 无增删；`release-contract:root-readme-badge` 仍 pass；
repo:check exit=0（根 README section 无 sync 脚本写入，badge 行未动，故不受影响）。

### 复验（修复后）
- `repo:check` exit=0（无 fail/drift）；`release:check` valid
- 更正命令实跑确认：`cache stats|clear` / `install --git` / auth 三模式 helptext / `scaffold-kb query`（去 probe）
