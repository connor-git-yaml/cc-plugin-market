# 代码质量审查报告 — F250 `.pyi` 类型 stub 纳入 Python 符号采集面

审查范围：`src/collector-surface.ts`、`src/adapters/python-adapter.ts`、
`src/panoramic/graph/collector-fingerprint.{ts,test.ts}`、
`tests/unit/collector-surface.test.ts`、`tests/adapters/python-adapter.test.ts`、
`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`、
两份 pinned fixture（`tests/fixtures/collector-fingerprint-guardrail/expected-*.json`）。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | 严格落实 plan.md 四条关键设计决策，零越界：`scanPyFiles` 本体真的零改动（只改常量值）；护栏 A 用显式 `continue` 跳过而非依赖 quirk；`relPySet`/`relPyFiles` 确认未被护栏 A 影响；label helper 提取为单一函数消除双写。无跨层耦合、无新增依赖、无新增抽象。 |
| 设计模式合理性 | EXCELLENT | `stripFileExtension` 是恰到好处的最小提取（消除两处硬编码字面量的双写漂移），未过度抽象成配置化/策略模式；`PYTHON_SYMBOL_SCAN_SURFACE` 与 `PY_WALK_SURFACE` 有意保持两个独立引用（拒绝"顺手合并"），三处注释都讲清了这个反直觉决策的 why。 |
| 安全性 | N/A | 本次改动不涉及外部输入、网络、序列化、SQL 或路径遍历攻击面；纯 AST 采集面常量与本地文件名字符串处理，无安全相关变更。 |
| 性能 | GOOD | 无新增算法复杂度；`stripFileExtension` 是 O(1) 字符串操作；`T-SC005-control` 探针对整个仓库跑 `extractSymbolNodes`（真实 IO），属于测试内代价而非生产路径。plan.md 已确认本仓真实图增量为零（唯一 `.pyi` 落在剪枝集内）。 |
| 可读性 | EXCELLENT | 四处大段注释重写（`collector-surface.ts`/`python-adapter.ts` 三处/`collector-fingerprint.ts`）均清楚讲 why：为什么两个扩展名集合一致后仍分列两个常量、为什么护栏 A 选择显式跳过而非依赖现状、为什么纯点文件的行为 delta 是可接受的。测试探针命名（`T-guard-a-b`/`T-label-normal`/`T-C1-dotfile`/`T-FR002`/`T-SC005-control`/`T-overload`）与 plan.md「测试策略」一一对应，检索性强。 |
| 可维护性 | GOOD | 无过长函数、无重复代码、错误处理沿用既有 `parseError` 降级路径未新增裸 catch。轻微观察点见下方 INFO 项（辅助函数轻微重复、大段 mock 略显冗长）。 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 可维护性 | `tests/adapters/python-adapter.test.ts:T-guard-a-b`（约 664-687 行） | 4 个 `it` 块内均重复"`mkdtempSync` → try → `writeFileSync` 若干 → 断言 → finally `rmSync`"的模板结构（约 6 处），是既有测试文件的既定写法（与文件其余部分风格一致），非本次新增坏味道，但若未来该文件继续增长可考虑抽取 `withTmpPyDir(files, fn)` helper 收敛样板。 | 非阻断；可留作后续该测试文件整体重构时的候选项，不建议本次顺手改（改动面会扩大到既有测试）。 |
| INFO | 可维护性 | `tests/adapters/python-adapter.test.ts` T-label-parse-error（约 700-720 行） | `vi.spyOn(adapter, 'analyzeFile').mockImplementation(...)` 按文件名后缀分支 mock，属于"部分 mock + 部分真实"模式；测试意图清晰（只想控制 parseError 触发时机，不想引入真实的语法错误解析行为差异），且已用 `afterEach(vi.restoreAllMocks)` 保证探针间隔离，mock 使用是克制、合理的收敛，非过度 mock。 | 无需改动，仅记录判断依据。 |
| INFO | 可读性 | `src/adapters/python-adapter.ts` 护栏 A 注释（约 317-323 行） | 注释引用了"顺手统一 `stripFileExtension` 到 `pyModuleMap` 键生成"这一假设性未来场景来论证显式跳过的必要性，属于面向未来读者的良好 why 说明，但注释本身略长（7 行）；不影响理解，酌情保留。 | 无需改动。 |

