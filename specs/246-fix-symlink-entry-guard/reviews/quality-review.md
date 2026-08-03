# 代码质量审查报告 — F246 符号链接入口守卫修复

审查范围：`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（canonical helper，新增）、
`scripts/lib/is-invoked-directly.mjs`（薄壳，新增）、
`plugins/spec-driver/tests/is-invoked-directly.test.mjs`（新增）、
23 处调用方替换（15 处 `scripts/` + 8 处 `plugins/spec-driver/scripts/`）、
5 处 judge 快照闭包 roster 更新文件。

审查方法：全量 `git diff HEAD` 逐文件核对 + 实跑 `node --test`（helper 单测 7/7、judge 闭包相关 58/58）+ `npm run repo:check`（全绿，仅预置 graph-freshness warning 与本次改动无关）。

---

## 1. helper 实现正确性

**文件**：`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`

| 检查点 | 结论 |
|---|---|
| `argv[1]` undefined | **PASS** — `invokedPath === undefined` 显式短路返回 `false`，不进入 realpath 调用（避免 `realpathSync(undefined)` 抛 TypeError）。测试 case 3 覆盖并断言 `doesNotThrow`。 |
| realpath 单侧失败（invokedPath 不存在） | **PASS** — 两侧分别 try/catch，各自独立回退 `path.resolve`。测试 case 4 覆盖：invokedPath 指向不存在文件，回退后与 canonical 模块路径必然不等（一个是 canonical 一个是词法归一），结果 `false`，无异常。 |
| realpath 双侧失败 | **WARNING** — 无测试覆盖"两侧同时 realpath 失败"的场景。理论风险见第 5 节分析，结论是极低概率但建议补一条显式测试锁定行为（当前代码逻辑本身是安全的，只是覆盖率有缺口）。 |
| 相对路径 `argv[1]` | **PASS** — `fs.realpathSync` 对相对路径按 `process.cwd()` 解析，Node 实际调用脚本时 `argv[1]` 几乎总是已绝对化，但即便传入相对路径，realpath 语义仍正确（不依赖调用方预先 `path.resolve`）。 |
| 被 vitest / `node --test` import 时的 argv[1] 形态 | **PASS** — 此时 `argv[1]` 是 test runner 自身入口（如 `.../node_modules/.bin/vitest` 或 `node --test` 的运行器路径），realpath 后与被测模块路径必然不同 → 返回 `false`，语义与文档承诺的"不变量"一致，且已被 23 处调用方现存单测间接验证（judge-file-set-guard 等 58 个测试全绿，未因 helper 引入而误触发任何 `main()`）。 |
| `--preserve-symlinks-main` 下行为 | **PASS**（分析结论）— 该 flag 只影响 `import.meta.url` 是否提前被 loader 解析为 realpath；无论提前解析与否，helper 内部对两侧都统一执行一次 `realpathSync`，realpath 本身幂等，所以最终比较对象在开启/关闭该 flag 时结果一致。仓库当前无该 flag 用法，此为前瞻性分析而非实测，建议在报告中如实标注为推导而非实证。 |
| 薄壳零逻辑 | **PASS** — `scripts/lib/is-invoked-directly.mjs` 确认为单行 `export { isInvokedDirectly } from '...'`，无任何本地实现、无二次包装，方向符合 fix-report 声明的"仓库根 → 插件侧"单向依赖，且与仓库既有先例（`repo-maintenance-core.mjs`）一致。 |

## 2. 23 处替换的机械一致性

逐文件 `git diff` 核对（15 处 `scripts/` + 8 处 `plugins/spec-driver/scripts/`）：

- **PASS** — 全部 23 处变量名保留原有语义命名（`isCliEntry` / `isMain` / `isDirectRun` 等），仅替换判定表达式为 `isInvokedDirectly(import.meta.url)`，未引入无关改动。
- **PASS** — `import { isInvokedDirectly } from './lib/is-invoked-directly.mjs'`（或插件内 `./lib/...`）插入位置与各文件既有 import 分组风格一致（紧邻其他 `./lib/*` 相对导入之后）。
- **PASS（已核实无遗漏/无误删）** — 用 `grep -n "fileURLToPath|pathToFileURL"` 对 `freeze-preregistration.mjs`、`verify-feature-176.mjs`、`spec-drift-cli.mjs` 三处删除了旧 import 的文件复核，确认删除的 `fileURLToPath` / `pathToFileURL` 在文件内无其他引用点（非误删仍在用的 import）。用 `grep -rn "argv\[1\]"` 对全仓 `scripts/` + `plugins/` 复核，fix-report 中列出的「显式排除」（`graph-bootstrap-status.mjs`，归 F241 收口）与「类似模式全部 [安全] 不动」两组共 29 处，实测扫描结果与报告逐条吻合，无第四类遗漏、无误伤。
- **PASS** — `scripts/spec-drift-cli.mjs` 原注释（解释 Windows 编码问题）被替换为新注释，准确描述了新写法同时覆盖 Windows 编码与 symlink 两类问题，未留下过时/矛盾的旧注释残片。

## 3. 测试质量

**文件**：`plugins/spec-driver/tests/is-invoked-directly.test.mjs`

| 检查点 | 结论 |
|---|---|
| symlink 集成测试是否真实经软链路径 spawn | **PASS** — 两条集成用例均 `fs.symlinkSync(REPO_ROOT, linkRoot)` 建立目录级软链，再 `spawnSync(process.execPath, [path.join(linkRoot, '...')], ...)` 以软链路径作为脚本入口真实 spawn 子进程，非 mock、非直接函数调用。 |
| 断言是否落在真实副作用而非仅退出码 | **PASS** — `record-workflow-run.mjs` 用例先断言 `.specify/runs/*.jsonl` 文件确实落盘、内容字段（`workflowId`/`runId`/`result`）匹配，退出码断言放在最后作为"辅助信号"；`verify-feature-176.mjs` 用例断言 stdout 解析出的逐 step JSON 至少 1 行且字段结构正确。两者都精确命中了原 bug 的表征（"退出码 0 但零副作用"），断言设计对症。 |
| 临时目录清理是否可靠（含失败路径） | **PASS** — `afterEach` 无条件执行 `fs.rmSync(tmp, { recursive: true, force: true })`，`node:test` 的 `afterEach` 在用例断言失败（`assert` 抛出）时仍会执行，不存在失败路径遗留临时目录的风险；`force: true` 亦兜住目录本就不存在的边界。 |
| 是否存在隐式环境依赖 | **WARNING** — `os.tmpdir()` 依赖运行环境的临时目录可写与非 noexec 挂载（多数 CI/本机环境成立，但容器化/加固环境可能例外，属于此类"经 tmp 路径 spawn 子进程"测试的通用限制，非本次改动独有问题，不阻塞）；未见与并发相关的共享可变状态（`mkdtempSync` 保证目录名唯一，`beforeEach` 独立创建）。实测本地一次性运行 7/7 绿，未做多次重复/并发压测，但风险可控。 |

## 4. judge 闭包 roster 更新

涉及文件：`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`、
`plugins/spec-driver/tests/{judge-file-set-guard,judge-snapshot-core,judge-snapshot-doctor-cli,judge-snapshot-doctor}.test.mjs`。

| 检查点 | 结论 |
|---|---|
| roster 增补是否必要 | **PASS** — `record-workflow-run.mjs` 改为 `import { isInvokedDirectly } from './lib/is-invoked-directly.mjs'` 后，该 helper 文件进入 `record-workflow-run.mjs` 的真实 import 闭包；`judge-file-set-guard.test.mjs` 断言"闭包 == JUDGE_FILE_SET"（真实扫描 vs 声明常量做 `deepStrictEqual`），因此新增该文件到 roster 是结构性必需，不加会导致该守卫测试立即失败（非可选加固）。 |
| 计数变更（6→7）与内容变更是否成对一致 | **PASS** — `JUDGE_FILE_SET` 数组、`judge-file-set-guard.test.mjs`、`judge-snapshot-core.test.mjs`、`judge-snapshot-doctor-cli.test.mjs` 四处的新增条目文本 `'scripts/lib/is-invoked-directly.mjs'` 完全一致；`judge-snapshot-doctor.test.mjs` 中 `#7`/`#8`/`#11`/`#11b`/`#11c` 五处用例的 match/mismatch 计数按"7 文件基数"逐一重算且注释标明来源（如 `roster 7 个文件 - 1 mismatch - 1 EACCES = 5 个 match`），未见算术错误。 |
| 有无为过绿而放松断言 | **PASS** — 全部改动都是"因新增文件导致基数从 6 变 7"的等比例数值调整，断言逻辑（match/mismatch/indeterminate 的判定条件、EACCES 处理分支、`assert.deepStrictEqual` 严格集合比较）本身零改动，不存在放宽阈值或删减断言分支的情况。实跑 58/58 全绿印证。 |

## 5. 安全与稳健（反向风险：不该执行时误判为 true）

审查方向：realpath 回退是否可能让守卫在"被 import 场景"或"路径不匹配场景"误判为 `true`，从而让 `main()` 意外执行（比原 bug——静默空转——更危险的方向：非预期的副作用执行，如误发 workflow run 事件、误跑批处理任务）。

- **场景 A — invokedPath 不存在，realpath 失败回退 `path.resolve`**：此时 `canonicalInvoked` 是未 canonical 化的词法路径，`canonicalModule` 是 `fileURLToPath(moduleUrl)` 经 realpath 后的 canonical 路径。两者格式不对称，只有当 `invokedPath` 本身已经是无 symlink 段的纯净绝对路径且与模块路径字面相同时才会碰巧相等——但那种情况下 `invokedPath` 对应文件本就存在，不会走进 realpath-失败分支，构成矛盾，故此分支不会产生误判为 `true` 的风险。**PASS**。
- **场景 B — modulePath（当前正在执行的模块自身文件）realpath 失败**：`fileURLToPath(moduleUrl)` 得到的路径是 Node loader 已经成功加载并正在执行的文件，正常运行时几乎不可能出现"文件不存在"（除非运行期间被并发删除的极端竞态），风险面极窄，不构成实用攻击面或误用触发条件。**PASS（低风险，非阻塞）**。
- **场景 C — 双侧同时 realpath 失败且 `path.resolve` 结果碰巧相等**：仅在"argv[1] 指向的文件不存在"且"当前执行模块自身也读不到"同时成立时才可能发生，两个条件叠加的概率在正常运行环境下可忽略；且如上节第 1 部分所述，此分支缺少专门测试锁定，属于**遗留测试覆盖缺口**而非已发现的实际漏洞。**WARNING**（建议补测试而非当前已判定为 bug）。
- 注入 / 路径逃逸 / 凭据类风险：本次改动只涉及入口判定的字符串/路径比较逻辑，不涉及用户输入拼接、命令执行、凭据处理，未引入新的攻击面。**N/A（不适用，符合任务预期）**。

---

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | canonical + 薄壳分层与仓库既有 `scripts → plugins` 单向依赖先例一致，避免 23 份重复实现，直接对齐 fix-report 中 F241 T027a 教训 |
| 设计模式合理性 | EXCELLENT | 单一 helper 函数、纯函数式（`moduleUrl` 显式传参不做内部读取，利于测试注入），无过度抽象 |
| 安全性 | GOOD | 反向误判风险（不该执行却执行）经分析结论为极低概率，但双侧 realpath 同时失败场景缺专门测试锁定 |
| 性能 | N/A | 判定逻辑非热路径，`fs.realpathSync` 调用开销可忽略，不适用性能维度深入分析 |
| 可读性 | EXCELLENT | helper 顶部注释完整复述根因 5-Why 链路与不变量，调用方替换后单行判定表达式清晰易读 |
| 可维护性 | EXCELLENT | 消除 23 处重复判定逻辑为单一事实源；judge roster 四处联动更新保持严格一致，未来再有类似脚本可直接复用 helper |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 安全性/可维护性 | `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（realpath 双侧失败分支）与 `plugins/spec-driver/tests/is-invoked-directly.test.mjs` | 双侧 `realpathSync` 同时失败的场景无专门测试覆盖，虽经代码走查判定该分支不会产生误判为 `true` 的风险，但缺乏测试锁定意味着未来重构该函数时可能在无意中破坏这一隐性安全边界而不被测试捕获 | 补一条测试用例：`process.argv[1]` 指向不存在的路径，同时 mock/构造 `moduleUrl` 也指向不存在的路径，断言结果仍为 `false` 且不抛错 |
| INFO | 可维护性 | `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs` 注释 | `--preserve-symlinks-main` 下行为正确性目前是代码走查推导结论，未经实测验证（仓库当前无该 flag 用法） | 若未来某脚本启用该 flag，建议补一条实测用例；当前作为文档化的推导结论已足够，不阻塞本次修复 |

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL，WARNING = 1（仅为测试覆盖缺口的建议性加固，非已发现的功能缺陷），INFO = 1。helper 实现、23 处机械替换、symlink 集成测试、judge 闭包 roster 四方面逐项核实均为 PASS，且全部相关测试实跑验证（helper 单测 7/7、judge 闭包相关测试 58/58、`npm run repo:check` 全绿）与静态审查结论一致，未发现需要在提交前修复的问题。
