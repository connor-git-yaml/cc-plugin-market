---
feature_id: 187
artifact: research
created: 2026-06-14
---

# F187 技术决策研究

本文件记录规划阶段对每个关键技术选型的决策过程、理由及替代方案。

---

## D1：harness 测试集数据源

**决策**：使用方案 A——从 fixture.swebenchMeta 合成本地 JSONL 文件，通过 `--dataset_name <本地 JSONL 路径>` 喂给 harness。

**理由**：
- FR-001-f 要求执行集与 fixture.swebenchMeta 可校验，本地 JSONL 来自 fixture，天然自洽
- FR-005-c 要求 freezeBlock 记录数据源标识，本地 JSONL 的内容 sha256 比 HF revision 更稳定（不受 HF API 波动影响）
- 离线可跑（镜像一旦 pull 完毕，无网络依赖）

**替代方案**：HF dataset + 冻结 revision（方案 B）。未选择的原因：revision 冻结依赖 HF API 访问，与 fixture 数据源存在潜在漂移，无法满足 W1 不变量严格校验。

**不确定项**：`--dataset_name` 参数是否接受本地文件路径（而非仅 HF repo name），需在 implement 阶段运行 `python -m swebench.harness.run_evaluation --help` 确认。若不支持，降级为方案 B，freezeBlock 字段改为 `datasetHFRevision`。

---

## D2：phaseReached 打点机制

**决策**：在 `swebench-oracle.mjs` 中逐行解析 harness stdout/stderr 流，根据 log marker 字符串实时更新 phaseReached 状态变量；marker 缺失时保守取值为 `image`（等价 test_exec 之前），fallback 判 `error/infra`。

**理由**：
- Q1 决策要求分阶段归因，phaseReached 是 candidate vs infra 的关键区分点
- 实时打点（而非事后解析）能正确处理 harness 被 watchdog 杀掉的情况（此时 log 可能不完整）
- 保守取值（不确定 → 判 infra）遵循"宁可少算 fail 分母也不误计 fail"的原则，保护候选工具免受环境问题惩罚

**替代方案**：事后一次性解析 log 文件。未选择的原因：harness 被 watchdog kill 后 log 可能部分丢失，事后解析无法正确处理被中断的阶段边界。

---

## D3：classifyOracle 落点选择

**决策**：抽取到独立 `scripts/lib/classify-oracle.mjs` 纯函数模块。

**理由**：
- FR-005-b 要求 oracleSpecHash 覆盖分类逻辑源码摘要，独立文件使 sha256 计算边界清晰明确
- 当前实现（行 179-193）仅 3 行逻辑，完全重写为 14 行决策表，不适合原地扩展
- 独立文件可被 swebench-oracle.mjs 和 cohort-batch.mjs 共享

**替代方案**：原地重写 swe-bench-verified-cohort-batch.mjs 中的 classifyOracle。未选择的原因：无法满足 oracleSpecHash 对分类逻辑独立计算 sha256 的需求（sha256 计算范围应精确到决策函数，不应包含整个 batch 脚本）。

---

## D4：swebench oracle runner 落点

**决策**：新建独立 lib `scripts/lib/swebench-oracle.mjs`，eval-task-runner.mjs:runPrimaryOracle 新增 `swebench-execution` 分支仅作调用入口（~10 行）。

**理由**：
- eval-task-runner.mjs 已 975 行，继续追加将超出合理边界
- swebench-oracle.mjs 约 250 行逻辑（subprocess + watchdog + phaseReached + log 解析），独立文件便于单测
- 遵循 spec Phase C 技术原则"前置清理规则"：文件 LOC > 500 且将新增 > 50 行，必须向外抽取

**替代方案**：在 runPrimaryOracle 内直接内联 swebench-execution 逻辑。未选择的原因：违反前置清理规则，且无法独立单测 oracle 模块。

---

## D5：OracleAdapter 接口设计

**决策**：不引入完整 OracleAdapter class hierarchy，仅导出单函数 `runSwebenchInstance`，fuzzy-match secondary 保持现有代码不变。

