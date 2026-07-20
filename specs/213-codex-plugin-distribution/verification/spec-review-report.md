# Feature 213（Codex Plugin 一体分发 A1）Spec 合规审查报告

> 审查代理：spec-driver:spec-review（sonnet）；2026-07-20。代理工具集无 Write，本文件由主编排器按其返回全文落盘；文末「编排器补录」为落盘时新增的直接证据。

## 逐条 FR 状态

| FR | 描述 | 状态 | 证据 |
|---|---|---|---|
| FR-001 | Spectra 新增 `.codex-plugin/plugin.json`，version/description 来自 contract | SATISFIED | manifest 含 name/author/homepage/repository/license/keywords/version/description，`version`/`description` 与 `contracts/release-contract.yaml` `products.spectra` 一致 |
| FR-002 | Spec Driver 同上 | SATISFIED | `plugins/spec-driver/.codex-plugin/plugin.json` 同构，字段与 `products.spec-driver` 一致 |
| FR-003 | spectra manifest `mcpServers: "./.mcp.json"` | SATISFIED | manifest 第 18 行；矩阵 `mcp-servers-reference:spectra` check 校验 `.mcp.json` 含 `mcpServers.spectra` |
| FR-004 | spectra `skills: "./skills/"` 直接复用 canonical | SATISFIED | manifest 第 17 行；`research/spectra-skill-neutrality-scan.md` 复跑证据（T008，`rg` exit=1 空输出）+ 矩阵 `spectra-skill-neutrality` warn check 兜底 |
| FR-005 | spec-driver manifest `skills` 指向 Codex 适配目录，与 wrapper contract 一致，F186 sha 链继续生效 | SATISFIED | manifest `"skills": "./skills-codex/"`；`skills-codex/` 实测 8 目录与 `wrapper-source-of-truth.yaml` entries（新增 `pluginDistributionRoot`）一致；`validate-wrapper-sources.mjs` 泛化出 `codex-plugin-distribution-markers` check |
| FR-006 | manifest 无 hooks 字段；hook 脚本随包 ship | SATISFIED | 两 manifest 均无 `hooks` key（矩阵 `no-hooks-field:*` pass）；`codex-plugin-manifest.test.ts` 断言两份 hooks.json 存在且引用脚本 `fs.existsSync` 复核 |
| FR-007 | repo:check 校验链新增一致性矩阵 check | SATISFIED | `repo-maintenance-core.mjs` import + `aggregateValidation('codex-plugin-consistency', ...)` 注册进 `validateRepository()` |
| FR-008 | manifest version/description 纳入 release-contract expectEqual | SATISFIED | `release-contract.yaml` 两 product 增 `codexPluginManifestPath`；`release-contract-core.mjs` 对称扩展；`release-contract-sync.test.ts` 覆盖同步+漂移 |
| FR-009 | 矩阵接入既有 repo:check/release:check，不新增独立命令 | SATISFIED | `validate-release-contracts.mjs` 直接 import 并调用 `validateCodexPluginConsistency`，扁平合并进 payload（薄壳直调真实存在） |
| FR-010 | 双层机械确认策略 | SATISFIED | (a) 三个结构性测试文件不依赖 binary；(b) e2e `describe.skipIf(!hasCodex)`，本机 codex 0.144.6 实跑 1 passed（verification-report T021） |
| FR-011 | 不修改 Claude 侧 canonical 制品语义 | SATISFIED | 改动文件清单交叉核实 + verification-report 声明；**直接证据见文末编排器补录（机械 diff 零输出）** |
| FR-012 | waiver 契约 YAML + 陈旧 waiver 护栏 | SATISFIED | `codex-plugin-consistency.yaml` waivers 段（id/missingSkillIds/tracking/removalCondition）；core 陈旧 waiver 审计 + 重复 id 审计 + 精确删除模拟测试（error 指名 `spec-driver-refactor`） |
| FR-013 | tracked marketplace.json + 最小化收窄 | SATISFIED | marketplace.json schema 全对；`.gitignore` `.agents/*`+`!.agents/plugins/**`；SYMLINK_TARGETS 仅 `.agents/skills`；fresh-clone 真实验证 |

## SC 状态

| SC | 状态 | 证据 |
|---|---|---|
| SC-001 | SATISFIED | verification-report T021：真实 `codex plugin add spectra@<market>` → `plugin list --json` installed:true → `mcp list` 含 spectra stdio server |
| SC-002 | SATISFIED | T021 cache 实测枚举 8 目录 diff IDENTICAL wrapper entries + 双 check pass + waiver 呈现 |
| SC-003 | SATISFIED | 单测负例族等价 fixture mutation 覆盖（数量不一致/条目缺失/路径不匹配→error 全检出） |
| SC-004 | **PARTIAL** | build/repo:check/release:check exit 0；`npx vitest run` exit 1（8 failed / 5124 passed）。8 失败经实证归因预存共享 home fixture 污染 + M9-B 符号 ID 漂移，与本 feature 正交（T000 基线该簇全 pass）。tasks.md T022 已自我标注 PARTIAL；**豁免/修复裁决交 GATE_VERIFY 用户**，follow-up task_d0f4b48f 已立案（用户已在独立会话启动） |
| SC-005 | SATISFIED | 同 FR-011 证据；T022 基线比对无 Claude 侧既有用例回归 |
| SC-006 | SATISFIED | fresh-clone 用例：marketplace.json 物化存在 + `.agents/skills` 不物化，真实 `git clone` 执行 |

## 总体合规率

**13/13 FR（100%）**；**SC 5/6 SATISFIED + 1 PARTIAL（SC-004，裁决权在 GATE_VERIFY）**。

## 偏差清单

1. **SC-004 PARTIAL**：8 个全量失败（feature-180-*/feature-184-* e2e 簇），根因共享 `~/.spectra-baselines/micrograd-output` 污染 + `#`/`::` 双格式，非本 feature 依赖。GATE_VERIFY 选项：(a) 接受预存环境噪声带星号放行；(b) 先重建 fixture 重跑零失败再放行。不由审查代理拍板。
2. **FR-011/SC-005 证据来源局限（已闭合）**：审查时无 Bash 只能间接核实；已由编排器补直接 diff 证据（见补录）。

## 过度实现检测

未发现 spec 未定义功能面扩张：neutrality warn check / waiver 双审计属 FR-007/012 合理外延；`--sync-plugin-distribution` 为 plan 已裁定的 opt-in 工程手段；无脱离 13 FR 的配置/命令/用户可见行为。

## 问题分级汇总

- CRITICAL: 0 | WARNING: 1（SC-004 PARTIAL，需 GATE_VERIFY 裁决）| INFO: 2（FR-011 间接证据已补直接证据；过度实现扫描无异常）

## 通用定位红线核对

抽查全部新增 manifest/contract/marketplace/specs 制品：author 为个人开发者署名，repository 指向本仓库，零客户名/行业绑定/客户专属信息。符合红线。

---

## 编排器补录（2026-07-20 落盘时）

FR-011/SC-005 直接证据：

```
$ git diff --stat 2466905..HEAD -- .claude-plugin/ plugins/spectra/.claude-plugin/ \
    plugins/spec-driver/.claude-plugin/ plugins/spectra/skills/ plugins/spec-driver/skills/ \
    plugins/spectra/.mcp.json plugins/spectra/hooks/ plugins/spec-driver/hooks/
（无输出，exit=0 —— Claude 侧 canonical 制品在整个 feature 分支零字节改动）
```
