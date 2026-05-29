# Tasks: Feature 170d — Driver Preference Shaping

**输入**: [spec.md](spec.md) + [plan.md](plan.md) | **基线 commit**: d8bce07
**TDD 强制**: RED（测试先失败）→ GREEN（实现转绿）→ REFACTOR（可选）。每 commit 前跑 codex 对抗审查。

## 关键契约（前置共识，避免 GREEN 横跳 — 响应 codex C-3/W-2）

- **anchor 契约**：`<!-- preference-rules:<ruleId> tool=<toolKey> -->`，其中 `ruleId ∈ {R1,R2,R3,R4}`（**身份**），`toolKey ∈ {impact,context,detect_changes}`（**过滤键**）。R1、R2 同为 `tool=impact`。
  - **过滤**：agent 命中某 toolKey（其 frontmatter tools 含对应 `mcp__plugin_spectra_spectra__<toolKey>`）→ 纳入该 toolKey 的**所有** ruleId 行。
  - **比对/去重**：一律按 `ruleId`，**禁止**按 toolKey 建 map（否则 R1/R2 互相覆盖 → false pass）。
- **namespace**：template 行内 + agent 块 + harness 注入块 + harness allowedTools 一律 production `mcp__plugin_spectra_spectra__*`。
- **沙箱纯函数边界**：sandbox 测（T001/T002）只测纯函数 + 静态文件解析，**不依赖** `dist/cli/index.js` / `specs/_meta/graph.json`（二者沙箱不存在，仅 host 实测需要）。

## 任务依赖图

```
RED:    T001(core+harness 纯函数单测 over stubs) ─ T002(静态测) ─ T003(e2e 占位)
GREEN:  T010(template) → T011(core 渲染/解析 + sync 脚本) → T012(5 agent --write) → T013(5 SKILL)
        T011 → T014(driver-eval-core 全量) → T015(170d harness wrapper)
        T016(docs §七)  T017(.gitignore)  T018(repo:check 接入 sync --check)
                          ↓ 全部 GREEN（sandbox 测转绿）
        T020(repo:check/build/vitest 零回归 → static-pass)
HOST:   T030(build+batch preflight → US2 实测) ─ T031(US3) ─ T032(US4) ─ T033(neg-control)
REFACTOR: T040(可选：renderBlock 去重)
VERIFY: T050(verification-report)
```

---

## RED Phase（commit 1：`test(170d): core+harness 纯函数 + 静态 scaffolding — RED`）

> **RED 形态（响应 codex W-1）**：为得到「断言失败的红」而非「collect error 崩溃」，RED commit 同时建**抛错 stub**：`scripts/lib/driver-eval-core.mjs` 与 `scripts/feature-170d-driver-preference.mjs` 先导出所有目标函数但 body `throw new Error('RED: not implemented')`。静态测对不存在的 template/marker 用**断言式失败**（`expect(fs.existsSync(...)).toBe(true)` 等），不直接抛。

### T001 — core + harness 纯函数单测 [可测]
**文件**: `tests/unit/spec-driver/feature-170d-harness.test.ts`
- 针对 `scripts/lib/driver-eval-core.mjs` stub：
  - `parseToolEvents(stdout)`：合成 stream-json（impact tool_use + tool_result + Grep tool_use）→ 断言有序事件含 name/id/isError/payload
  - `computeMetrics(events)`：三层指标（attempt/resolved/fallbackAfterFailure）+ Active Call 4 规则 + Grep 计数；fixture 覆盖：成功 impact / impact error envelope / impact 失败后 Grep / 纯 Grep / 重复 impact 去重（按 target）
  - `wilsonCI(5,10)` 数值断言
  - `renderInjectionBlock(templateText, agentTools)`（**纯函数**，入参 template 文本 + tools 数组 — 响应 codex C-2）：传 implement 的 tools → 断言含 R1+R2+R3 行、production namespace、**不含** detect_changes、**不含**任何 `::` target 字面量；按 ruleId 断言不被 tool collide（C-3）
- **US2 sandbox 代理测（响应 codex C-4）**：针对 `scripts/feature-170d-driver-preference.mjs` stub 导出的 args/config builder：
  - `buildClaudeArgs(wtDir)` → 断言含 `--append-system-prompt`、allowedTools 为 production namespace 三件套 + Read/Grep/Glob
  - `buildMcpConfig(wtDir)` → 断言 server key = `plugin_spectra_spectra`
  - `assertInjectionSubsetOfAllowed(block, allowedTools)` → 注入块工具 ⊆ allowedTools，否则 throw
  - `isCliEntry` guard helper → 断言用 `process.argv[1]?.endsWith(...)` 形态可被单测验证（修 codex C-1）
- **RED**：stub throw / 断言失败

