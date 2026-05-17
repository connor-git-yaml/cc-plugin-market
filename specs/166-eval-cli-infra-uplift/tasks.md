# 任务分解: Eval CLI Infrastructure Uplift

**Feature Branch**: `166-eval-cli-infra-uplift`
**Status**: Draft（已过 Phase 3 Codex 对抗审查 round 1：2 CRITICAL + 10 WARNING + 1 INFO 全修；等待 GATE_TASKS）
**关联 plan**: [plan.md](./plan.md)
**关联 spec**: [spec.md](./spec.md)

---

## 任务清单（顺序执行 + TDD 风格）

总计 **12 个任务**（含 T-003.5 dry-run 验证子步骤），分为 **2 个 commit**（implement commit + verify commit）。预估总工作时长 **4.5-5.5 小时**（不含真实 run 等待时间 ~15-25 min）。

### 阶段 1: 实现（implement commit）

#### T-001 [RED]: 新增 parser 单测文件 + ≥13 个测试用例（先写测试，TDD）

**目标**: 在 `tests/unit/parse-claude-stream-json.test.ts` 写 ≥13 个测试用例覆盖 FR-010 (a)-(m)，跑 vitest 应**测试文件加载失败或全部 FAIL**（parser 还没实现）。

**操作**:
1. 创建文件 `tests/unit/parse-claude-stream-json.test.ts`
2. 按 plan §2.3.4 表格写 13 个测试用例
3. 测试 import: `import { parseClaudeStreamJson } from '../../scripts/lib/parse-claude-stream-json.mjs';`
4. 测试 fixture 内联（避免新增 fixture 文件）
5. 验证：`npx vitest run tests/unit/parse-claude-stream-json.test.ts` 应**测试文件加载失败**（ERR_MODULE_NOT_FOUND）或全部 13 FAIL（如果 vitest 跑到了 it 块）。两种结果都接受作为 RED 状态（措辞 Codex W-005 修复）。

**依赖**: 无
**预计**: 60 min

---

#### T-002 [GREEN]: 实现 parse-claude-stream-json.mjs

**目标**: 在 `scripts/lib/parse-claude-stream-json.mjs` 实现 `parseClaudeStreamJson(stdout)` 函数（plan §2.3.2）。

**操作**:
1. 创建文件 `scripts/lib/parse-claude-stream-json.mjs`
2. 按 plan §2.3.2 代码草稿实现：
   - 空输入容错
   - 按 \n split + trim
   - 逐行 JSON.parse + try/catch
   - events 数组聚合
   - reasoningTrace 拼接（仅 assistant 事件 + text/thinking blocks，排除 redacted_thinking + tool_use）
   - malformedLineCount + totalLineCount 计数
3. ESM `export function` 风格，与 `scripts/lib/` 现有模块一致
4. 文件头注释中文说明 stream-json 格式 + 边界处理（EC-001 / EC-008 / EC-009 / EC-010）
5. 验证：`npx vitest run tests/unit/parse-claude-stream-json.test.ts` 应 13 PASS

**依赖**: T-001
**预计**: 45 min

---

#### T-003 [REFACTOR]: 改 eval-mcp-augmented.mjs (Step A+B+C 合并)

**目标**: 一次性完成 3 项 hardcode 改动 + runOne() cohort C 分支集成。

**操作**:

##### T-003.1 Step A: DEFAULT_TIMEOUT_MS
- 改 `scripts/eval-mcp-augmented.mjs:82`：
  ```diff
  - const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min hard ceiling，沿用 runner 默认
  + const DEFAULT_TIMEOUT_MS = 2_700_000; // 45 min hard ceiling（Feature 166 提升，缓解 Feature 165 §10.5.1 3/9 SIGTERM）
  ```
- 验证：`grep -n "1_800_000\|1800000" scripts/eval-mcp-augmented.mjs` 应无结果（除注释引用外）

