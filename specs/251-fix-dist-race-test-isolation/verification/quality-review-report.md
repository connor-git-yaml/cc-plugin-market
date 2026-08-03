# 代码质量对抗审查报告 — F251 dist 竞写隔离

审查对象：`tests/global-setup.ts`（新增）、`tests/helpers/dist-cli-guard.ts`（新增）、
`vitest.config.ts`（+globalSetup 声明）、8 处测试文件 `beforeAll` 由 `execFileSync('npm',['run','build'])`
改为 `assertDistBuilt()`。

审查方式：`git diff HEAD` 逐文件核对 + 全文 `Read` + 对 vitest 3.2.4 源码
（`node_modules/vitest/dist/chunks/cli-api.*.js`）做行为核实（globalSetup 是否真的
「全 project 只执行一次」），未跑 vitest / build（遵主编排器约束）。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 把构建职责收拢到 vitest globalSetup（worker fork 前单进程串行）是消除竞写窗口的正确解法；`projects[]` 不继承根级配置的坑（F233 已知）在这里被正确规避——已用 vitest 源码验证 `_initializeGlobalSetup` 恒把 `coreProject` 纳入待初始化集合，globalSetup 全量跑只执行一次，设计站得住 |
| 设计模式合理性 | NEEDS_IMPROVEMENT | 新鲜度判据用单一文件（`dist/cli/index.js`）的 mtime 作为「整个 dist 树已完整构建」的代理指标，语义上不等价，见下方 CRITICAL/WARNING |
| 安全性 | GOOD | 无硬编码密钥/注入面；`execFileSync('npm', ...)` 与旧代码同款调用方式，非新增风险 |
| 性能 | GOOD | 单点 build 替代最多 8 处重复 build，全量墙钟应下降；`newestMtimeMs` 递归 `src/`（~250 文件量级）一次性开销可忽略 |
| 可读性 | GOOD | 注释详实、根因链路和决策理由写得清楚，两文件职责边界清晰（谁建/谁只读断言） |
| 可维护性 | GOOD | 无过长函数、无重复代码；`FULL_BUILD_INPUT_PATHS` 相对 `BUILD_INPUT_PATHS` 的补充逻辑有明确注释说明动机 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 设计模式合理性 / 正确性 | tests/global-setup.ts:52-60（`isDistFresh`） | 新鲜度锚点只取 `dist/cli/index.js` 一个文件的 mtime，不代表「整个 dist 树在同一次成功构建中产出」。若上一次 `npm run build` 被中途杀死（execFileSync 180s timeout 触发 SIGTERM/SIGKILL、CI job 被取消、机器休眠等），而 tsc 在被杀死前**已经**emit 过 `dist/cli/index.js`（tsc 的 emit 顺序不保证按依赖图/字母序，无法假定入口文件最后写出），则该文件会带着一个「看起来新」的 mtime 落盘，而其余尚未 emit 的 `dist/**` 文件仍停留在更早一次构建的旧内容。下次 vitest 启动时，只要期间源码未再改动，`isDistFresh()` 会判定为 fresh 并跳过重建，让全量测试套件在一份内部不一致的 half-built dist 上跑——这正是本次修复要消灭的「半写 dist 被消费」故障模式，只是触发条件从「并发 build」换成了「构建被中断后未失败重试」。旧设计（每个测试文件各自无条件 `npm run build`）反而对这种情况有自愈能力（每次都全量重建）。<br>**复现路径**：`npm run build` 正常跑完后，`touch -d '+1min' dist/cli/index.js`（或直接删除/破坏另一个非入口 dist 输出文件，如 `rm dist/panoramic/graph/quality/quality-detectors.js`），保持源码不变，重跑 `npx vitest run`；预期 `[global-setup]` 日志会打印「已是最新，跳过 npm run build」，随后任何 spawn 该缺失模块的 CLI 子进程用例会以 `MODULE_NOT_FOUND`/运行时错误炸穿，而不是被自动重建修复。 | 用构建流水线**最后一步**的产物作锚点而非入口文件：`postbuild-stamp.mjs`（`npm run build` 的最后一个 lifecycle 钩子）写出的 `dist/.spectra-build-meta.json` 天然是「build 全流程跑到底」的信号（尽管其内部 `stampBuild` 失败会被吞掉不阻断 build，但至少比入口文件更接近「最后一步」）；更稳妥的做法是 `npm run build` 全程结束后（`execFileSync` 正常返回、无抛错）由 globalSetup 自己再 `touch`/写一个 sentinel 文件（如 `dist/.f251-build-complete`）标记「本次构建从 setup() 内部完整跑完」，freshness 判据同时比较该 sentinel 而非仅信任任意历史遗留的 `dist/cli/index.js` mtime。 |
| INFO | 可维护性 / 健壮性 | tests/global-setup.ts:34-49（`newestMtimeMs`/`visit`） | 递归 `statSync`+`readdirSync` 未对符号链接做防御：若 `src/` 下出现指向祖先目录的目录符号链接会无限递归导致栈溢出；当前仓库未见此类符号链接，风险是潜在而非已激活。另外该递归会把编辑器临时文件（`.swp`、`~`、`.DS_Store` 等，若不慎落入 `src/`）纳入 mtime 比较，只会导致「误判为不新鲜从而多建一次」，不会造成漏建，方向上是安全的过度触发而非危险的漏报。 | 可选加固：`visit` 里对 `dirent.isSymbolicLink()` 显式跳过或用 `Set` 记录已访问 realpath 防环；非必须，当前无实际触发路径。 |
| INFO | 跨模块一致性 | scripts/lib/spectra-version-gate.mjs:24（`BUILD_INPUT_PATHS`） | `BUILD_INPUT_PATHS` 含 `'tsconfig.build.json'`，但仓库实际只有 `tsconfig.json`（`tsconfig.build.json` 不存在，`npm run build` 脚本也只是裸 `tsc`）。`global-setup.ts` 的 `FULL_BUILD_INPUT_PATHS` 直接复用该数组，`newestMtimeMs` 内部用 `existsSync` 兜底跳过不存在路径，不会崩溃，但这是继承自 F176 的既有噪声（非本次改动引入），列出仅供知悉，不阻断本次修复。 | 可选：另起 Feature 清理 `BUILD_INPUT_PATHS` 的死引用，本次修复范围内不必处理。 |
| INFO | 可读性 / 一致性 | tests/global-setup.ts:18 vs tests/unit/feature-176-spike-and-gate.test.ts:18 | 两处都从 `scripts/lib/spectra-version-gate.mjs` 里 import 具名导出，`global-setup.ts` 加了 `// @ts-expect-error`，而 `feature-176-spike-and-gate.test.ts` 对同一模块的导入没有加。已核实 `tsconfig.json` 的 `exclude` 恒排除整个 `tests/`（`typecheck:tests` 脚本也只覆盖 `tests/type-tests/**/*.test-d.ts`），即 `tests/` 目录下任何 `.ts` 文件从未被任何 tsc 调用做过真实类型检查——vitest 用 esbuild 转译（只做语法转换/去类型，不校验类型）。因此这条 `@ts-expect-error` 指令当前不产生任何实际类型检查效果，是否加纯属注释性质，两处写法不一致但均无功能后果。 | 无需强制修复；若未来给 `tests/` 补类型检查，需注意此处指令可能触发「unused '@ts-expect-error' directive」误报，届时统一两处写法。 |
| INFO | 死代码/遗留 | 8 处改造文件 | 逐一确认：`execFileSync` 导入在全部 8 个文件中仍被其他代码路径使用（如 spawn 真实 CLI、`git init/add/commit` 等），无未使用导入残留；旧 `beforeAll(fn, timeout)` 的第二参数 hook timeout（60_000/120_000ms）已随 build 调用一并移除，剩余逻辑（fixture 初始化等）耗时远低于默认 hook timeout，未见遗留冗余参数。 | 无需处理。 |