### T002 — 静态结构测 [可测]
**文件**: `tests/unit/spec-driver/feature-170d-preference-rules.test.ts`
- **SC-001**：解析 5 agent，断言含 BEGIN/END marker 块 + anchor 短语「优先调用 spectra MCP 工具」 + 按 US1 矩阵 R 行（plan/implement/spec-review/quality-review = R1/R2/R3；verify = R1/R2/R4）+ 关键原则小节
- **SC-006**：每 agent 块的 R 行（按 **ruleId** 比对）== `templates/preference-rules.md` 对应 anchor 段文本；块内 `mcp__plugin_spectra_spectra__\w+` ⊆ 该 agent frontmatter tools；块内无 `::`（无 target 泄漏）
- **SC-005（强化，响应 codex W-6）**：解析 5 SKILL.md，断言「子代理调度时的工具优先级提示」块 (a) 存在 (b) 位于「委派子代理 / 上下文注入」说明**之前或紧邻** (c) 引用 template 路径 `templates/preference-rules.md` (d) 含「优先使用 mcp__plugin_spectra_spectra」语义
- **SC-008 机械化守护（响应 codex I-2）**：快照断言 5 agent frontmatter `tools:` 行 == 冻结期望值（防被 sync 脚本误改）；断言 agent-context-tools tool description 文件未被本 feature 触及（git 层面由 T020 diff 复核）
- **RED**：marker/template 未建 → 断言失败

### T003 — host-only e2e 占位 [host]
**文件**: `tests/e2e/feature-170d-driver-preference.e2e.test.ts`
- `describe.skip` 三块：US2 / US3 / US4，含实施指引注释（host shell 去 skip）
- skip 不计入 RED（命中 `tests/e2e/**/*.e2e.test.ts` glob，确认存在即可）

**RED 验收**: `npx vitest run --project unit tests/unit/spec-driver/` → T001/T002 全红（断言失败）；T003 skip。

---

## GREEN Phase（commit 2：`feat(170d): driver preference shaping — GREEN`）

### T010 — 单一事实源 template [核心]
**文件**: `plugins/spec-driver/templates/preference-rules.md`（新增）
- 按 plan 决策 1 + anchor 契约：表头 + R1-R4 行（`<!-- preference-rules:Rn tool=xxx -->`，行内 production namespace）+ `### 关键原则`（4 条）
- 不含任何具体 symbol / `::`

### T011 — driver-eval-core 渲染/解析 + sync 脚本（含单测边界）[核心]
**文件**: `plugins/spec-driver/scripts/sync-preference-rules.mjs`（新增 755）
- `parseTemplate(text)` → ruleId→{tool, rowText} map + 关键原则段；`renderBlockForAgent(templateText, agentTools)` 复用 core 的 `renderInjectionBlock`（**单一渲染逻辑**，避免两份）
- `parseFrontmatterTools(agentText)` → 正则提取 `mcp__plugin_spectra_spectra__\w+`，失败报错退出（不静默）
- `--write`：插入锚点「`## 角色` 段后、下个 `##` 前」（首插）或 marker 内替换（更新）；BEGIN/END marker
- `--check`：重生成与磁盘逐字对比，drift → 非零退出 + diff 摘要
- **边界（响应 codex W-2）**：本任务负责 parse/render/check 逻辑**正确性**（T001 已覆盖 renderInjectionBlock）；T012 仅负责跑 `--write` 产物

### T012 — 5 agent 嵌入规则块 [核心]
- 跑 `node plugins/spec-driver/scripts/sync-preference-rules.mjs --write`
- 产物：plan/implement/spec-review/quality-review = R1/R2/R3；verify = R1/R2/R4
- 不动 frontmatter tools（SC-008）；T002 校验产物正确性

### T013 — 5 SKILL.md 调度提示块 [核心]
**文件**（**canonical 路径，响应 codex W-5**）: `plugins/spec-driver/skills/{spec-driver-feature,spec-driver-story,spec-driver-fix,spec-driver-refactor,spec-driver-implement}/SKILL.md`
- 在各自「委派子代理 / 上下文注入块」前置说明处加「## 子代理调度时的工具优先级提示」块（FR-004 文案），引用 template 路径 `plugins/spec-driver/templates/preference-rules.md` + 关键原则
- **改完跑 `npm run repo:sync`** 同步到 wrapper/mirror 层（不直接编辑 root `skills/`）；T020 跑 `repo:check` 复核

### T014 — driver-eval-core 全量实现 [核心]
**文件**: `scripts/lib/driver-eval-core.mjs`（新增，纯函数，无顶层副作用）
- 导出：`TASKS` / `NEGATIVE_CONTROL_TASKS`（3 个 non-caller-analysis）/ `FORBIDDEN_LITERALS` / `validatePrompts` / `parseToolEvents` / `computeMetrics` / `wilsonCI` / `resolveTargetInGraph` / `renderInjectionBlock`
- 逻辑从 170c 逐函数迁移 + 扩展通用事件模型；转绿 T001 core 部分

