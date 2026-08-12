# 任务分解 — F262 Codex hooks installer 权限位放宽 + doctor/保全判据三处误报收口

> Fix 模式精简任务清单。唯一事实源：`plan.md`（逐文件逐函数变更清单 §3、四个裁决点 §4、
> 红先行测试计划 §5、验证命令序列 §7）。每组按「红先行测试 → 实现 → 绿」配对组织，
> 覆盖 W3 / W1a / W1b / W2 / W4 五条条目，最后一组做全量验证与制品收尾。
> 本卡不修改 `src/`，不新增 CLI flag，不改退出码合同。

## W3 — writeJsonAtomic 权限位保全

- [x] **T001** [红先行测试] 在 `tests/unit/codex-hooks-installer.test.ts` 新增 `describe('(h) 权限位保全（W3）', ...)` 块（插在既有 `(e) 写入前备份` 之后、`owned-entry-removed 诊断` 之前），落地 plan §5.1 全部 5 条断言：
  1. 目标原有 0600 → 写入后 `mode & 0o777 === 0o600`
  2. 目标原有 setgid 高位（`chmodSync(target, 0o2640)`）→ 写入后 `mode & 0o7777 === 0o2640`
  3. 目标不存在 + `umask(0o000)` → 首次创建 `mode & 0o777 === 0o600`
  4. spy `fs.writeFileSync`，断言写 tmp 调用 `options.mode === 0o600`
  5. mock `fs.chmodSync` 抛 `ENOTSUP` → `result.ok===true`、`changed===true`、`ownedHandlers` 完整、`diagnostics` 含 `target-mode-preserve-failed`
  验收：`npx vitest run tests/unit/codex-hooks-installer.test.ts` 新增 5 用例全部按预期失败（改动前代码上跑通红）。
  依赖：无。

- [x] **T002** [实现] 按 plan §3.1 + 裁决点 1 改造 `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`：
  - `writeJsonAtomic(filePath, data, { diagnostics = [] } = {})`：`statSync(filePath).mode & 0o7777` 读原权限（失败/ENOENT 默认 `0o600`）→ tmp 用 `mode: 0o600` 创建 → 独立 try/catch 内 `chmodSync(tmpPath, targetMode)`，失败 push `{level:'warning', code:'target-mode-preserve-failed', errno}` 到 diagnostics 并**降级继续**（不清理 tmp、不抛错）→ 外层写/rename 失败逻辑不变
  - `commit(...)` 透传同一 `diagnostics` 数组引用给 `writeJsonAtomic`
  验收：`npx vitest run tests/unit/codex-hooks-installer.test.ts` 全部转绿（含 T001 新增 5 用例）。
  依赖：T001。

## W1a — 第三方保全比较语义豁免

- [x] **T003** [红先行测试] 在 `tests/integration/codex-hooks-install-flow.test.ts` 新增 `describe('🔴 W1a 第三方保全比较语义豁免：用户预存空数组事件键不误报', ...)`（插在既有 `🔴 C1 第三方数据保全门禁` 块之后），落地 plan §5.2 全部 3 条：
  1. baseline `{hooks:{Stop:[]}}` + 安装写入四事件 → `--baseline` 校验 `projectionEqual===true`、`lostCommands` 为空（改动前 `false` + 出现 `foreign-entries-mutated`）
  2. M1 变异：安装器把用户空键整个删掉 → `projectionEqual===false`，`findings` 含 `foreign-entries-mutated`（须仍检出）
  3. RAW 槽：baseline `{hooks:[{foo:1}]}` 数组形态 → `projectionEqual===false`，`findings` 含 `foreign-entries-mutated`（须仍检出）
  验收：改动前代码上跑，用例 1 失败（红）、用例 2/3 本就应通过（作为不回归基线，先确认它们在改动前也通过，防止后续实现误伤）。
  依赖：无（可与 T001 并行）。

- [x] **T004** [实现] 按 plan §3.2 改造 `plugins/spec-driver/scripts/validate-codex-hooks.mjs`：新增 `isPlainObject`、`exemptEmptyEventKeys(beforeProjected, afterProjected, afterDoc)`（豁免条件：baseline 侧值为空数组 **且** 该键在 after 原始文档 `hooks` 对象中物理存在，显式排除 `RAW_DOCUMENT_KEY`/`RAW_HOOKS_KEY`），`checkForeignPreservation` 的 before/after 投影各自过一遍该函数再序列化比较；`lostCommands` 命令字面量口径不动。
  验收：`npx vitest run tests/integration/codex-hooks-install-flow.test.ts` 中 W1a 块 3 用例全部转绿。
  依赖：T003。

## W1b — 升版路径移除清单一等化