##### T-003.2 Step B: model 升级
- 改 `scripts/eval-mcp-augmented.mjs:926`：
  ```diff
  - 'claude-sonnet-4-6',
  + 'claude-opus-4-7', // Feature 166 GATE_DESIGN C-001=A
  ```
- 验证：`grep -n "claude-sonnet-4-6\|sonnet-4-6" scripts/eval-mcp-augmented.mjs` 应无结果（除注释引用外）

##### T-003.3 Step C-1: output-format 切换 + --verbose
- 改 `scripts/eval-mcp-augmented.mjs:927-928`（plus 紧接其后 push `--verbose`）：
  ```diff
  - '--output-format',
  - 'text',
  + '--output-format',
  + 'stream-json', // Feature 166 Step C
  + '--verbose', // Feature 166：stream-json 完整 dump tool_use block 需 verbose（沿用 eval-task-runner.mjs:224 决策）
  ```
- 单测 mock fixture 验证 args 包含连续的 `['--output-format', 'stream-json', '--verbose']`

##### T-003.4 Step C-2: import parser + 集成到 runOne + realCostUsd 派生
- 在 eval-mcp-augmented.mjs 顶部 import：
  ```js
  import { parseClaudeStreamJson } from './lib/parse-claude-stream-json.mjs';
  ```
- 在 runOne() cohort C 分支（约 line 1331 后，consumption signals 提取前）添加：
  ```js
  // Feature 166 FR-011: 解析 stream-json driver events（cohort C 专用）
  let driverEvents = null;
  if (group === 'C') {
    driverEvents = parseClaudeStreamJson(runOutcome.stdout ?? '');
  }
  ```
- 修改 extractConsumptionSignals 调用（cohort C 分支，约 line 1363）：
  ```diff
    const signals = extractConsumptionSignals({
      changedSymbols,
      mcpToolCalls,
  -   stdout: runOutcome.stdout ?? '',
  +   stdout: driverEvents?.reasoningTrace ?? '', // Feature 166 FR-012
      patchText,
    });
  ```
- 替换 realCostUsd 派生（line 1399-1400，Codex C-010 修复）：
  ```diff
  - // 估算 cost：实跑暂置 null 待未来 LLM token usage 集成（FR-B-006）
  - const realCostUsd = null;
  + // Feature 166 FR-019：从 stream-json result event 提取 total_cost_usd（cohort C 专用）
  + let realCostUsd = null;
  + if (group === 'C' && driverEvents) {
  +   const resultEvent = driverEvents.events.find((e) => e?.type === 'result');
  +   if (resultEvent && typeof resultEvent.total_cost_usd === 'number') {
  +     realCostUsd = resultEvent.total_cost_usd;
  +   }
  + }
  ```
- 修改 runResult 返回（runOne 末尾）增加 `driverEvents` 字段：
  ```diff
    return {
      ...,
  +   driverEvents, // Feature 166 SC-004（cohort A/B 为 null）
    };
  ```

**依赖**: T-002
**预计**: 30 min

##### T-003.5 Step C-3: dry-run snapshot 验证（Codex W-004 修复）

- 检查 `tests/unit/eval-mcp-augmented-*.test.ts` 是否有 dry-run snapshot 断言：
  ```bash
  grep -rn "dryRun\|dry-run\|cmdPreview" tests/unit/eval-mcp-augmented* | head -10
  ```
- 如有 snapshot 包含 `--model claude-sonnet-4-6` / `--output-format text` 字面值 → 更新为新 args
- 如无现成 snapshot → 至少新增 1 个 dry-run 测试用例，断言 cmdPreview 数组中包含：
  - `--model claude-opus-4-7`
  - `--output-format stream-json`
  - `--verbose`
- dry-run cost 估算（`DRY_RUN_COST_PER_RUN_USD = 0.25`，line 81）保持不变还是升级？
  - **决策**：保持不变（dry-run 只是流程演练，不代表真实 cost）；如需精确预算预览可后续 Feature 跟进，本 Feature 不做（YAGNI）。

---