**未发现 CRITICAL / WARNING 级问题。**

## 专项检查结论

1. **plan.md 四条关键设计决策符合性**：逐条核实源码 diff，四条均严格落地——(1) `scanPyFiles` 方法体确认零改动，仅常量值变化；(2) `pyModuleMap` 构建处对 `.pyi` 用显式 `if (absF.endsWith('.pyi')) continue;` 跳过（非依赖 `mod.pyi` 键与 `topModule` 不相等的现状 quirk）；(3) `relPySet`/`relPyFiles` 在护栏 A 的 `continue` 之前已 push，确认未被排除，T-guard-a-b 探针实证 `.pyi` 完整出现在 `moduleGraph.modules`；(4) `stripFileExtension` 在正常分支与 parseError 降级分支两处均被复用，双写漂移风险已消除。
2. **collector-surface 叶子性质 / 无新增循环依赖**：本次改动只涉及常量字面量值与注释，`collector-surface.ts` 未新增 import，`python-adapter.ts` 仅新增局部纯函数 `stripFileExtension`（无外部依赖），模块边界未被破坏。
3. **测试与实现同 commit 完备性**：当前改动尚未提交（工作树 diff），但落盘范围完整——3 个源文件改动 + 2 个测试文件改动 + 2 份 pinned fixture 再生 + 1 份 e2e 快照更新，与 plan.md Project Structure 声明的改动清单逐项对应，无遗漏文件。
4. **测试质量**：
   - 断言测行为而非实现细节：T-guard-a-b 断言 `graph.edges` 的 `from`/`to` 字段（对外行为），T-label-normal/T-C1-dotfile 断言最终 `label`/`id` 值，均是黑盒行为断言，未 assert 内部调用次数等实现细节。
   - `T-label-parse-error` 的 `vi.spyOn` 收敛合理：仅 mock `analyzeFile` 一个方法且按路径条件区分行为，测试范围精确聚焦于"parseError 分支的 label 剥离"这一单一变量，且有反自证保护（显式断言 `metadata` 确实为 `{ parseError: true }`，防止探针退化为重测正常分支）。
   - 探针独立性：`afterEach(() => vi.restoreAllMocks())` 保证 mock 不跨 `it` 泄漏；各 `it` 均自建独立 `tmpDir` 并在 `finally` 清理，无共享可变状态，互不依赖执行顺序。
   - FR-006 反自证要求已验证落实：`collector-surface.test.ts` 中两处翻转断言均保留硬编码期望值数组（`['mod.py', 'mod.pyi']`），未退化为仅由被测常量自身反向推导的自证断言。
5. **STRUCTURAL_DEBT 检查**：`python-adapter.ts` 441→474 行（+33，< 300→500/500→800 任一阈值触发线），`collector-surface.ts` 200→224 行，均在安全区间内，无 WARNING/CRITICAL 触发。测试文件增长较大（`python-adapter.test.ts` 611→869，+258 行）符合 plan.md 预估范围内的合理超支（估 150-180，实际 258，因新增探针比初始清单略详尽），测试文件通常不适用同一阈值口径，且属于既有测试文件的渐进增长，非新建大文件。
6. **验证结果**：`npx vitest run` 全量 498 passed / 4 skipped（6401 tests passed, 18 skipped, 21 todo），零失败；`npm run build` 通过（tsc 零错误）；F250 相关四个测试文件单独重跑 175/175 通过（含 e2e 快照对比）。

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL、零 WARNING，仅 3 项 INFO（均为既有风格延续或经论证判断为合理的测试写法，非新引入坏味道）；架构决策与 plan.md 四条关键设计决策逐项对应且已实证验证；全量测试与 build 零失败。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 3 个
