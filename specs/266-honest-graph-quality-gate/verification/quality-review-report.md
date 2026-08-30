# F266 代码质量审查报告

审查范围：工作树相对 HEAD 的全部改动（21 文件 +772/-48 + 7 个未跟踪新文件），聚焦
`src/mcp/lib/graph-honesty.ts`、`src/mcp/lib/response-helpers.ts`、`src/mcp/agent-context-tools.ts`、
`src/cli/commands/{graph-quality,graph}.ts`、`src/cli/utils/parse-args.ts`、
`src/knowledge-graph/module-derivation.ts`、`src/hooks/git-hook-installer.ts`、
`src/panoramic/graph/quality/quality-types.ts` 及配套测试。

审查方式：全文 Read 生产文件 + 全部相关测试文件；`npx tsc --noEmit -p .`；
`npx vitest run` 跑 F266 全部新增/改动测试（9 个测试文件，260 用例）；
`grep` 全仓核对 `cannotAssessReason` / `GraphHonesty` 消费面一致性。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | 三层边界（graph-honesty 算事实 → response-helpers 生文案 → agent-context-tools 装配）严格遵守，装配点均 ≤10 行，判定逻辑无泄漏 |
| 设计模式合理性 | EXCELLENT | 无过度工程；resolution 三分互斥判定、coverage 缺口量化、builder advisory 三处职责边界清晰，命名精准（`separable: false` 语义直白） |
| 安全性 | GOOD | exportKind/builder 字段回显前有白名单/常量化收口防注入；hook 生成的 sh 脚本变量全程双引号，`sh -n` 语法测试覆盖；仅有 1 处 INFO 级健壮性提示 |
| 性能 | GOOD | honesty 计算与 coverage 聚合走模块级缓存，失效判据与 `getCachedGraphData` 同源（mtimeMs+sizeBytes）+ 2s TTL，未见每次调用 spawn git 或重复全图遍历；6.4MB 图上单次 cache-miss 遍历成本与图本身加载同量级 |
| 可读性 | EXCELLENT | 每个非平凡判据都配 why 注释（含反例场景），三层边界图示在文件头显式画出，未见隐晦分支 |
| 可维护性 | GOOD | 测试为真实行为断言（36 组合表驱动逐条件差异化断言，非镜像实现）；1 处文档同步缺口（`--force` 未入 CLI reference） |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 可维护性 | `docs/spectra-cli-reference.md` | `spectra graph` 新增的 `--force` 逃生口标志仅写在 CLI `--help` 文本（`src/cli/commands/graph.ts:36`），未同步进 `docs/spectra-cli-reference.md` 的用户文档 | 在 CLI reference 的 `spectra graph` 小节补一行 `--force` 说明，与 `--help` 文案对齐 |
| INFO | 可读性 | `src/mcp/lib/graph-honesty.ts:407` | `describeBuilder` 用 `graphData.graph as unknown as Record<string, unknown>` 而非直接走已声明的 `builder?: GraphBuilderStamp \| null` 字段类型 | 已核实为有意为之：`graph-types.ts` 明文要求消费方"MUST 经 parseGraphBuilderStamp 防御性解析，MUST NOT 直接按声明类型断言取字段"（磁盘上可能存在更新版本写出的、本版本读不懂的值）。建议在此处补一句简短注释指明该 cast 是遵循该契约而非类型逃逸，避免后续 reviewer 误判为随手 `as any` 式偷懒 |
| INFO | 跨模块一致性 | `docs/spectra-cli-reference.md` / README.md | post-commit hook 行为从"增量重建"改为"`spectra batch --mode graph-only` 全量重建"，两处文档已同步更新（已验证），但未提及"旧安装（已跑过 `spectra install --git`）不会被追溯改写，需重新 `install --git`"这一行为差异——该点已在 `git-hook-installer.ts` 源码注释里说明，但用户侧文档未体现 | 可在 `docs/spectra-cli-reference.md` 的 hook 说明段落追加一句迁移提示（非阻断） |

未发现 CRITICAL / WARNING 级问题。

## 逐维度证据补充