#### T-004 [TEST]: 新增 / 修改 buildClaudeArgsWithMcp 单测

**目标**: 在 `tests/unit/eval-mcp-augmented-classic.test.ts`（或新建 `eval-mcp-augmented-args.test.ts`）添加单测，验证 buildClaudeArgsWithMcp 返回 args 包含正确 model + output-format。

**操作**:
1. 检查现有 `tests/unit/eval-mcp-augmented-*.test.ts` 是否已有 buildClaudeArgsWithMcp 单测：
   - 有 → 修改断言为 `claude-opus-4-7` + `stream-json`
   - 无 → 新增至少 2 个用例：(a) 不带 mcpConfigPath、(b) 带 mcpConfigPath
2. 验证 args 包含连续的 `['--model', 'claude-opus-4-7']` 和 `['--output-format', 'stream-json']`
3. 验证 `--print` / `--permission-mode` / `--dangerously-skip-permissions` 沿用不变

**依赖**: T-003
**预计**: 20 min

---

#### T-005 [TEST]: 跑全量 vitest + build + repo:check（编排器独立验证 Phase 4.5）

**目标**: 验证零回归。

**操作**:
0. **记录基线**（Codex W-007 修复）：在本 Feature 改动前，先跑 `npx vitest run --reporter=summary 2>&1 | tail -5` 记录当前 master 的 PASS 数 + 总耗时（写入 verification-report.md §1）。本步骤只在 T-005 首次执行时跑（rebase 后或首次进入 verify）。
1. `npx vitest run` — 应**零失败**；新增 PASS 数 = ≥14（FR-010 的 13 个 parser 单测 + FR-005/FR-018 至少 1 个 buildClaudeArgsWithMcp 单测）；记录实测总耗时（estimated 5-15 min）
2. `npm run build` — 应零错误
3. `npm run repo:check` — 应零警告
4. 如有失败，记录在 `verification-report.md` 草稿并修复后重跑
5. 验证：所有命令 exit 0 + 输出零失败

**依赖**: T-004
**预计**: 5-15 min（依实际 vitest 套件大小）+ 重测时间（视 fail 数量）

---

#### T-006 [REVIEW]: Codex 对抗审查 Implement Phase

**目标**: 按 CLAUDE.local.md，commit 前必跑 Codex 对抗审查。

**操作**:
1. 启动 `codex:codex-rescue` agent
2. 传入：
   - 改动文件清单（git diff --stat）
   - eval-mcp-augmented.mjs 改动行 diff
   - 新 parser 文件全文
   - 单测文件全文
   - spec / plan 中关键 FR / EC 引用
3. 让 codex 从"找漏洞"视角输出 CRITICAL / WARNING / INFO 三档结论
4. 处置：
   - CRITICAL → 必修
   - WARNING → 评估后决定修 / 记录原因
   - INFO → 记录可选
5. 修复后重跑 T-005

**依赖**: T-005 PASS
**预计**: 30 min（含修复时间）

---

#### T-007 [COMMIT]: Phase 4 implement commit

**目标**: 合并 T-001..T-006 为 1 个 implement commit。

**操作**:
1. `git status` 确认改动：
   - `scripts/eval-mcp-augmented.mjs` (modified)
   - `scripts/lib/parse-claude-stream-json.mjs` (new)
   - `tests/unit/parse-claude-stream-json.test.ts` (new)
   - `tests/unit/eval-mcp-augmented-*.test.ts` (modified, if any)