## 其余审查点结论（均判定安全，未列入问题清单）

- **cwd 依赖一致性**（审查重点 3）：`tests/helpers/dist-cli-guard.ts` 用 `resolve('dist/cli/index.js')`（依赖 `process.cwd()`），与全仓既有的 8 个测试文件 `const CLI_PATH = resolve('dist/cli/index.js')` 惯例完全一致，非新增风险；`tests/global-setup.ts` 改用 `import.meta.url` 推导 `PROJECT_ROOT`（更健壮，不依赖 cwd），两者路径解析策略不同但在当前仓库 `npm run test`/`npx vitest run` 恒从项目根目录调用的前提下结果一致，无实际分歧。
- **npm PATH 缺失兜底**（审查重点 4）：`execFileSync('npm', [...])` 与被替换前的 5 处旧代码完全同款，非本次引入的新依赖面；`stdio: 'inherit'` 相比旧代码（部分用 `encoding: 'utf-8'` 静默捕获）在构建失败时能让 tsc/npm 的原始报错直接打印到当前终端，属于可观测性的改善而非退化。
- **globalSetup 是否真的全局唯一执行一次**（审查重点 5，vitest.config.ts 注释的核心断言）：已读 `node_modules/vitest/dist/chunks/cli-api.*.js` 源码验证：`Vitest.initializeGlobalSetup(paths)` 用 `paths.map(spec => spec.project)` 收集实际匹配到测试文件的 project 实例，并显式 `if (!projects.has(coreProject)) projects.add(coreProject)` 强制把根 project 纳入；由于 `globalSetup` 声明在根级 `test.*` 而非任何 `projects[]` 条目内，且 F233 已确认 `projects[]` 不继承根级配置，故子 project（unit/integration/...）各自的 `config.globalSetup` 为空、`loadGlobalSetupFiles` 对空值返回 `[]`，真正执行 `setup()` 的只有 `coreProject` 一份，且 `_initializeGlobalSetup` 内部有 `if (this._globalSetups) return` 幂等守卫——不论全量跑、`--project` 过滤跑还是单文件跑，均执行且仅执行一次。plan.md 决策点 1 的这条结论核实为真，非过度自信。
- **第 9 处遗漏排查**（审查重点 6）：`grep -rn "run.*build" tests/ --include="*.ts"` 全文核对，除 8 处已处理文件外，其余命中均为注释/字符串字面量（如 `mcp-server-stdio.test.ts`、`cli-coldstart.test.ts` 的 `HAS_DIST` skip 分支说明文案、Dockerfile fixture 里的 `RUN npm run build` 字符串），未发现遗漏的第 9 处运行期 build 触发点。
- **依赖 beforeAll build 副作用的用例**（审查重点 6）：检索了对真实 `dist/.spectra-build-meta.json` 有断言的用例——未发现；`tests/unit/cli/version.test.ts`、`tests/unit/feature-176-spike-and-gate.test.ts` 均用 `mkdtempSync` 临时文件路径构造 meta 场景，不读取真实 `dist/`，globalSetup 提前构建不影响其断言前提。`tests/helpers/freshness-stale-scenarios.ts` 里的 `computeCollectorFingerprint()` 读取真实 `src/` 文件计算指纹，但测试期间不会有代码修改真实 `src/`（均操作 `mkdtempSync` 出的临时 fixture 目录），globalSetup 阶段一次性完成的 fingerprint-alignment 在整个测试运行期间保持有效，不存在"源已改、dist 未重建"的新窗口。

## 总体质量评级

**GOOD**

评级依据：零 CRITICAL；WARNING 1 项（`isDistFresh` 单文件锚点无法防御「构建中途被杀死后残留半成品被误判为新鲜」这一较少见但真实存在的场景，属于设计层面的健壮性缺口，建议后续小改加固，不建议阻断本次交付——该场景需要「构建曾被中断」这一前置条件，概率远低于原 bug（全量并行必然触发的竞写），且失败表现是响亮的 MODULE_NOT_FOUND 而非静默污染断言结果）；INFO 4 项均为既有噪声/无功能后果的一致性建议，不影响交付判定。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 1 个
- INFO: 4 个
