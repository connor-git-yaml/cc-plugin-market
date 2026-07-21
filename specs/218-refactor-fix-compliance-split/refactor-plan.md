# 重构计划 — F218 fix-compliance-core 拆分（变体 C，单向无环）

## 概要
- 总批次: **2**（串行，批间可独立中间验证）
- 总影响文件: 3 改动 + 1 新建（judge.mjs / io.mjs / 三测试 import 面零改动，不计入改动）
- 依赖方向: **core → execution-record 单向无环**（新模块不 import core 任何符号）
- 兼容策略: core 全量 re-export 转发（12 符号），toSingleMatchProbe 除外

## 目标文件版图

| 文件 | 角色 | 变化 |
|------|------|------|
| `plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs` | 新建 | 承载迁移体 + toSingleMatchProbe |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 改造 | 删迁移体 + import back + re-export + 调用点改写 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 消费者 | **零改动**（靠 re-export） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | 消费者 | **零改动** |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 消费者 | **零改动**（静态+动态 import 均经 re-export 解析） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | 消费者 | **零改动** |
| `plugins/spec-driver/tests/fix-compliance-io.test.mjs` | 间接消费者 | **零改动** |

---

## 批次清单

### Batch 1: 迁移体搬移 + core re-export 转发

**依赖**: 无（起始批）

**新建 `fix-compliance-execution-record.mjs`**（分区注释，两段）：

- 模块头 JSDoc：声明"零 I/O 纯函数 + 零 core import（单向依赖底层）"。
- 分区 A『共享 fix-report 解析原语』：
  - `computeFenceMask`（原 core:315-344，JSDoc 原样带走）
  - `NOOP_JUDGMENT_HEADING_REGEX`（原 core:44-45）
  - `NOOP_RECON_HEADING_REGEX`（原 core:473-474）
  - （toSingleMatchProbe 占位，Batch 2 落地）
- 分区 B『执行记录证据门』（逐函数等价搬移，JSDoc/注释原样）：
  - `SENTINEL_PASS` / `SENTINEL_FAIL` / `EXECUTION_OUTPUT_SUMMARY_LIMIT`（原 core:555-558）
  - `flattenToolResultContent`（原 core:102-126）
  - `normalizeCommandConservative`（原 core:476-487）
  - `parseNoopReconLines`（原 core:489-548）
  - `deriveAssertionStatus`（原 core:560-584）
  - `extractExecutionRecordsAfter`（原 core:586-659）
  - `classifyReproEvidence`（原 core:661-699）

**改造 `fix-compliance-core.mjs`**：
1. 删除上述 6 函数 + 4 F216 常量 + computeFenceMask + NOOP_JUDGMENT_HEADING_REGEX 的定义体（约 -285 行）。
2. 顶部新增 import（供留守函数使用）：
   ```
   import {
     flattenToolResultContent,        // normalizeTranscriptEntry:166
     computeFenceMask,                // extractSectionBody:360 / stripReconSubblock:397 / classifyClosureForm:451
     NOOP_JUDGMENT_HEADING_REGEX,     // classifyClosureForm:452 / judgeCompliance:749
     NOOP_RECON_HEADING_REGEX,        // stripReconSubblock:401
     parseNoopReconLines,             // judgeCompliance:778
     classifyReproEvidence,           // judgeCompliance:777
   } from './fix-compliance-execution-record.mjs';
   ```
3. 尾部统一 re-export 块（12 符号，保 import 面）：
   ```
   export {
     flattenToolResultContent, deriveAssertionStatus, extractExecutionRecordsAfter,
     normalizeCommandConservative, parseNoopReconLines, classifyReproEvidence,
     SENTINEL_PASS, SENTINEL_FAIL, EXECUTION_OUTPUT_SUMMARY_LIMIT,
     NOOP_RECON_HEADING_REGEX, computeFenceMask, NOOP_JUDGMENT_HEADING_REGEX,
   } from './fix-compliance-execution-record.mjs';
   ```
   注：`toSingleMatchProbe` **不**在此列（新符号无兼容约束）。

**行数预估**: execution-record ≈ 300；core 819 − 285（删）+ 8（import）+ 14（re-export）≈ **556**。

**中间验证**:
```
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs \
             plugins/spec-driver/tests/fix-compliance-io.test.mjs \
             plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
grep -c "from './fix-compliance-core.mjs'" plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs   # 必须为 0（单向无环验收断言）
```

**回滚**:
```
git checkout -- plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
git rm -f plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs   # 或 rm 未跟踪新文件
```

---

### Batch 2: toSingleMatchProbe DRY helper 落地 + 6 调用点改写

**依赖**: Batch 1（新模块已存在、原语区就位）

**改动**:
1. `fix-compliance-execution-record.mjs` 分区 A 新增并 `export`：
   ```
   /** 把带 /g 的正则转成单次匹配探针（去 g 标志，保留 source 与其余 flags） */
   export function toSingleMatchProbe(re) {
     return new RegExp(re.source, re.flags.replace('g', ''));
   }
   ```