2. `git add` 上述文件
3. commit message:
   ```
   feat(166): Step A+B+C 实现 — eval CLI infra uplift

   3 项 CLI infrastructure 改动 + stream-json parser 新增 + runOne cohort C 集成：

   - DEFAULT_TIMEOUT_MS 30 min → 45 min (scripts/eval-mcp-augmented.mjs:82)
   - Driver 模型 sonnet-4-6 → opus-4-7 (line 926, GATE_DESIGN C-001=A)
   - --output-format text → stream-json (line 927-928)
   - 新增 scripts/lib/parse-claude-stream-json.mjs (NDJSON 流式按行解析)
   - runOne() cohort C 分支注入 driverEvents 字段
   - extractConsumptionSignals 用 reasoningTrace 替代 stdout

   单测：
   - tests/unit/parse-claude-stream-json.test.ts 新增 ≥13 用例（(a)-(m)）
   - tests/unit/eval-mcp-augmented-*.test.ts buildClaudeArgsWithMcp 断言更新

   验证：
   - npx vitest run 零失败
   - npm run build 零错误
   - npm run repo:check 零警告

   Codex implement phase 对抗审查：N CRITICAL + N WARNING + N INFO（修复 / 记录）

   关联：specs/166-eval-cli-infra-uplift/{spec,plan,tasks}.md
   ```

**依赖**: T-006 PASS
**预计**: 10 min

---

### 阶段 2: 验证（verify commit）

#### T-008 [PREFLIGHT]: opus-4-7 preflight check（FR-017 + Codex W-008 修复）

**目标**: 真实 run 前验证 opus-4-7 可用 + stream-json + verbose 输出格式正确。

**操作**:
1. **基础可用性检查**（FR-017）：
   ```bash
   claude --print --model claude-opus-4-7 --max-turns 1 --output-format text "ok" 2>&1
   ```
   成功（exit 0 + 收到 assistant 文本）→ 进入步骤 2
2. **stream-json + verbose 输出格式检查**（W-008 修复）：
   ```bash
   claude --print --model claude-opus-4-7 --max-turns 1 --output-format stream-json --verbose "say hi briefly" 2>&1 | head -20
   ```
   验证 stdout 每行为合法 JSON object（含 `type: 'system'` / `type: 'assistant'` / `type: 'result'` 至少 3 类）：
   ```bash
   head -20 | jq '.type' | sort -u
   ```
   若仅含 result 1 类 → stream-json 输出退化，必须 fix（W-003 加 --verbose 已经处理；如仍不行需进一步调查）
3. 失败处理（任一步骤 fail）→ 按 EC-012：
   - 暂停并向用户报告
   - 用户决策：(a) 等 quota 恢复后重跑、(b) 改回 sonnet-4-6 重 implement（回退）、(c) 跳过 SC-005 + SC-008 验证（视为本 Feature 部分交付）

**依赖**: T-007 COMMIT
**预计**: 2 min

---

#### T-009 [VERIFY]: 跑 1 个真实 cohort C run（FR-013 / SC-005 / Codex C-009 修复）

**目标**: 端到端验证 stream-json 解析 + reasoning trace 捕获 + cost 控制。

**任务候选（Codex C-009 修复，必须选 changedSymbols 非空的 task）**：

依据 specs/147 §10.5.1 实测数据：

| Task ID | Repo | changedSymbols | T053 通过率 | 优先级 |
|---------|------|---------------|------------|--------|
| **SWE-L001** | pytest | **70** | 3/3 = 100% | **首选**（最大 changedSymbols，最能验证 reasoning-trace-mention 增多） |
| **SWE-L005** | astropy | **38** | 3/3 = 100% | 备选（如 SWE-L001 跑出问题或 quota 不够） |
| ~~SWE-L003~~ | pytest | ~~0 (payload-empty)~~ | ~~fail (EC-007)~~ | **禁止选**（changedSymbols=0 无法验证 reasoning-trace 命中） |

**操作**:
1. 选 SWE-L001（首选）：
   ```bash
   node scripts/eval-mcp-augmented.mjs \
     --group C \
     --task SWE-L001 \
     --repeat 1 \
     --keep-temp
   ```