### T015 — 170d harness（薄 wrapper）[核心/host]
**文件**: `scripts/feature-170d-driver-preference.mjs`（新增）
- import core；`buildInjectionBlock(agent)`（**读 template 文件的 wrapper**，调 `renderInjectionBlock` — 修 codex C-2）
- `buildMcpConfig` server key=`plugin_spectra_spectra`；`buildClaudeArgs` allowedTools production 名 + `--append-system-prompt`
- preflight：`claude --version` 记录 + flag 探测 + 注入块 sha256 + `assertInjectionSubsetOfAllowed`；空块/不支持 → exit 2
- 迁移 setup（**响应 codex W-4**）：dist 存在检查 + `ensureGraphAndValidateTargets`（spectra batch 生成 graph）+ 5 target resolve 校验
- flag：`--repeats N` `--agent name` `--negative-control` `--simulate-graph-missing` `--out FILE`
- exit 三级语义（0/1/2）沿用 170c
- **CLI guard（修 codex C-1）**：`const isCliEntry = process.argv[1]?.endsWith('feature-170d-driver-preference.mjs'); if (isCliEntry) main().catch(...)`
- 转绿 T001 harness 部分

### T016 — docs §七 [文档]
**文件**: `plugins/spec-driver/docs/spectra-mcp-integration.md`
- §六 前加「## 七、Driver 偏好引导设计（F170d）」：F170c SC-002 洞察 / 为何需 prompt 层引导 / template 单一源机制 / 用户 override（fork：改 template + 跑 sync）/ guided vs spontaneous 度量诚实声明

### T017 — .gitignore raw JSON [配置，响应 codex W-3]
**文件**: `.gitignore`
- 加 `specs/*/verification/sc-002-driver-eval-*.json`（host raw run 不入库；只 track 人工 verification-report.md）

### T018 — repo:check 接入 sync --check [核心，响应 codex W-8 提升至 GREEN]
**文件**: `scripts/lib/repo-maintenance-core.mjs`
- `validateRepository` 注册 check id `preference-rules:agent-block-sync`，调 `sync-preference-rules.mjs --check`；drift → fail
- **不在 check-plugin-sync.sh 薄壳加逻辑**（修 codex W-5 同源）
- 跑 `npm run repo:check` 确认新 check 生效 + pass（双重漂移守护：vitest SC-006 + repo:check）

### T020 — 零回归门禁 [验证]
- `npx vitest run --project unit tests/unit/spec-driver/` → T001/T002 全绿
- `npx vitest run`（全量）→ 基线 3798 + 新增 全 pass
- `npm run build` 零错误；`npm run repo:check` pass（含 T018 新 check）；`npm run release:check` pass
- `git diff` 复核未动 tool description / response format / agent frontmatter tools（SC-008）

**GREEN 验收**: 达到 **`static-pass`** 状态（SC-001/005/006/007/008 全过 + SC-009 harness 逻辑就绪）。

---

## HOST 实测 Phase（GREEN 后定时机，需 Claude Max OAuth）

### T030 — US2 guided active-call rate [host/Primary]
- **preflight（响应 codex W-4）**：`npm run build`（生成 dist/cli）→ harness 内 `ensureGraphAndValidateTargets` 跑 spectra batch 生成 `specs/_meta/graph.json` + 校验 5 target
- 跑 `node scripts/feature-170d-driver-preference.mjs --repeats 2`（N=10，driver=claude-sonnet-4-6）
- 判定：≥5/10 → primary-pass；3-4 → degraded（降级1）；0-2 → fail（limitation + 降级3）
- 产出 raw JSON（.gitignore）+ 三层指标 + Wilson CI
- 预算守护：触及 ~$15 等价/配额警戒线 → 缩 N

### T031 — US3 Grep fallback [host]
- `--simulate-graph-missing` → 断言 graph-not-built 时 driver 回退 Grep 且任务推进

### T032 — US4 chained call [host/Secondary]
- 复用 F167 cohort C，N=3 → 断言 ≥1/3 出现 detect_changes→impact→context chain（≥30%，不阻塞）

### T033 — negative-control over-call [host/Soft，响应 codex W-7]
- `--negative-control` 跑 3 个 non-caller-analysis task → 断言调 MCP 的 run ≤ 1/3（SC-009）

---

## REFACTOR Phase（可选，commit 3：`refactor(170d): ...`）

### T040 — 渲染逻辑去重 [可选]
- 评估 core `renderInjectionBlock` 与 sync `renderBlockForAgent` 是否已单一来源（T011 已要求复用）；若残留重复则抽取

---

## VERIFY Phase

### T050 — verification-report [验证]
**文件**: `specs/170d-driver-preference-shaping/verification/verification-report.md`（入库）
- 声明验收状态级别（static-pass / host-pending / primary-pass / degraded）；**host 未跑则标 `host-pending`，不标 full PASS**
- 列每个 SC 结果 + 三层指标 + Wilson CI + 情景判定；SC-002/003/004/009 未在 host 跑则明确 host-pending（响应 codex W-7）
- 汇总各阶段 Codex 审查结论

---

## 任务-SC-FR 映射

| 任务 | SC | FR |
|------|-----|-----|
| T002/T012 | SC-001 | FR-001/003/006 |
| T030 | SC-002 | FR-007/008/015 |
| T031 | SC-003 | FR-010 |
| T032 | SC-004 | — |
| T013 | SC-005 | FR-004 |
| T010/T011/T002 | SC-006 | FR-005 |
| T018/T020 | SC-006/007 | FR-005/013 |
| T020(diff)/T002(快照) | SC-008 | FR-011/012 |
| T015/T033 | SC-009 | FR-014 |
