# 修复计划: F269 CI vitest birpc 假红收敛

**分支**: `269-fix-ci-birpc-false-red` | **日期**: 2026-08-30
**输入**: `specs/269-fix-ci-birpc-false-red/fix-report.md`（诊断已完成，5-Why 根因链见该文件）
**模式**: fix（问题修复，非新功能）——本计划不含完整架构设计，仅覆盖方案 A 的具体变更清单、回归风险与验证方案。

## 摘要

master CI 的 `Test` 步在 533 个测试文件 / 7874 tests **全部 passed** 时仍以 exit code 1
收尾（`[vitest-worker]: Timeout calling "onTaskUpdate"`）。根因是 4 vCPU runner 上
「主进程 + 2 worker（F235 的 `maxWorkers=CPU/2`）+ 各 worker spawn 的孙进程」饱和排队，
worker→主进程的 birpc RPC 应答延迟越过硬编码且不可配置的 60s 超时（上游
vitest-dev/vitest#8164 open，见 `research/online-research.md`）。测试面较 F235 收敛时
+35%，原有余量被吃穿。

采纳方案 A：在 `.github/workflows/ci.yml` 的 `Test` 步注入**步级** env
`VITEST_MAX_FORKS: "1"`，把该步的 vitest 并行度收窄到 1 个 worker（poolOptions.forks.maxForks
优先级高于 `vitest.config.ts` 的 `maxWorkers` 推导值，已三重实证：bundle 源码 / Node API
resolved-config / 运行时进程树 A/B）。`npm test` 命令本体、`vitest.config.ts` 的行为逻辑均
不改，仅补一句注释同步合同表述。方案 B（shard）/ C（升级 vitest）/ D（掩盖 unhandled error）
均已在 fix-report.md 中用数据排除。

## 技术上下文（精简）

- **改动对象**：CI workflow 配置（`.github/workflows/ci.yml`）+ 测试运行器配置注释
  （`vitest.config.ts`）。不涉及产品代码、不涉及 `src/`、`plugins/`。
- **测试策略**：无需新增单元测试用例——本次改动的验证对象是「CI 步骤在真实 GitHub
  Actions runner 上的进程退出码」，本地环境（18 核开发机，9 worker，余量充裕）结构性无法
  复现该失败（F232「本地全绿≠CI 绿」家族）。验证走真实 CI 推送 + 二次 rerun。
- **不触及**：`contracts/release-contract.yaml`、产品行为面、对外 API/MCP 合同。

## Codebase Reality Check

| 目标文件 | LOC | 改动规模 | 已知 debt |
|---|---|---|---|
| `.github/workflows/ci.yml` | 85 行 | Test 步新增 `env` 块（2 行）+ 观测行（1 行）+ 注释（约 8 行），共 +11 行 | 无 TODO/FIXME；文件内已有多处 F-编号追溯注释（F265/F268 等），风格一致，本次沿用同一注释密度 |
| `vitest.config.ts` | 178 行 | F235 注释块（L48-55）追加 1 句说明，纯注释，0 行为改动 | 无 TODO/FIXME；`maxWorkers` 推导逻辑（L27-28）不动 |

两个文件均远低于 500 LOC 前置清理阈值，且新增行数均 < 50 行，**不触发前置 cleanup task**。

## Impact Assessment

- **直接修改文件数**：2（`.github/workflows/ci.yml`、`vitest.config.ts`）
- **间接受影响**：仅 CI pipeline 自身的执行时长与进程调度；无产品代码调用方、无 MCP/CLI
  下游消费方。`npm run test:plugins`（node --test）已在 fix-report.md 中核实零 vitest
  执行面，env 无意外传播。
- **跨包影响**：无。改动停留在仓库根级配置文件，不跨越 `plugins/`、`src/`、`scripts/` 边界。
- **数据迁移**：无。不涉及 schema、配置格式、状态文件格式变更。
- **API/契约变更**：无。不修改 release contract、公共接口、agent prompt 协议或 skill
  输入输出。
- **风险等级**：**LOW**（影响文件 2 < 10，跨包影响 0，无数据迁移，无契约变更）。按判定规则
  LOW 不强制分阶段架构拆分；但由于验证依赖真实 CI 的**多次**独立执行结果，下文「验证方案」
  仍按顺序步骤组织（推送 → 观测 run 1 → 主动 rerun → 观测 attempt 2），而非风险驱动的
  Phase 拆分。

## Constitution Check

