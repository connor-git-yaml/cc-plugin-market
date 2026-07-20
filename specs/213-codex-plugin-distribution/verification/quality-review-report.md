# Feature 213 代码质量审查报告

审查范围：`git diff 2466905..HEAD`，聚焦
`scripts/lib/codex-plugin-consistency-core.mjs`、`scripts/lib/repo-maintenance-core.mjs`、
`scripts/validate-release-contracts.mjs`、`scripts/lib/release-contract-core.mjs`、
`plugins/spec-driver/scripts/codex-skills.sh`、`plugins/spec-driver/scripts/validate-wrapper-sources.mjs`、
`scripts/sync-worktree-local-state.sh`、`contracts/codex-plugin-consistency.yaml`、6 个新/改测试文件。

验证方式：全量 Read 上述实现文件 + 逐条 diff review + 实跑相关测试套件
（`npx vitest run` 覆盖 8 个测试文件、78 用例，全绿，用时约 3.2s）。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 简洁之道 | GOOD | 命名达意、函数职责单一（`checkManifestBase`/`checkSkillsReference`/`validateWrapperMarkers` 均单一目的）；注释聚焦 why（如 `isPlainObject` 防 TypeError 的理由、`rm -rf` copy-after-generate 的取舍理由）；无死代码；`validateWrapperMarkers` 参数化改造引入 6 个参数，略降可读性但有清晰复用理由（1 处 WARNING，见下）|
| 架构一致性 | EXCELLENT | 新模块 `codex-plugin-consistency-core.mjs` 完整复用既有 `{status,checks,warnings,errors}` 输出合约、`aggregateValidation`/`namespaceCheck` 接入模式、`parseYamlDocument`（simple-yaml）解析路径；`release-contract-core.mjs` 的 `codexPluginManifestPath` 分支与既有 `pluginManifestPath` 分支逐字段对称；未发明平行 registry/graph/validator |
| 安全性 | GOOD | 无硬编码密钥；`codex-skills.sh` 的 `rm -rf "$dist_dir"` 因 `PLUGIN_DIR` 恒为 `cd ... && pwd` 绝对路径而安全；`sync-worktree-local-state.sh` 对旧 `.agents` symlink 迁移做了显式归一化比对防误删/写穿；无 shell 命令注入面（所有变量走 `"$var"` 引用，无 eval/拼接执行）|
| 性能 | N/A / GOOD | 纯文件系统读取 + 内存比较，规模为个位数 manifest/skill 目录，无 N+1、无同步阻塞风险 |
| 可读性 | GOOD | 关键分支均有中文注释说明设计取舍（waiver 审计、陈旧 waiver 检测、`entry_count==0` 危险分支的迁移守护）；`runMatrix` 单函数较长（约 190 行）但按 spectra/spec-driver/marketplace 三段顺序展开，符合既有 repo-maintenance 模式，可读性尚可（1 条 INFO 建议拆分） |
| 可维护性 | GOOD | 测试覆盖充分（见下）；1 处发现 `release:check` 薄壳丢弃 `codexResult.warnings`（见问题清单 W1），是本次审查中唯一实质性发现 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 错误处理/一致性 | `scripts/validate-release-contracts.mjs:12-21` | `codexResult.warnings`（例如"陈旧 waiver 请删除"提示）在 `release:check` 薄壳合并时被完全丢弃——既不进 JSON payload，也不在文本输出中打印，只有 `codexResult.errors` 被合并进 `payload.errors`。对比 `repo-maintenance-core.mjs` 的 `aggregateValidation` 会把 `result.warnings` 完整前缀合并进 `warnings[]`，两条链路对同一个 `validateCodexPluginConsistency()` 结果的处理不对称：`repo:check` 能看到警告，`release:check` 看不到。测试 `release-contract-sync.test.ts` 的"矩阵 warning-only（陈旧 waiver）→ 薄壳 exit 0"用例只断言了"不阻断"，没有断言警告文本是否可见，因此该行为空洞被测试锁定而非暴露。 | 在 `payload` 上补一个 `warnings` 数组字段（不破坏既有字段，只是新增），非 JSON 分支下按 `payload.errors` 同样方式打印 `payload.warnings`；README/注释里"扁平合并、不引入嵌套字段"的表述本身没问题，但应包含 warnings 而非仅 checks/errors |
| INFO | 可读性 | `scripts/lib/codex-plugin-consistency-core.mjs:151-336`（`runMatrix`） | 单函数覆盖 spectra / spec-driver / marketplace 三段校验逻辑，约 190 行，虽有清晰段落注释分隔，但函数本身职责跨三个校验域 | 可选：后续如再新增第三方 plugin 校验域，考虑拆成 `runSpectraChecks` / `runSpecDriverChecks` / `runMarketplaceChecks` 三个子函数，当前规模下非阻断项 |
| INFO | 可维护性 | `plugins/spec-driver/scripts/validate-wrapper-sources.mjs:63`（`validateWrapperMarkers` 签名） | 参数从 3 个扩到 6 个（`resolveTarget`, `checkId`, `checkTitle`, `missingHint`），调用点用位置参数传递容易在未来新增调用点时传错顺序 | 可选：改为单一 options 对象参数（`{ resolveTarget, checkId, checkTitle, missingHint }`），当前仅 2 个调用点风险可控，非阻断项 |

