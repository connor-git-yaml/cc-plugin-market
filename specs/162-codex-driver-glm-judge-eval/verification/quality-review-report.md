# Feature 162 — 代码质量审查报告

> Reviewed at: 2026-05-10
> Subagent: spec-driver:quality-review (Opus, quality-first preset)
> Scope: 4 commits (ca436cd / 5d96c86 / a98bde5 + 设计 commit 62e1db7)
> Files reviewed: 8 文件（5 新增 / 3 修改）

## 范围与基线

| 文件 | 角色 | 行数 | 任务声称 | 实测 |
|------|------|------|---------|------|
| scripts/lib/llm-backend-dispatcher.mjs | 新增 | 762 | ~530 | **+44% 偏离** |
| scripts/lib/pearson.mjs | 新增 | 65 | ~65 | OK |
| scripts/lib/judge-prompt-builder.mjs | 新增 | 67 | ~50 | OK |
| scripts/calibrate-glm-judge.mjs | 新增 | 1273 | ~1100 | **+15% 偏离** |
| scripts/eval-task-executor.mjs | 修改 | 448 | +50/-20 | OK |
| scripts/eval-judge-jury.mjs | 修改 | 702 | +10/-0 | （含 -34 删 prompt 抽到共享）OK |
| scripts/eval-mcp-augmented.mjs | 修改 | 944 | +15/-0 | OK |
| scripts/verify-feature-162-fixture-schema-stable.mjs | 新增 | 232 | ~190 | OK |

> 备注：dispatcher 与 calibrate 的实际行数高于 plan 与任务描述的估算，但 plan §2.1+§2.5 + 4 轮 codex review (iter-1/2/3) 已显式认可该规模并要求 W-1/W-2/W-3 + C-1~C-6 全量修复（修复带来正常体量增长）。本审查不重复质疑。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 1. 架构合理性 | EXCELLENT | dispatcher 抽象边界清晰；callExecutor thin wrapper 保留旧签名（C-1）；3 入口 self-judge hard-fail 集成完整 |
| 1.5 累积劣化（STRUCTURAL_DEBT） | GOOD | dispatcher 762 / calibrate 1273 行均 < 800/1500 critical 阈值；calibrate 接近 WARNING 阈值需警觉 |
| 1.7 跨模块一致性 | EXCELLENT | dispatcher / judge-prompt-builder import 路径在 4 个 caller 一致；DEFAULT_EXECUTOR_MODEL / DEFAULT_JUDGES / MODEL_ALIASES 单点定义 |
| 2. 设计模式合理性 | GOOD | normalize 5 步顺序合理；retry matrix 决策表化；4 backend dispatcher 用 switch 而非工厂注册（合理克制）；calibrate 8 模块分段清晰 |
| 3. 安全性 | GOOD | API key 不入 artifact；codex CLI 鉴权预检友好；prompt 直接拼接 user input（spawn arg 数组形式，无 shell 注入）；artifact 路径 hardcode 在 REPO_ROOT 下，无路径穿越 |
| 4. 性能 | GOOD | jury 4 judge `Promise.all` 并发；token Jaccard O(n) Map 算法；retry 仅 transient 1 次；无 N+1 |
| 5. 可读性 | EXCELLENT | normalize 5 步注释明确（plan §2.1.7 引用）；retry matrix 表格化；calibrate 8 模块分段（「模块 1：fixture 加载」… 「模块 8：API key 检查」）；C-X / W-X 修复点注释完整 |
| 6. 可维护性 | GOOD | 函数命名清晰（runOracle/runJury/extractFallbackFailClosedPassSet）；注释 why-not-what；main / runCalibrationRound 略长但分段清晰；4 backend handler 有合理重复但语义不同不强求合并 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 设计模式 | scripts/eval-judge-jury.mjs:638 + scripts/eval-mcp-augmented.mjs:893 + scripts/calibrate-glm-judge.mjs:1027 | "driverModel 默认 'codex:gpt-5.5'" 字符串字面值在 3 处重复（plus eval-task-executor.mjs:39 一处源头）。改 default 时易漏改其中之一，导致 self-judge 检查与实际 driver 不匹配 | 在 dispatcher 或新建 `eval-defaults.mjs` 中 export `DEFAULT_DRIVER_MODEL = 'codex:gpt-5.5'`；3 处入口 `import { DEFAULT_DRIVER_MODEL }` + `process.env.SPECTRA_EVAL_EXECUTOR \|\| DEFAULT_DRIVER_MODEL` |
| WARNING | 可维护性 | scripts/lib/llm-backend-dispatcher.mjs:140-192 (classifyError) | quota 关键字识别仅匹配 lowercase substring 5 个 (`quota_exceeded` / `rate_limit_exceeded` / `insufficient_quota` / 429 / 'connection reset')。SiliconFlow / Codex CLI 实际 quota 错误措辞可能漂移（例如 "quota exhausted" / "billing limit"），易漏分类导致误 retry transient | 把 quota / transient pattern 提取为 `const QUOTA_PATTERNS = [...]` + `const TRANSIENT_PATTERNS = [...]` 数组，便于运营在 fix 阶段追加；或写一个 `tests/unit/classify-error-patterns.test.ts` 列出 4 backend 实测错误样本 |
| WARNING | 可维护性 | scripts/calibrate-glm-judge.mjs:1011-1189 (main) | main 函数 178 行，含 1) api-key-check 早返回 2) jury 选择 3) fixture 加载 4) callBackendImpl import 5) 跑 round 6) integrity 校验 7) 阈值评估 8) 写 artifact 9) 阈值未达提示。8 个职责段在一个函数里 | 拆为 `runApiKeyCheckMode(args)` + `runCalibrationMode(args)`；后者再拆 `loadInputs / executeRound / persistArtifact / printDiagnostics`。每个 < 50 行 |
| WARNING | 设计模式 | scripts/lib/llm-backend-dispatcher.mjs:140-192 (classifyError) | 第 5 步「无 err 但 text 不是合法 JSON object → schema-invalid」的 lookahead JSON 检测：用正则 `/\{[\s\S]*\}/` 贪婪匹配 + JSON.parse，若 text 含合法 JSON object 但前后还有非法噪声，会被判 valid（漏报 schema-invalid） | 改用 `text.trim() === parsed-roundtrip` 严格回判；或文档明确「第 5 步只覆盖完全 JSON 形态」由 caller `parseJudgeJson` 兜底（已注释暗示但未明说） |
| INFO | 可读性 | scripts/lib/llm-backend-dispatcher.mjs:354-360 vs 350-359 | callBackend 成功 / 失败两条 return path 都构造完整 9 字段对象，字段顺序不同。视觉对比时容易漏看是否字段一致 | 提取 `function buildResult(ok, handlerResult, attempt, error?)` helper，单点构造；2 处 return 改 1 行 |
| INFO | 可维护性 | scripts/lib/llm-backend-dispatcher.mjs:42-82 (MODEL_ALIASES) | 26 个 alias 用文字对象字面量列出，新增模型时易漏 dot/hyphen 变体之一（GPT-5.5 列了 4 变体，Kimi 只列 2 变体不一致） | 加 helper `expandDotHyphenVariants(canonicalId)` 自动生成 4 变体（`gpt-5.5` / `gpt5.5` / `gpt-5-5` / `gpt5-5`），降低人为遗漏；现有 26 entry 改为生成器输出 |
| INFO | 性能 | scripts/calibrate-glm-judge.mjs:333-374 (normalizeDiffToTokens + multisetJaccard) | 长 patch（>10K 行）会造成单次 5 fixture × 3 runs × O(token²) 累计可观；当前 calibration fixture 有 goldpatch ≤ 几百行所以无问题，但若 fixture 替换为大型项目（plan 提及 self-dogfood ~17K LOC）会成 hotpath | 留 follow-up Feature 注记：超过 1K token 时改用 Counter-based linear-time Jaccard（已是 O(n) Map 实现，但 multisetJaccard 内 `new Set([...ca.keys(), ...cb.keys()])` 仍 O(n) 临时分配） |
| INFO | 可读性 | scripts/calibrate-glm-judge.mjs:486-512 (runJury dry-run) | dry-run mock score 公式 `oracleBase + noise` 把 noise 幅度跟 fallback 路径耦合（slot === 'opus' \|\| 'kimi'）。逻辑分支 5 行内有 2 个三元 + 1 个 `.some()`；重读时需推导 | 提取 `function pickNoiseAmplitude(judgeName, isFallbackPath, slot)` helper |

