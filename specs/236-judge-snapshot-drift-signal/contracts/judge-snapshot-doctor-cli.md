# 合同：`judge-snapshot-doctor.mjs` CLI

**新增文件**：`plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`
**新增 lib**：`plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs`、`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`
**调用方**：开发者主动通过 `npm run judge:doctor` 触发；不接入 `hooks.json`，不接入 `repo:check`

## 调用方式

```bash
# 默认使用当前工作目录作为 projectRoot
npm run judge:doctor

# 显式指定 projectRoot（非交互式脚本场景）
node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs --project-root /path/to/spec-driver-repo
```

## 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `--project-root <path>` | 否，默认 `process.cwd()` | 判定所依据的仓库根；`checkJudgeSnapshotDrift()` 的核心判定合同以此为准，不直接读取 `cwd`（FR-005） |

## 输出与退出码

`DriftCheckResult` 是判别式联合（见 `judge-snapshot-drift-result.md`），`indeterminate` 态按 `indeterminateKind` 区分为 `resolution`（快照尚未定位，无文件明细）与 `comparison`（快照已定位，仅部分文件读取失败，**必须**打印文件明细）两种呈现方式：

| 场景 | 退出码 | stdout |
|------|--------|--------|
| 参数非法（如 `--project-root` 缺值、未知参数） | **1** | 参数错误提示（stderr），不打印报告 |
| `status: not-applicable` | 0 | 报告：说明 `reason`（`repo-reference-missing` 或 `no-installed-snapshot`），不含文件级明细 |
| `status: indeterminate`，`indeterminateKind: 'resolution'` | 0 | 报告：说明 `reason`（及 `detail.source`/`detail.errorCode`，若存在），**不含**文件级明细（快照路径本身未能确定，无从列出逐文件比对） |
| `status: indeterminate`，`indeterminateKind: 'comparison'` | 0 | 报告：`snapshotPath` / `resolutionSource` / 逐文件状态（**含**已确认的 `match`/`mismatch`/`missing*` 条目，以及触发失败的 `indeterminate` 条目及其 `side`/`errorCode`）/ 汇总计数——**不得**因整体态是 `indeterminate` 就省略已确认的比对明细 |
| `status: in-sync` | 0 | 报告：`snapshotPath` / `resolutionSource` / 逐文件 `match` 列表 / 汇总"6/6 一致" |
| `status: drift` | 0 | 报告：`snapshotPath` / `resolutionSource` / 逐文件状态（`match`/`mismatch`/`missingInSnapshot`/`missingInRepo`/`missingBoth`）/ 汇总计数 |

**关键不变量（FR-009）**：`drift`（以及 `indeterminate` 的两个变体）都不是失败，doctor 命令本身恒以 0 退出（除非命令行参数本身非法）。输出中**不包含**任何重装/同步/修复建议或命令（FR-011）。

## 输出文本示例（`drift`，含部分 match 部分 drift 与 `missingBoth`）

```text
判定器快照漂移诊断（judge-snapshot-doctor）
============================================
projectRoot:      /Users/xxx/cc-plugin-market
snapshotPath:     /Users/xxx/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0
resolutionSource: installed-plugins-metadata
status:           drift

文件明细（6）：
  [match]              scripts/fix-compliance-judge.mjs
  [mismatch]            scripts/lib/fix-compliance-core.mjs
  [missingInSnapshot]   scripts/lib/fix-compliance-execution-record.mjs
  [missingBoth]         scripts/lib/simple-yaml.mjs
  [match]               scripts/lib/fix-compliance-io.mjs
  [match]               scripts/record-workflow-run.mjs

汇总: 3 match / 1 mismatch / 1 missingInSnapshot / 0 missingInRepo / 1 missingBoth
```

## 输出文本示例（`indeterminate`，`indeterminateKind: 'comparison'`，mismatch + EACCES 混合）

```text
判定器快照漂移诊断（judge-snapshot-doctor）
============================================
projectRoot:      /Users/xxx/cc-plugin-market
snapshotPath:     /Users/xxx/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0
resolutionSource: claude-plugin-root
status:           indeterminate（comparison：快照已定位，但部分文件读取失败，以下为已确认明细）

文件明细（6）：
  [match]              scripts/fix-compliance-judge.mjs
  [mismatch]            scripts/lib/fix-compliance-core.mjs
  [indeterminate]       scripts/lib/fix-compliance-execution-record.mjs   (side: repo, errorCode: EACCES)
  [match]               scripts/lib/fix-compliance-io.mjs
  [match]               scripts/lib/simple-yaml.mjs
  [match]               scripts/record-workflow-run.mjs

汇总: 4 match / 1 mismatch / 1 indeterminate（读取失败）
说明: 存在读取失败的文件，无法对其完成比较；已确认的 mismatch/match 明细如上，不因此被隐藏。
```

## 输出文本示例（`not-applicable`）

```text
判定器快照漂移诊断（judge-snapshot-doctor）
============================================
projectRoot: /tmp/some-other-repo
status:      not-applicable
reason:      repo-reference-missing（当前 projectRoot 下未找到 plugins/spec-driver/scripts/fix-compliance-judge.mjs，非 spec-driver 仓库自身，无从比对）
```

## 输出文本示例（`indeterminate`，`indeterminateKind: 'resolution'`，来源错误）

```text
判定器快照漂移诊断（judge-snapshot-doctor）
============================================
projectRoot: /Users/xxx/cc-plugin-market
status:      indeterminate（resolution：无法确定本机 active 快照目录）
reason:      source-error
detail:      source=claude-plugin-root, errorCode=EACCES（CLAUDE_PLUGIN_ROOT 指向的目录存在，但读取其 manifest 时权限不足，无法判断该路径是否为合法插件根；未尝试回退到其他来源比对，因为这一错误比"这里没有"更需要人工关注）
```

## 不变量

- **零 LLM / 零子代理委派**：本 CLI 全程无 `Task(` / 模型 API 调用。
- **零新增运行时依赖**：仅使用 `node:crypto`/`node:fs`/`node:path`/`node:os`/`node:url`（FR-004）。
- **不修改任何现有文件的行为**：不 import、不调用 `stop-fix-compliance-check.sh` 或 `repo-maintenance-core.mjs` 的任何符号，二者行为字节级不变（FR-010）。
- **核心判定函数以 `projectRoot` 为合同，不直接读 `cwd`**：`checkJudgeSnapshotDrift({ projectRoot, env, claudeHome })` 的三个入参均可显式注入，`env`/`claudeHome` 默认值分别为 `process.env`/`path.join(os.homedir(), '.claude')`，便于单测在不触碰真实 HOME 目录的前提下穷举各态与优先级链路。
- **不输出 `--json`**（research.md D6）：本次范围仅提供人类可读文本；核心函数已返回结构化对象，供测试直接断言，CLI 层格式化不影响该合同。
- **`indeterminate` 呈现分层**：CLI 格式化层必须依据 `indeterminateKind` 选择呈现分支（`resolution` 不打印文件明细；`comparison` 必须打印文件明细），不得用单一的"只打印顶层 reason"逻辑笼统处理两种变体（C3 修订核心诉求）。