| 原则 | 适用性 | 评估 |
|---|---|---|
| I. 双语文档规范 | 适用 | 新增注释、plan/fix-report 全部中文散文 + 英文标识符（`VITEST_MAX_FORKS`、`env`、`poolOptions.forks.maxForks`），符合 |
| II. Spec-Driven Development | 适用 | 本次通过 spec-driver fix 流程执行（诊断→规划→实现→验证），未绕过 |
| III. YAGNI | 适用 | 未引入新抽象——不新建 workflow 文件、不新建 npm script、不改 `vitest.config.ts` 的 `maxWorkers` 推导逻辑；仅在唯一必要的注入点（CI Test 步）加最小 env 覆盖，符合"三行重复代码优于过早抽象" |
| IV. 诚实标注不确定性 | 适用 | fix-report.md 已明确标注「余量型收敛非结构型」「验证依赖真实 CI，本地不可复现」为残余风险，非确定性口吻掩盖 |
| V-VIII（spectra 插件约束） | 不适用 | 改动不涉及 `plugins/spectra/` 或 `src/` 下 TypeScript 源码 |
| IX-XIV（spec-driver 插件约束） | 不适用 | 改动不涉及 `plugins/spec-driver/` 下 Prompt/YAML/脚本 |

**结论**：无 VIOLATION，无需豁免论证，无 Complexity Tracking 条目。

## 变更清单（Change Manifest）

### 变更 1：`.github/workflows/ci.yml` — Test 步注入步级 env + 观测行

**位置**：L45-46（当前 `- name: Test` / `run: npm test`）

**变更前**：
```yaml
      - name: Test
        run: npm test
```

**变更后**：
```yaml
      # F269：CI 4 vCPU 上 vitest 默认并行度（F235 maxWorkers=CPU/2=2 worker）+ 各 worker
      # spawn 的孙进程饱和竞争，导致 worker→主进程的 birpc onTaskUpdate RPC 应答排队延迟
      # 越过硬编码且不可配置的 60s 超时（上游 vitest-dev/vitest#8164 open，无版本修复）——
      # 测试全绿仍因 unhandled error 导致 exit 1。VITEST_MAX_FORKS=1 是步级注入（仅此步
      # 生效，本地开发与其余 CI 步不受影响），使 poolOptions.forks.maxForks 优先于
      # vitest.config.ts 的 maxWorkers 推导值生效，主进程只需服务 1 个 worker，RPC 应答
      # 延迟余量从 <1× 拉回预计 ≥3×。nproc 观测行把 runner 规格钉死为日志可查事实（详见
      # specs/269-fix-ci-birpc-false-red/fix-report.md）。
      - name: Test
        env:
          VITEST_MAX_FORKS: "1"
        run: |
          echo "nproc=$(nproc) VITEST_MAX_FORKS=${VITEST_MAX_FORKS}"
          npm test
```

**关键约束**：
- env 用**步级**（在 `- name: Test` 步内的 `env:` 块），不用 job 级 `env:`——精确自文档化，
  避免波及 `Repo Check` / `Release Check` / `Test Plugins` 等其余步骤（虽然已核实这些步骤
  不消费该变量，但步级注入本身是更精确的意图表达，符合原则 III 的最小必要复杂度）。
- 观测行放在 `npm test` **之前**，用 `nproc` 和 `$VITEST_MAX_FORKS` 展开值确认 runner 规格
  与 env 生效，输出进 Actions 日志、不影响退出码。
- `npm test` 命令本体（`vitest run && npm run test:plugins`）不改。

### 变更 2：`vitest.config.ts` — F235 注释块补充 CI env 覆盖说明（纯注释）

**位置**：L48-52 F235 注释块末尾（当前止于「本仓库不设 poolOptions，用 maxWorkers 以便对
forks / threads 任一 pool 都生效。」）

**变更内容**：追加一句说明，标注 CI 侧存在的唯一 poolOptions 注入点，防止本文件的合同表述
（"本仓库不设 poolOptions"）在 F269 落地后产生漂移误导：

```typescript
    // 优先级：poolOptions.forks.maxForks > maxWorkers > 内置推导；本仓库不设
    // poolOptions，用 maxWorkers 以便对 forks / threads 任一 pool 都生效。
    // F269：CI 的 Test 步通过步级 env `VITEST_MAX_FORKS=1` 覆盖此处的 maxWorkers 推导值
    // （env 优先级更高，见上一行注释），是本仓库唯一的 poolOptions 注入点——纯 CI 层收敛，
    // 不改本文件的默认推导逻辑，本地 `npx vitest run` 行为不受影响（详见
    // specs/269-fix-ci-birpc-false-red/fix-report.md）。
```

**性质**：纯注释改动，0 行为变化，`maxTestWorkers` 计算逻辑（L27-28）、`maxWorkers` 赋值
（L55）均不动。

### 不在本次变更范围内