## 跨模块一致性检查（维度 1.7）

- import 路径：`codex-plugin-consistency-core.mjs`、`release-contract-core.mjs` 对 `simple-yaml.mjs` 的相对路径引用一致（`../../plugins/spec-driver/scripts/lib/simple-yaml.mjs`），未发现路径漂移
- 共享常量：`contracts/codex-plugin-consistency.yaml` 中 `expectedPlugins[].name` 与 `contracts/release-contract.yaml` 中 `products` 的 key（`spectra`/`spec-driver`）保持一致，未发现命名漂移
- 未发现引用了被删除符号的残留代码（`validateWrapperMarkers` 的旧 3 参调用点已同步改造为新签名，唯一调用点已随 diff 更新）

## 累积劣化检测（维度 1.5，STRUCTURAL_DEBT）

| 文件 | 现有行数 | 判定 |
|------|---------|------|
| `scripts/lib/codex-plugin-consistency-core.mjs` | 344（新文件） | 正常范围，未超阈值 |
| `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | 381（+62） | 未跨越 300→500 或 500→800 阈值 |
| `scripts/lib/repo-maintenance-core.mjs` | 318（+13，微改） | 未跨越阈值 |
| `scripts/lib/release-contract-core.mjs` | 356（+27） | 未跨越阈值 |

无 CRITICAL/WARNING 级别结构劣化信号。

## 测试质量说明（维度 4）

- 负例断言辨向性良好：多处显式断言具体 `check id`（如 `skills-reference:spec-driver`）与 `errors` 文本子串（如"manifest.skills 应为 ./skills/"），而非仅断言 `status !== 'pass'`，避免"任意 fail 都能通过"的测试自欺
- Fixture 隔离到位：`codex-plugin-consistency-core.test.ts`、`sync-worktree-local-state.test.ts`、`spec-driver-codex-skills.test.ts` 均使用 `mkdtempSync` 临时目录构造自包含 fixture；`spec-driver-codex-skills.test.ts` 新增 sentinel-file 双重防线（sentinel 存活 + 真实仓库 `skills-codex/` 快照不变），比单纯字节快照更能防"删了又重建相同内容"式的测试盲区
- `codex-plugin-manifest.test.ts`、`repo-maintenance-sync-check.test.ts` 等对真实仓库文件只读断言，未见写操作触及真实 tracked 文件，不污染仓库全局态
- 实测 78 个相关用例全绿，无回归

## Shell 脚本健壮性（维度 5）

- `codex-skills.sh`：`set -euo pipefail` 保留；新增 `sync_plugin_distribution_copy` 的 `rm -rf "$dist_dir"` 因 `PLUGIN_DIR` 恒为绝对路径（`cd "$SCRIPT_DIR/.." && pwd`）而安全；opt-in flag 默认 `false`，避免测试/普通 install 误触发
- `sync-worktree-local-state.sh`：新增的 `migrate_legacy_agents_symlink` 对旧整目录软链做了显式 pre-condition 检查（`-L` 判断）+ 归一化路径比对（`resolve_physical_path` 处理 macOS `/var`↔`/private/var` 差异）+ 非预期软链时 `exit 1` 而非静默处理，边界处理谨慎；未发现未加引号的变量展开风险

## 回归面（维度 6）

- 既有测试文件（`spec-driver-codex-skills.test.ts`、`sync-worktree-local-state.test.ts`、`release-contract-sync.test.ts`、`repo-maintenance-sync-check.test.ts`）的修改均为新增用例或对既有断言的等价改写（如 `.agents` → `.agents/skills` 路径收窄同步改写断言路径），未发现删除既有断言或弱化既有校验的情况
- `validateWrapperMarkers` 重构后既有调用点（`codex-wrapper-markers`）逐字节沿用 `entry.target` 解析逻辑，行为不变，由测试 `spec-driver-wrapper-source-truth.test.ts` 中"两 check 同过"用例锚定

## 总体质量评级

**GOOD**

评级依据：零 CRITICAL，WARNING = 1（release:check 丢弃 codex-plugin-consistency 的 warnings，信息可见性问题，非功能性 bug——errors 链路完整无损，仅 warning-only 场景下用户看不到"陈旧 waiver"等提示），INFO = 2（可选的可读性/可维护性建议，非阻断）。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 1 个
- INFO: 2 个
