# 问题修复报告 — F210 eval-validate 汇总层 infra-oracle 假报伪装候选全挂

## 问题描述

F208 慢验实测(2026-07-09 take1)发现:当 swebench oracle 因基建问题未真正执行时(per-task full.json 的 `taskExecution.primaryOracle.classification='error'` 且 `failureSource='infra'`,如 venv 缺失时 `cmd="(skipped: dataset build error)"`),`scripts/eval-validate.mjs` 的汇总层仍把该 run 计为普通 fail:输出 `passRate=0.0%` 且 `n_infra=0`(实测 3/3 run 全 infra-oracle 却汇总为 `n_valid=3 / n_infra=0`)。这把"仪器坏了"伪装成"候选全挂",极易误判为回归。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | passRate=0.0% 且 n_infra=0 为何发生? | 3 个 run 的 runner 均 exit 0(status='success'),oracle 结果结构化写盘;`computeValidationStats` 对 success run 走 `getOraclePassed` 路径,得到 `false` → 入分母计 fail |
| Why 2 | 为何 infra-oracle 会得到 false? | `readOraclePassed` → `oraclePassedFromFixture`(eval-calibrate.mjs:415)只读 `primaryOracle.passed === true`;classification='error' 的 fixture 里 `passed:false`(swebench-oracle.mjs:177-179 的 baseResult),于是被判"跑了但 fail" |
| Why 3 | 为何 oraclePassedFromFixture 忽略 classification? | 该函数是修 codex CRITICAL-1(旧实现读 swebenchResult 等死字段)时写的,当时只建模 pass / fail / missing(null)三态,设计假设 = "primaryOracle 结构存在 ⇒ oracle 已真正执行" |
| Why 4 | 该假设为何不成立? | F187 oracle 合同本就是三分类 `pass|fail|error`(classify-oracle.mjs 决策表):harness 在 test_exec 前失败(venv 缺失 → dataset build error)时,runner 正常 exit 0 并写 `classification='error', failureSource='infra', passed:false` 的结构化结果——这是合同内正常路径,不是异常 |
| Why 5 | 为何未被现有机制捕获? | (a) feature-206 单测只构造了 passed:true/false/缺失 fixture,没有 classification='error' 的负例;(b) d99f93e 只堵了**生成侧** ConnectionRefused → run status='infra' 剔分母,**oracle 侧** infra 无对应口径;(c) 正确的三态映射 `classifyRunForRanking`(error→null 剔分母)在 classify-oracle.mjs 已存在,但 validate 未接线 |

**Root Cause**: validate 汇总层用二值 `passed` 读 oracle 结果而非三分类 `classification`,oracle 层的 infra error(仪器未真正执行)无处安放,落入 fail 分母污染 passRate。
**Root Cause Chain**: passRate 假 0 → success run 的 oracle 读成 false → oraclePassedFromFixture 只读 passed 布尔 → 未建模 classification='error' 第四态 → oracle 三分类合同(F187)中 error 是合同内路径 → 单测无 error 负例 + d99f93e 只覆盖生成侧 infra + 已有 classifyRunForRanking 未接线。
**[ROOT CAUSE REACHED at Why 5]**

## 影响范围扫描

### 同源问题(需同步修复)
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| scripts/eval-validate.mjs | L175-179 `readOraclePassed` | 读 oracle 只取 passed 二值 | 升级为四态 outcome 读取(pass/fail/infra/missing) |
| scripts/eval-validate.mjs | L100-138 `computeValidationStats` | success run 的 oracle 只有 true/false/null 三桶 | infra 判级 → 新桶 `n_oracle_infra`,剔 passRate 分母,计入 infraFailRate |
| scripts/eval-validate.mjs | L293/L297/L304/L309-326/L336 | 聚合调用 + fail-closed 日志 + 输出 JSON + 摘要行 | 接线新桶字段 |

### 类似模式(需评估)
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| scripts/eval-calibrate.mjs | L415-427 `oraclePassedFromFixture` / `readOraclePassed`(false-on-error) | calibrate 侧 error-classified fixture 同样经 Boolean 归 fail 分母 | **本次不改**:注释明示 false-on-error 是有意的保守口径;calibrate 有独立的 excludedRate abort 判据;评测 harness 改动克制原则。转 follow-up 候选 |
| scripts/lib/classify-oracle.mjs | L122-128 `classifyRunForRanking` | 已正确实现 error→null 剔分母 | **[安全]** 无需修复,且是本次修复语义的参照口径 |
| scripts/eval-offline-rejudge.mjs | L369-440 | 自带 classification/failureSource 分桶 | **[安全]** 独立消费链路,不经 computeValidationStats |