- `npm test` 脚本本体（`package.json`）——不动
- `vitest.config.ts` 的 `maxWorkers` / `poolOptions` 实际取值逻辑——不动
- `Repo Check` / `Release Check` / `Test Plugins` 步骤——不动（已核实无 vitest 执行面）
- 任何 `contracts/release-contract.yaml` 字段——不涉及

## 验证方案

本地环境结构性无法复现该失败（18 核开发机 9 worker 余量充裕），验证**必须**走真实 CI。

1. **推送触发 run 1**：`git push` 到 `269-fix-ci-birpc-false-red` 分支（workflow
   `on: push` 无分支过滤，feature 分支 push 无需用户额外确认，遵循分支同步与交付约定中
   「push 到 feature/* 分支不需要等用户确认」）。
2. **等待 run 1 完成**，用 `gh run list` / `gh run view` 或等效方式检视 `Test` 步日志：
   - 确认观测行输出的 `nproc` 与 `VITEST_MAX_FORKS` 值（钉死 runner 规格：预期 `nproc=4`，
     `VITEST_MAX_FORKS=1`）
   - 确认 vitest 汇总行为 `0 failed`
   - 确认日志**不含** `"Timeout calling"` 字样
   - 确认 `Test` 步最终状态为 success（exit code 0）
3. **主动触发 attempt 2**：run 1 通过后执行 `gh run rerun <run-id>`，构成第二次独立执行
   （而非依赖偶发的第二次 push）。
4. **验收判据**：连续 **≥2 次**独立执行（run 1 + rerun attempt 2）的 `Test` 步同时满足：
   - exit code 0
   - vitest 汇总行 `0 failed`
   - 日志无 `"Timeout calling"` 字样
   两次均满足才算验收通过；任一次仍复现超时，判定方案 A 收敛不足，触发下方回滚路径。
5. **顺带验证不回归**：`Repo Check` / `Release Check` / `Test Plugins` 三步在两次执行中
   均应保持原有绿色状态（已核实这三步不消费 `VITEST_MAX_FORKS`，此处仅作为不回归确认，非
   本次修复的直接验证对象）。

## 回归风险评估

| 风险项 | 评估 |
|---|---|
| Test 步墙钟拉长 | 预计从 ~530s 拉长到 ~800-1000s（1 worker 串行化 809s 累计 tests 时长，但争抢减半带来的单文件加速会部分回收）。job 总时长预计从 ~10.5min 拉长到 ~15-17min。**权衡**：对一个已连红近一月的 master，多等几分钟换取真实绿色信号是可接受代价；实际数值以验证 run 实测回填 |
| VITEST_MAX_FORKS 对 test:plugins 的影响 | 无。已在 fix-report.md 中核实 `npm run test:plugins` 走 `node --test`，零 vitest worker RPC 执行面；4 个含 "vitest" 字样的 mjs 文件（fix-compliance-core / goal-loop-core / check-codex-inventory / codex-runtime-doctor）均为字符串数据或注释引用，非实际执行路径 |
| 本地开发环境 | 零影响。env 仅在 CI workflow 的 Test 步声明，本地 `npx vitest run` 不读取该变量，`vitest.config.ts` 的 `maxWorkers=CPU/2` 公式继续生效（18 核开发机仍是 9 worker） |
| 其余 CI 步骤（Repo Check / Release Check / Test Plugins） | 零影响。env 为步级注入，不泄漏到其余步骤的 shell 环境；且已核实这些步骤本身不消费该变量 |
| Job 总时长对开发反馈循环的影响 | 存在但可接受——当前 master 连续多个 run 处于假红状态，团队已在为「重新确认红色是否真失败」付出人工核查成本；换取确定性绿色信号是净收益 |
| 若验证阶段仍复现超时（残余风险，fix-report.md 已登记） | 方案 A 是余量型收敛（60s 硬超时与饱和排队机制仍在），若 1 worker 仍不足以拉开余量，下一档预案是**按 project 拆分为多个串行 vitest 步**（每步独立退出码，进一步降低单步内并发争抢），需另起 Fix 任务评估拆分粒度（unit / integration / golden-master / self-hosting / e2e 五个 project 的运行时长分布），不在本次方案 A 范围内展开 |

## 回滚路径

- **触发条件**：验证方案第 4 步判据未达成（连续 2 次执行中至少 1 次仍复现 `"Timeout
  calling"` 或非零 exit code 且伴随 0 failed 测试）。
- **回滚动作**：`git revert` 本次两处变更，恢复 `Test` 步为无 env 的 `run: npm test`，
  `vitest.config.ts` 注释恢复原状。
- **升级路径**：另起 Fix 需求评估「按 project 拆分串行 vitest 步」方案（fix-report.md
  残余风险节已预留），或持续跟踪上游 vitest-dev/vitest#8164 的修复进展。

## Complexity Tracking

无 Constitution 违规项，本节不适用。