2. 检查输出 fixture `tests/baseline/swe-bench-lite/runs/C/SWE-L001/run-1.json`：
   - `driverEvents.events.length > 0` ✅
   - `driverEvents.reasoningTrace.length > 0` ✅
   - `driverEvents.malformedLineCount / driverEvents.totalLineCount < 0.05` ✅
   - `runResult.costUsd != null` ✅（FR-019 修复 — 从 result event 派生，不再是 null）
   - `runResult.costUsd <= 1.5` ✅
   - `runOutcome.timedOut === false` ✅
   - `runOutcome.exitCode === 0` ✅
   - `consumptionSignals.length > 0`（对照 165 §10.5.1 SWE-L001 baseline 2-4 个 signals，本次应 ≥ 2 个，理想情况下比 baseline 多因 reasoning trace 完整）
3. 检查 stdout 中 stream-json 格式（grep 验证）：
   ```bash
   # 假设 run-1.json 含 subAgentStdout 或单独保存 stdout 文件
   head -5 <stdout 文件> | jq '.type' | sort -u
   ```
4. 若 stdout 退化（仅有 system + result 2 类事件，意味着 --verbose 未生效）→ 重新审视 buildClaudeArgsWithMcp 是否正确包含 `--verbose`；修复后重 T-005..T-007

**依赖**: T-008 PASS
**预计**: 15-25 min（含真实 run 等待时间）

---

#### T-010 [REPORT]: 撰写 verification-report.md（FR-013 / SC-005 / SC-008）

**目标**: 在 `specs/166-eval-cli-infra-uplift/verification/verification-report.md` 撰写验证报告。

**操作**:
1. 创建 `specs/166-eval-cli-infra-uplift/verification/verification-report.md`
2. 章节结构：
   - **§1. 单测验证**：vitest PASS 数 / build / repo:check 输出摘要
   - **§2. preflight check 结果**：opus-4-7 可用性确认
   - **§3. 真实 cohort C run 结果**：
     - 任务 ID / 实际 cost / wallMs / exit code
     - driverEvents.events 数量 + 各 type 分布
     - reasoningTrace 长度 + 摘录（前 500 字符）
     - malformedLineCount / totalLineCount 比例
     - consumptionSignals 数量（对比 165 §10.5.1 同任务结果，看是否改善）
   - **§4. SC 对照检查表**：SC-001 到 SC-008 逐项 PASS/FAIL/N-A
   - **§5. Codex review 历史**：列出 specify + implement + verify 三阶段 review 结论汇总
   - **§6. 结论与建议**：是否准许进入 push 阶段、T052 全量 450 runs 启动建议

**依赖**: T-009 PASS
**预计**: 30 min

---

#### T-011 [REVIEW]: Codex 对抗审查 Verify Phase

**目标**: commit verification-report.md 前的最后一次对抗审查。

**操作**:
1. 启动 `codex:codex-rescue` agent
2. 传入 verification-report.md 全文 + 真实 run fixture 摘要
3. 让 codex 审查：
   - 报告 over-claim 风险（如 SC-005 cost 估算是否准确）
   - SC 对照检查是否漏项
   - 是否有未发现的回归
   - 是否有 T052 启动建议被夸大
4. 处置：CRITICAL 必修，WARNING 记录

**依赖**: T-010
**预计**: 20 min（含修复）

---

#### T-012 [COMMIT]: Phase 5 verify commit

**目标**: commit verification-report.md。

**操作**:
1. `git add specs/166-eval-cli-infra-uplift/verification/verification-report.md`
2. **不入库** `tests/baseline/swe-bench-lite/runs/` 下的 fixture（按 CLAUDE.local.md，跑测评结果不 commit）
3. commit message:
   ```
   docs(166): Phase 5 verify — 1 真实 cohort C run 端到端验证

   验证结果（详见 verification-report.md）：
   - 单测 ≥14 新增 PASS，全量 vitest 零失败
   - npm run build 零错误，npm run repo:check 零警告
   - opus-4-7 preflight PASS
   - 真实 cohort C run（<taskId>）：cost $X / driverEvents.events=N / reasoningTrace=M chars / malformedRate=Y%
   - SC-001 到 SC-008 全部 PASS（或部分 PASS + 标注理由）

   Codex verify phase 对抗审查：N CRITICAL + N WARNING + N INFO

   T052 全量 450 runs 启动建议：<PASS / 部分 PASS + 后续 follow-up>
   ```