### 同步更新清单
- 调用方: `main()` 内 L293 聚合调用、L297/L304 fail-closed 错误信息、L309 输出 JSON、L336 摘要行
- 测试: tests/unit/feature-206-calibrated-harness.test.ts 新增三态(pass/candidate-fail/infra)+ legacy 兼容 + missing 分类单测
- 文档: 无需更新(eval harness 内部口径,注释内联说明)
- **不改动**: scripts/lib/classify-oracle.mjs(源码摘要纳入 oracleSpecHash 预注册校验,任何改动触发校验失败;本次也无需改)

## 修复策略

### 方案 A(推荐): validate 内新增四态 outcome 读取 + 新桶 n_oracle_infra
- eval-validate.mjs 新增导出 `readOracleOutcome(fixturePath)` 返回 `'pass'|'fail'|'infra'|'missing'`:
  - fixture 不可读 / 无 oracle 字段 → `'missing'`(现状 null 语义不变)
  - `primaryOracle.classification === 'error'` → `'infra'`(不论 failureSource 是 infra 还是 fixture——两者都是"仪器/夹具未真正评估候选",与 classifyRunForRanking 的 error→null 同口径)
  - classification `'pass'`/`'fail'` → 对应值
  - legacy oracle(无 classification 字段,如 `{kind,passed}` 或 swebenchResult fallback)→ 回退 `passed===true` 二值(向后兼容,行为与现状一致)
- `computeValidationStats` 的 success 分支按 outcome 分桶:`'infra'` → `n_oracle_infra`(剔分母 + 计入 infraFailRate 分子);其余桶语义不变
- 输出 JSON / fail-closed 错误信息 / 摘要行补 `n_oracle_infra`
- 修复后 take1 场景(3/3 oracle-infra)→ `n_valid=0` → 触发既有 W-4 fail-closed exit 2 "本轮无效",/goal 不再拿到假 0

### 方案 B(备选): 在共享的 oraclePassedFromFixture 里把 classification='error' 返 null
- 改动最小(一行),error 落入现有 n_oracle_missing 桶(同样剔分母 + fail-closed)
- 缺点:(1) "仪器 infra 假报"与"schema 回归找不到字段"混一桶,诊断信息丢失,报表看不出 venv 缺失这类问题;(2) 动了 calibrate 共享函数,虽经 Boolean(null)=false calibrate 行为不变,但口径注释需重写。不推荐

## Spec 影响
- 需要更新的 spec: 无需更新(F206 spec 的 FR-006 infra floor / W-4 fail-closed 语义不变,本修复是让 oracle 侧 infra 正确进入既有语义,不改合同)

## 设计阶段 codex 对抗审查处置(2026-07-11,0 CRITICAL / 4 WARNING / 4 INFO)

| 项 | 发现 | 处置 |
|----|------|------|
| W-1 | `classification='error'` 也可能 `failureSource='fixture'`(dataset mismatch / W1 mismatch,swebench-oracle.mjs:175-183),统称 n_oracle_infra 会把夹具错误误报成 infra | **采纳改名**:桶名 `n_oracle_error`(与 classification='error' 直接对应);剔分母语义不变(fixture 错也是"仪器未真正评估候选");补 failureSource='fixture' 用例 |
| W-2 | readOracleOutcome 只特判 error,`classification='unavailable'`(legacy,classify-oracle.mjs:126 明确剔分母)或未知漂移值且 passed:false 会计普通 fail | **采纳穷尽映射**:pass→true / fail→false / error→'oracle_error' 哨兵 / 其他已知外值(unavailable/未知)→null 剔分母;仅 classification 字段**不存在**才回退 passed===true(legacy {kind,passed}) |
| W-3 | eval-validate.mjs:296-305 先查 FR-006 floor 再查 W-4;3/3 oracle-error 场景 infraFailRate=1.0 先以 floor exit 2,不会走 W-4 文案 | **采纳修正预期**:take1 复现场景的 main 层出口是 FR-006 floor exit 2(错误信息含 oracle_error 计数);W-4 是后备(混合场景低于 floor 但 n_valid=0 时兜底)。两分支同 exit 2,行为等价,不调整检查顺序 |
| W-4 | 单测遗漏 failureSource='fixture'、unavailable/未知 classification、'oracle_error' 哨兵 truthy 误判防御 | **采纳**:单测清单 11 条扩至 15 条 |
| INFO-4 | parallel-run-pool.mjs:330-347 旧 `aggregatePassRate` 同样 truthy 判断但主路径未用 | 不动(死代码路径,复用时需同步适配;记录于此) |