**理由**：spec FR-001-c 明确 fuzzy-match 降级为 secondary 对照且保留现有代码；目前只有一个真实 oracle kind（swebench-execution），引入 class 层是过度抽象（YAGNI）。若未来需要扩展其他 oracle kind，届时再提取 interface。

**替代方案**：定义 `OracleAdapter interface` + `SwebenchHarnessAdapter implements OracleAdapter`。未选择的原因：两个实现（swebench + fuzzy-match）的接口不兼容（fuzzy-match 是同步函数，swebench 是异步进程），强行统一反而增加复杂度。

---

## D6：cohort registry 数据结构

**决策**：`REGISTRY` 为纯 JS 对象数组，不引入 Zod schema（评测脚本层），以 `promptBuilder: null` 表示缺省，运行时检查。

**理由**：评测脚本层（scripts/*.mjs）不经 tsc 编译，无运行时 Zod；引入 Zod 违反当前 scripts/ 层的零 npm 导入约束。运行时检查（`if (!entry.promptBuilder) throw new Error(...)`）已满足 SC-007 要求。

**替代方案**：用 Zod 定义 CohortEntry schema。未选择的原因：scripts/ 层不能 import src/ 或 node_modules/zod（ESM 评测脚本）；且 schema 只有 6 个字段，不需要 Zod 级别的验证。

---

## D7：oracleSpecHash canonical 序列化

**决策**：手动 sort keys 的 JSON.stringify + sha256 hex；schemaVersion 为 `"1.0"`。

**Canonical 输入字段**（确定性，sort key 按字母序）：
- `arch`：镜像策略标识（`"arm64-first"` 或 `"x86_64"`）
- `classifyOracleSha256`：classify-oracle.mjs 文件内容的 sha256（UTF-8 编码）
- `datasetSource`：`"local-jsonl"` 或 `"hf:{name}@{revision}"`
- `kind`：`"swebench-execution"`
- `swebenchVersion`：从 venv pip freeze 输出提取 `swebench==x.y.z`
- `timeout`：watchdog timeoutMs 数值

**理由**：手动 sort 不依赖第三方库；sha256 对 classify-oracle.mjs 源码的覆盖满足 Q2 决策要求（改分类代码 → hash 变化 → 校验拦截）。

**不确定项**：swebench pip 版本号的稳定提取方式——从 venv 的 `pip show swebench` 或 `pip freeze` 输出解析 `swebench==x.y.z`，需在 implement 阶段验证在 arm64 macOS 上可靠。

---

## D8：manifest 格式选择

**决策**：YAML 格式（`experiment-manifest.yaml`），通过 Node.js 原生 `fs.readFileSync` + 手写 YAML 解析（仅支持本 feature 需要的 6 个顶层标量字段 + 一个 swebench 嵌套块），不引入 `js-yaml` 依赖。

**理由**：manifest 只有约 8 个字段（全为标量或简单嵌套），手写解析约 20 行即可覆盖，不值得引入 npm 依赖；YAML 比 JSON 便于注释。

**替代方案**：JSON 格式 + JSON.parse。未选择的原因：JSON 不支持注释，评测工程师无法在文件中记录跑批意图；YAML 更符合评测配置文件的习惯用法。

---

## D9：Python venv 位置与 bootstrap

**决策**：`scripts/.swebench-venv/`（仓库内，.gitignore 忽略）；一次性 bash 脚本 bootstrap，不入 npm postinstall hook。

**理由**：
- 仓库内 venv 路径确定，可在 manifest/代码中硬设默认值，无需环境变量
- 不入 postinstall hook 避免所有 `npm install` 触发 Python 环境操作，影响 CI 和开发者体验
- `SWEBENCH_VENV` 环境变量可覆盖默认路径（CI 环境预装 venv 时使用）

**替代方案**：venv 放 `~/.swebench-venv/`（home dir）。未选择的原因：跨 worktree 共享 home dir venv 可能导致版本冲突（不同 feature 分支 pin 不同 swebench 版本时）；仓库内 venv 更隔离。