- [x] **T005** [红先行测试] 同文件新增 `describe('🔴 W1b 升版路径：--desired 直接消费 install --json 完整输出', ...)`（紧邻 W1a 块之后），落地 plan §5.3 全部 2 条（均加 `--skip-shape`）：
  1. 首次 `installCli(['--json'])` 落盘为 baseline，升版安装（`--plugin-root UPGRADED_PLUGIN_ROOT --json`）完整 stdout 落盘作 `--desired` → `lostCommands` 为空、`exitCode===0`（改动前旧路径命令被判丢失）
  2. 同一升版场景不传 `--desired` → `exitCode===1`，`findings` 含 `foreign-command-lost`（回归钉子：新形态不放宽默认口径）
  验收：改动前代码上跑，用例 1 失败（红），用例 2 本就应通过（不回归基线）。
  依赖：T004（复用同一测试文件的 fixture/helper 上下文，避免并发编辑冲突；逻辑上无强依赖）。

- [x] **T006** [实现] 按 plan §3.1 + §3.2 + 裁决点 2 完成两处改造：
  - `codex-hooks-installer.mjs`：`reportRemovedCommands` 由 `void` 改为 return "本轮真正消失（未被重新写回）" 的 command 数组；`installCodexHooks` 早退分支与最终 return 均新增 `removedCommands: string[]` 字段；`removeCodexHooks` 调用点不变
  - `validate-codex-hooks.mjs`：新增 `isInstallResultShape(parsed)`（`Array.isArray(parsed.writtenCommands)` 为核心判据）、`collectInstallResultCommands(parsed)`（`writtenCommands ∪ removedCommands` 去重）；`readDesiredCommands` 在字符串数组分支之后、`collectCommandLiterals` 兜底之前插入该形态判断
  验收：`npx vitest run tests/integration/codex-hooks-install-flow.test.ts` 中 W1b 块 2 用例转绿；W1a 块 3 用例保持绿（无回归）。
  依赖：T005。

## W2 — config.toml 词法扫描形态清单

- [x] **T007** [红先行测试] 在 `tests/unit/codex-runtime-doctor.test.ts` 新增 `describe('F262 / W2 — config.toml 词法扫描形态清单', ...)`（插在既有 plugin-build check 系列用例之后、比较矩阵之前），落地 plan §5.4 前 5 组 fixture：
  1. 行尾注释跨产品错归属（spectra 段头带注释被吞 → spectra 判 `indeterminate` 而非 `ok`）
  2. `\"` 转义（`mcp_servers."a\"b"` 段头含转义引号，不应提前终止注释剥离）
  3. `[[array]]` 泄漏（`[[profiles.batch]]` 不应重新点燃前一 plugin 段）
  4. FORM-D 多行字符串值泄漏（`"""..."""` 内 `enabled=true` 不生效）
  5. FORM-E 多行字符串幻影段（`"""..."""` 内的 `[plugins."x@evil"]` 不注册为真实 entry）
  另在既有 `F240 T048 — hook-trust 四情形固定状态值` describe 块追加第 6 组：`[hooks]`（非 `[hooks.state]`）不应误判为信任记录段。
  验收：改动前代码上跑，6 组用例按 plan 描述全部失败（红）。
  依赖：无（可与 T001/T003 并行）。