**依赖**: T-011 PASS
**预计**: 5 min

---

## 任务依赖图

```
T-001 (RED 单测) ─┐
                 ├─→ T-002 (GREEN parser) ─→ T-003 (改 eval) ─→ T-004 (buildArgs 单测) ─→ T-005 (全量验证) ─→ T-006 (Codex review) ─→ T-007 (commit)
                 │                                                                                                                       │
                 └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                                                                          │
                                                                                                                                          ▼
                                                                                                                       T-008 (preflight) ─→ T-009 (真实 run) ─→ T-010 (report) ─→ T-011 (Codex review) ─→ T-012 (commit)
```

---

## 验收清单（DoD）

实施完成时必须达到：

- [ ] T-001..T-007 全部完成（implement commit 落地）
- [ ] T-008..T-012 全部完成（verify commit 落地）
- [ ] `npx vitest run` 零失败（基线由实际跑出来决定）
- [ ] `npm run build` 零错误
- [ ] `npm run repo:check` 零警告
- [ ] verification-report.md 8 个 SC 全部 PASS（或部分 PASS + 标注理由）
- [ ] 每个 phase commit 前都跑过 Codex 对抗审查（specify / plan+tasks / implement / verify 共 4 次；plan+tasks 合并 1 次 review 见 plan §6）
- [ ] **rebase 时机**（Codex W-012 修复）：
  - T-007 implement commit 前 `git fetch origin master && git rebase origin/master`；若 master 有改 eval-mcp-augmented.mjs 必须重跑 T-005..T-007
  - T-012 verify commit 前再 rebase 一次；若 master 有变需重跑 T-005（不需要重跑真实 run T-009）
  - push 前最后再 rebase 确认线性历史

---

## 风险触发回退路径（含 Codex W-011 阈值定义）

| 触发条件 | 回退动作 |
|---------|---------|
| T-008 preflight FAIL（opus-4-7 不可用） | 暂停 + 用户决策 EC-012 选项（重试 / 改 sonnet / 部分交付） |
| T-009 真实 run cost > $1.5 | EC-006 视为 SC-005 FAIL；verify-report 标注实际 cost；用户决策是否接受 |
| T-009 真实 run SIGTERM（45 min 仍不够） | 视为 EC-004；记录 driverEvents 已捕获的数据；按 partial success 处理 |
| T-009 stream-json 格式退化（仅 system + result） | 重新审视 `--verbose` 是否正确加入（已硬决策加，理论不该退化）；如确认 args 正确仍退化 → 排查 CLI 版本兼容性 |
| Codex CRITICAL **第 3 轮**仍未收敛 | **强制暂停** + 用户决策是否降级到部分交付。规则：每 phase 最多 2 轮 round-trip（round 1 review + round 1 fix + round 2 review + round 2 fix），第 3 轮 review 若仍 CRITICAL 必须停 |
| Codex WARNING **第 2 轮**仍未收敛 | 在 commit message 标注原因不修复；不强制暂停 |

---

## 工作量估算

| 阶段 | 任务 | 预计时长 |
|------|------|---------|
| 单测 RED | T-001 | 60 min |
| GREEN 实现 | T-002 + T-003 + T-004 | 95 min |
| 编排器验证 | T-005 | 5-15 min |
| Codex review (implement) | T-006 | 30 min |
| implement commit | T-007 | 10 min |
| preflight + real run | T-008 + T-009 | 16-26 min |
| report 撰写 | T-010 | 30 min |
| Codex review (verify) | T-011 | 20 min |
| verify commit | T-012 | 5 min |
| **合计** | | **271-291 min ≈ 4.5-5 小时** |

预算预期 ~ $1.5（真实 cohort C run cost，按 GATE_DESIGN 决策 A）+ 少量 LLM agent cost（Codex review 调用）。
