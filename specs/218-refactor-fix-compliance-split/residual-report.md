# 残留扫描报告 — F218 fix-compliance-core 拆分

## 扫描时间点
Phase 4（Batch 1 + Batch 2 完成后，最终验证前），由编排器亲自执行。

## 扫描项与结果

### 1. core 内迁移符号定义体残留（期望零）
```
grep -nE "^(export )?(function|const) (flatten…|derive…|extract…|normalize…|parseNoop…|classifyRepro…|computeFenceMask|SENTINEL_*|EXECUTION_OUTPUT_SUMMARY_LIMIT|NOOP_*_REGEX|toSingleMatchProbe)" fix-compliance-core.mjs
```
结果：**0 残留** ✅（core 仅保留顶部 import back 与尾部 re-export 转发，无本地定义体）

### 2. "正则去 g 标志探针"模式残留（期望仅 helper 定义 1 处）
```
grep -rn "flags.replace('g'" fix-compliance-{core,execution-record}.mjs
```
结果：仅 `fix-compliance-execution-record.mjs:64`（toSingleMatchProbe 定义体自身）✅；core 归零，6 处调用点（core 5 + execution-record 1）全部改写为 `toSingleMatchProbe(x)`

### 3. 单向无环断言（期望新模块零 core import）
```
grep -c "from './fix-compliance-core.mjs'" fix-compliance-execution-record.mjs
```
结果：**0** ✅（依赖方向 io/judge/tests → core → execution-record，无回边）

### 4. 仓库级引用扫描（含 wrapper / hooks / 配置面）
`grep -rln "fix-compliance-core|fix-compliance-execution-record"`（*.mjs/*.sh/*.json/*.yaml，排除 node_modules 与 specs 文档性提及）：
- 命中仅预期 6 文件：judge.mjs / io.mjs / core.test.mjs / judge-cli.test.mjs / core 本体 / execution-record 本体 ✅
- 无 `.codex-plugin` / dist / wrapper 镜像按名引用该 lib 文件（wrapper sync 链路由 repo:check 在 Phase 5 复核）

### 5. 迁移体逐字等价机械验证（fn.toString() 对比旧 819 行版）
| 符号 | 结论 |
|------|------|
| flattenToolResultContent / deriveAssertionStatus / extractExecutionRecordsAfter / normalizeCommandConservative / classifyReproEvidence / computeFenceMask | **逐字等价** ✅ |
| parseNoopReconLines | 仅 1 行差异 = Batch 2 授权的探针改写（`new RegExp(...flags.replace('g',''))` → `toSingleMatchProbe(...)`）✅ |
| SENTINEL_PASS / SENTINEL_FAIL / EXECUTION_OUTPUT_SUMMARY_LIMIT | 值等价 ✅ |
| NOOP_RECON_HEADING_REGEX / NOOP_JUDGMENT_HEADING_REGEX | source+flags 等价 ✅ |

### 6. 导出面 diff（新旧 core Object.keys 差集）
结果：旧独有 `[]`，新独有 `[]` ✅（toSingleMatchProbe 未经 core 导出，符合裁决）

### 7. 消费者文件零改动断言
`git diff --stat`：仅 `fix-compliance-core.mjs`（+40/−299）；judge.mjs / io.mjs / 三测试文件**未出现在改动集** ✅

## 行数落点
| 文件 | 拆分前 | 拆分后 |
|------|--------|--------|
| fix-compliance-core.mjs | 819 | **560**（<600 监控线；较任务 ~500 目标高 ~60 行，差额 = import back 9 行 + re-export 块 13 行 + 指针注释的固定开销） |
| fix-compliance-execution-record.mjs | — | **316** |

## 结论
**残留数 0**，全部 7 项扫描通过，可进入 Phase 5 最终验证。