- [x] **T008** [实现] 按 plan §3.3 改造 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`：
  - 新增 `stripTomlComment`（单/双引号互斥跟踪 + 双引号内 `\` 转义感知，不复用 `simple-yaml.mjs` 的无转义版本）
  - 新增 `createMultilineStringTracker`（`"""`/`'''` 跨行状态机，逐行返回 `startedInsideString`）
  - 新增 `normalizeTomlLines(tomlText)` 共享管线（串内行不参与判定；剥注释→trim→识别 `[[x]]` 与 `[x]`）
  - `parsePluginRegistry` 改为消费该管线：`isArrayTable===true` 一律不注册为 entry（仍重置段边界）
  - `hasHooksStateSection` 改为消费该管线，正则收窄为 `^hooks\.state(\.|$)`
  - 模块头部新增"不支持形态清单"注释（段头内侧空白 / literal string 键 / 点分键 / 无 `@marketplace` 段 / 多 `@` 名，均 `absent→indeterminate`）
  验收：`npx vitest run tests/unit/codex-runtime-doctor.test.ts` 全部转绿（含 T007 新增 6 组用例），且既有 plugin-build/hook-trust 全量用例零回归。
  依赖：T007。

## W4 — .bak 可观测性

- [x] **T009** [红先行测试] 在 `tests/integration/codex-hooks-install-flow.test.ts` 新增 `describe('🔴 W4 .bak 可观测性（W4）', ...)`（插在既有 `I6：替换用户数据这类警告在 CLI 里是醒目告警` 用例之后），落地 plan §5.5 全部 4 条：
  1. 升版触发 `backup-already-exists` → `stderr` 含该 code 且含真实 `${target}.bak` 路径（改动前被静默吞掉）
  2. 同场景 `stderr` 含 `owned-entry-removed` 且含"核对"提醒用词
  3. `document-not-object-replaced` 场景 → `stderr` 含真实路径，不含占位符 `<目标>.bak`
  4. 复用既有 I6 场景追加断言：`stderr` 不重复出现 `target-missing`/`nothing-to-remove`（死分支收口不引入新噪声）
  验收：改动前代码上跑，用例 1/2/3 按描述失败（红），用例 4 恒真（静态检查，无需红绿区分）。
  依赖：无（可与 T001/T003/T007 并行）。

- [x] **T010** [实现] 按 plan §3.4 + 裁决点 3 改造 `plugins/spec-driver/scripts/install-codex-hooks.mjs`：
  - `renderDiagnostic(diagnostic, backupPath)`：`owned-entry-removed`/`REPLACEMENT_WARNINGS` 分支用 `backupPath ?? '<目标>.bak'` 替换占位符 + `owned-entry-removed` 追加"回滚前请先核对该文件内容"；新增 `backup-already-exists` 专属分支（用 `diagnostic.path` 渲染，不指认来历）；新增 `target-mode-preserve-failed` 分支；通用兜底 `suffix` 追加 `path` 字段
  - `main(argv)`：把死分支 `code !== 'owned-entry-removed'` 替换为显式白名单 `SILENCED_INFO_CODES = new Set(['target-missing', 'nothing-to-remove'])`；诊断打印循环传入 `result.backupPath`
  验收：`npx vitest run tests/integration/codex-hooks-install-flow.test.ts` 中 W4 块 4 用例全部转绿。
  依赖：T009。

## 全量验证与制品收尾

- [x] **T011** [波及确认] 运行 `npx vitest run tests/unit/hook-installer-semantics-parity.test.ts` 与 `npx vitest run tests/unit/codex-hooks-event-gate.test.ts`，确认两文件零断言变化、零回归（与本次改动无交集，仅作确认）。
  依赖：T002、T004、T006、T008、T010 全部完成。

- [x] **T012** [全量验证] 按 plan §7 验证命令序列依次执行并确认零失败：
  ```bash
  npx vitest run tests/unit/codex-hooks-installer.test.ts
  npx vitest run tests/unit/codex-runtime-doctor.test.ts
  npx vitest run tests/unit/hook-installer-semantics-parity.test.ts
  npx vitest run tests/unit/codex-hooks-event-gate.test.ts
  npx vitest run tests/integration/codex-hooks-install-flow.test.ts
  npx vitest run
  npm run build
  npm run test:plugins
  npm run repo:check
  npm run release:check
  ```
  验收：全部命令 exit 0，无失败用例。
  依赖：T011。

- [x] **T013** [制品收尾] 对本次四文件生产改动（`codex-hooks-installer.mjs` / `validate-codex-hooks.mjs` / `codex-runtime-doctor-io.mjs` / `install-codex-hooks.mjs`）做提交前对抗审查（依 `CLAUDE.local.md` 当前暂停规则，改用独立子代理异构对抗，≥2 个切入角：权限/合并破坏面、诊断误报面）；修复所有 critical/warning 级发现后，在 commit message 中标注「Codex 审查暂停，异构档位缺席」并记录审查结论；确认 fix-report.md「F240 审查原始记载对账」表与本次实现一致，无需更新 `specs/products/spec-driver/current-spec.md`。
  依赖：T012。

## FR / 条目覆盖映射表

| 条目 | 红先行测试任务 | 实现任务 | plan 对应章节 |
|------|--------------|---------|--------------|
| W3 权限位保全 | T001 | T002 | §3.1、§4 裁决点 1、§5.1 |
| W1a 比较语义豁免 | T003 | T004 | §3.2、§5.2 |
| W1b 移除清单一等化 | T005 | T006 | §3.1+§3.2、§4 裁决点 2、§5.3 |
| W2 词法扫描形态清单 | T007 | T008 | §3.3、§5.4 |
| W4 .bak 可观测性 | T009 | T010 | §3.4、§4 裁决点 3、§5.5 |
| 全量回归 + 制品收尾 | — | T011-T013 | §7 |

## 依赖与并行说明

- T001/T003/T007/T009（四组红先行测试）互相独立、可并行执行（不同 describe 块，插入位置互不重叠）。
- 每组内部实现任务（T002/T004/T006/T008/T010）必须等对应红先行测试任务完成且确认为红后才能开始。
- T006（W1b 实现）与 T002（W3 实现）同触碰 `codex-hooks-installer.mjs`，建议顺序执行避免编辑冲突；T004/T006 同触碰 `validate-codex-hooks.mjs`，同理顺序执行。
- T008（W2）与 T010（W4）分别独占各自文件，可与其他组并行。
- T011→T012→T013 为收尾链，必须在全部五组（T002/T004/T006/T008/T010）完成后串行执行。
- 推荐实现顺序：W3 → W1a → W1b（W1b 依赖 W1a 的 `checkForeignPreservation` 改造上下文）→ W2 → W4 → 收尾。