2. `fix-compliance-core.mjs`：import 追加 `toSingleMatchProbe`（**不** re-export），改写 5 处留守调用点：
   - extractSectionBody:361（requiredHeading）
   - extractSectionBody:375（requiredHeading）
   - checkArtifactSection:421（requiredHeading）
   - classifyClosureForm:452（NOOP_JUDGMENT_HEADING_REGEX）
   - classifyClosureForm:453（ROOT_CAUSE_HEADING_REGEX）
3. `fix-compliance-execution-record.mjs`：改写 parseNoopReconLines 内 1 处（原 core:506，NOOP_JUDGMENT_HEADING_REGEX）。

**行数预估**: helper +4；6 调用点各由 `new RegExp(x.source, x.flags.replace('g',''))` → `toSingleMatchProbe(x)`，净约 −4。core 落点 ≈ **552**；execution-record ≈ **304**。

**中间验证**:
```
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs \
             plugins/spec-driver/tests/fix-compliance-io.test.mjs \
             plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
grep -rn "flags.replace('g'" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs \
        plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
# 期望：仅 execution-record 内 toSingleMatchProbe 定义 1 处命中；core 归零
```

**回滚**:
```
git checkout -- plugins/spec-driver/scripts/lib/fix-compliance-core.mjs \
                plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
```

---

## 迁移不变量（behavior-preserving 断言）

1. **函数体逐字等价**：除 (a) import 路径、(b) Batch 2 的 `new RegExp(...)` → `toSingleMatchProbe(...)` 改写外，迁移函数零逻辑改动；JSDoc/内联注释原样搬走。
2. **导出面 diff 为空**（新旧 core 对外导出集合完全一致，含 re-export）：
   ```
   OLD=$(mktemp -d); git show HEAD:plugins/spec-driver/scripts/lib/fix-compliance-core.mjs > "$OLD/core-old.mjs"
   # 旧版是自包含单文件，可直接 import；新版依赖同目录 execution-record，故用工作树内新 core 对比
   node -e '
     const A = await import(process.argv[1]);            // 旧 core（临时副本，无依赖）
     const B = await import(process.argv[2]);            // 新 core（工作树）
     const ka = Object.keys(A).sort(), kb = Object.keys(B).sort();
     const only = (x,y)=>x.filter(k=>!y.includes(k));
     console.log("旧独有:", only(ka,kb));  // 期望 []
     console.log("新独有:", only(kb,ka));  // 期望 []  ← toSingleMatchProbe 不经 core 导出，不应出现
   ' "$OLD/core-old.mjs" "$PWD/plugins/spec-driver/scripts/lib/fix-compliance-core.mjs"
   ```
   期望：两差集均为 `[]`。（注：旧 core 是自包含单文件，复制到临时目录可独立 import；对比证明拆分后 core 对外导出面零漂移。）
3. **单向无环**：`grep -c "from './fix-compliance-core.mjs'" execution-record.mjs` == 0。
4. **测试 import 面零改动**：judge.mjs / io.mjs / 三测试文件 `git diff --stat` 中不出现（本次不触碰）。

---

## 最终版图

**core 落点行数计算**：819（现）− 285（迁移体：flatten 25 + computeFenceMask 34 + normalizeCmd 12 + parseNoopRecon 60 + deriveAssertion 25 + extractExecRecords 74 + classifyRepro 39 + SENTINEL/LIMIT 9 + NOOP_RECON 5 + NOOP_JUDGMENT 2）+ 8（import back）+ 14（re-export）− 4（Batch2 调用点净收缩）≈ **552 行**（<600 监控线；较 plan ~500 目标略高，因 re-export/import-back 固定开销）。

**execution-record 行数**：迁移体 285 + toSingleMatchProbe 4 + 模块头/分区注释 ~15 ≈ **304 行**。

**依赖方向图**：
```
io.mjs ─┐
judge.mjs ─┼─▶ fix-compliance-core.mjs ─▶ fix-compliance-execution-record.mjs   （单向，无回边）
tests ──┘        （re-export 转发 12 符号）        （零 core import）
```

---

## 全局验证命令清单（Phase 5）
```
node --test plugins/spec-driver/tests/          # fix-compliance 全测 + 邻测零失败
npm run test:plugins                            # 插件测试套件
npm run repo:check                              # 仓库级同步/合约校验
```
补充断言：
```
grep -c "from './fix-compliance-core.mjs'" plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs   # == 0
grep -rn "flags.replace('g'" plugins/spec-driver/scripts/lib/fix-compliance-{core,execution-record}.mjs          # 仅 1 处（helper 定义）
wc -l plugins/spec-driver/scripts/lib/fix-compliance-{core,execution-record}.mjs                                  # core<600
```