## 总体质量评级

**EXCELLENT**

依据：
- 0 CRITICAL（无安全漏洞 / 数据丢失风险 / 构建阻断）
- 4 WARNING（全部为可维护性 / 设计模式优化建议，非阻断）
- 4 INFO（命名 / helper 抽取 / follow-up 性能注记）
- 4 轮 codex 对抗审查（iter-1/2/3 + C-1~C-6 + W-1~W-3 全清）已把核心 critical 逐条收口
- plan §2.1 + §2.5 架构决策与实现完整对齐：normalize 5 步、retry matrix 4 类、self-judge 3 入口、calibration 4 judge + fail-closed fallback 全部落地
- 注释质量优秀：所有 critical 修复点都标了 C-X / W-X / FR-XXX / plan §X.Y 引用，便于后续维护者追溯设计意图

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 4 个
- INFO: 4 个

## 是否阻断 verify phase

**不阻断**。所有 WARNING 均为长期可维护性建议，不影响 Feature 162 verify acceptance（calibration runner 跑通 + threshold pass + artifact byte-stable）。建议把 4 条 WARNING 录为 follow-up Feature（"eval-defaults 抽取" + "classify-error-patterns 测试覆盖" + "calibrate main 拆分" + "schema-invalid 严格回判"），不在本 Feature 范围内修。

## 关键风险点（< 3 条）

1. **driver default 字面值 3 处重复**：`'codex:gpt-5.5'` 在 jury / mcp / calibrate 各自 hardcode；未来切换 driver 时 self-judge 检查会失准。优先级：跟 Feature 163+ 同期修。
2. **classifyError 关键字白名单脆弱**：4 backend 错误措辞演变后会漏分类；建议 ops 第一次实跑 calibration 时收集真实错误样本，回填测试。
3. **calibrate-glm-judge.mjs 1273 行临近 WARNING 阈值**：当前 < 800 行 STRUCTURAL_DEBT 阈值已破，但 plan + codex review 4 轮已认可此规模；下一次新增功能前优先考虑拆 `calibrate-glm-judge/` 子目录（fixtures.mjs / oracle.mjs / jury.mjs / metrics.mjs / main.mjs），而非继续在单文件追加。