### 1. 命名/风格/死代码
- 未见调试残留（`console.log` 仅出现在 CLI 输出路径，属设计行为，非调试遗留）
- 未见 `TODO`/`FIXME`/`XXX`
- 新增生产代码中未见 `as any`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable`
- 测试文件未使用 `any`（符合 `.claude/rules/tests.md` 约束）

### 2. 单一职责 / 装配点约束
逐一核对 `src/mcp/agent-context-tools.ts` 三处装配点（`handleImpact`/`handleContext`/`handleDetectChanges`）：
均为 `buildHonestyAnnotation({...})` 调用 + 一次 `data['honesty'] = honesty` 赋值 + `generateNextStepHint` 参数追加，
无判定逻辑下沉到该文件；判定全部封装在 `graph-honesty.ts`（`decideResolution`/`computeCoverageGap`/`describeBuilder`），
文案生成全部封装在 `response-helpers.ts`（`describeResolutionForHint`/`describeFreshnessForHint`）。三层边界成立。

### 3. 性能
- `getOrComputeCacheEntry`（`graph-honesty.ts:226`）的失效判据 `graphPath`/`mtimeMs`/`sizeBytes` 与调用方
  `getCachedGraphData` 返回结构字段名逐一对应（源码注释显式声明"与 getCachedGraphData 完全相同的失效判据"）
- `computeCoverageGap` 的全节点/全边遍历只在 cache miss 时执行一次（TTL 2000ms 内命中率验证：单测
  `TTL 窗口内连续 10 次调用，evaluateFreshness 只被调用 1 次` 通过）
- 未发现每次 MCP 调用都 spawn git 子进程的路径——`evaluateFreshness` 走同一 TTL 缓存

### 4. 安全/健壮性
- `SAFE_EXPORT_KIND` 白名单（`/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/`）防止 exportKind 字段回显控制字符/注入文案，测试
  `exportKind 含控制字符时不回显原值` 验证通过
- builder "读不懂"分支的说明是与记录内容无关的常量串，测试用 5 种敌意输入（路径穿越、伪造 advisory 前缀、纯字符串、
  数字、数组）验证输出恒定且不含敏感片段
- `git-hook-installer.ts` 生成的 POSIX sh 段落：日志路径变量 `_spectra_log` 全程双引号使用，新增
  `sh -n` 语法检查测试；`skippedSources`/`callSitesCount` 等外部图产物字段读取均先做类型/有限性校验再参与统计
  （`Number.isFinite` 过滤 NaN/Infinity/负数）
- `graph.ts` 的 `readExistingGraphCounts` 对 JSON.parse 失败、字段缺失/非数值均 catch 并返回 `null`（放行而非误拒），
  测试覆盖"旧图损坏"/"字段类型不对"/"字段缺失"三种畸形场景

### 5. 测试质量
- `tests/unit/mcp-graph-honesty.test.ts`（76 用例）：FR-010 表驱动 36 组合（3 resolution reason × 4 freshness state）
  逐条件断言不同文案片段（`覆盖不足|覆盖率|未成边`/`暴露面`/`可采信`/`图已过期`/`未提交`/`来源版本不可知`），
  非快照式镜像断言，能实际区分各分支产出
- `tests/integration/mcp-honesty-envelope.test.ts`（14 用例）：走真实 `handleImpact`/`handleContext`/
  `handleDetectChanges` 全链路 + 真实临时目录落盘 graph.json + 真实 git 仓库（baseRef 场景），仅 stub
  `evaluateFreshness`（因 freshness 四态无法靠临时目录稳定构造，且 F249 已对该判定器本身有完整用例）
- 五态互斥性用 `Set` 收集组合去重后断言 `size===5`，防止表驱动测试掉入"看似覆盖实则同一分支"的陷阱
- `graph-command-degradation-guard.test.ts`/`module-derivation-empty-scope-warning.test.ts` 均为真实
  `runGraphCommand`/`buildModuleGraphForProject` 调用 + 临时文件系统断言，非 mock 内部实现

### 6. 跨模块一致性
- `cannotAssessReason` 新枚举值 `empty-graph` 的全仓消费点已穷举（`grep -rn`）：仅
  `quality-types.ts`（类型声明）+ `graph-quality.ts`（产出）+ 对应测试文件，无遗漏消费方；
  任务卡 T003 已核实 `scripts/lib/graph-quality-core.mjs` 无按值枚举的白名单逻辑，新增值自动继承
  `overallVerdict==='cannot-assess'` 的既有严重度路由，测试 `repo-maintenance-core.mjs` 集成用例验证通过
- `GraphHonesty` 类型未在 `plugins/` 或 `.claude/` 包装层出现任何影子定义（`grep -rln` 全仓确认），
  不存在需要同步却遗漏的镜像副本
- schema.json 变更为纯追加（enum 追加 `empty-graph`，描述文案更新），`tests/unit/contracts/graph-quality-report-schema.test.ts`
  验证四个旧枚举值全保留 + 灵敏度反例（篡改为枚举外值必报违规）

### 7. 构建/类型
- `npx tsc --noEmit -p .` 零错误
- 审查范围内生产代码零 `as any` 逃逸；`graph-honesty.ts:407` 的 `as unknown as Record<string, unknown>`
  经核实是遵循 `graph-types.ts` 显式契约（builder 字段声明类型不代表磁盘实际值集合，消费方 MUST 防御性解析）
  而非类型系统绕过，详见问题清单 INFO 项

## 验证记录

- `npx tsc --noEmit -p .`：0 错误
- `npx vitest run tests/unit/mcp-graph-honesty.test.ts tests/integration/mcp-honesty-envelope.test.ts tests/unit/graph-command-degradation-guard.test.ts tests/unit/module-derivation-empty-scope-warning.test.ts tests/unit/git-hook-installer.test.ts`：5 files / 129 tests 全过
- `npx vitest run tests/integration/graph-quality-cli.test.ts tests/unit/graph-quality-core.test.ts tests/unit/graph-quality-shape-validation.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts`：4 files / 131 tests 全过

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL、零 WARNING，仅 3 项 INFO（均为文档同步细节/注释补强建议，不影响功能正确性、安全性或可维护性主干）。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 3 个
