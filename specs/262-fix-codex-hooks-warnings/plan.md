# 修复规划 — F262 Codex hooks installer 权限位放宽 + doctor/保全判据三处误报收口

> Fix 模式精简规划。设计裁决的唯一事实源是 `fix-report.md`「修复策略 · 方案 A（对抗审查后定稿）」，
> 本文件不复述其推理过程，只把定稿方案落到逐文件逐函数的实现细节 + 四个明确留给 plan 的裁决点 +
> 红先行测试清单。**本卡不动 `src/`**（Claude 侧问题群已分流独立候选卡）。

## 0. 范围与非目标

- 范围：`plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`、
  `plugins/spec-driver/scripts/validate-codex-hooks.mjs`、
  `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`、
  `plugins/spec-driver/scripts/install-codex-hooks.mjs`，以及对应测试文件。
- 非目标：不重构 `codex-runtime-doctor-io.mjs` 的整体结构（见 §1 Codebase Reality Check 的裁决）；
  不动 `src/hooks/hook-installer.ts` / `src/utils/atomic-write.ts`（同源分流，登记 dogfooding ledger）；
  不新增 CLI flag；不改变退出码合同。

## 1. Codebase Reality Check

| 文件 | LOC（改动前）| 导出函数数 | 已知 debt | 本次预估新增/改动行数 |
|---|---|---|---|---|
| `codex-hooks-installer.mjs` | 449 | 8 | 无 TODO/FIXME；无 >200 行函数 | ~35 行（`writeJsonAtomic` 改造 + `reportRemovedCommands` 签名扩展 + `installCodexHooks` 返回值扩展） |
| `validate-codex-hooks.mjs` | 296 | 3（`runValidation`/`EXIT_*`）| 无 | ~35 行（新增 `isPlainObject` + `exemptEmptyEventKeys` + `readDesiredCommands` 第三形态分支） |
| `codex-runtime-doctor-io.mjs` | 834 | 1（`runDoctor`）| 无 TODO；文件整体偏长但由「四方 × 两产品 × 5 探针」矩阵的广度决定，非局部腐化 | ~90 行（新增 `stripTomlComment` + 多行字符串状态机 + `normalizeTomlLines` 共享管线；`parsePluginRegistry`/`hasHooksStateSection` 改为消费该管线） |
| `install-codex-hooks.mjs` | 209 | `run`/`EXIT_*`/`HOOK_TRUST_NOTICE` | 无 | ~25 行（`renderDiagnostic` 签名扩展 + 新分支 + 死分支收口） |

**前置清理规则复核**：`codex-runtime-doctor-io.mjs`（834 LOC > 500）本次新增 ~90 行，触及"LOC>500 且新增>50 行"的字面阈值，但裁定**不追加前置 cleanup task**，理由：
1. 该文件的体量来自"四方一致性 × 两产品 × 5 探针"矩阵的固有广度（`buildRepoVersionCheck`/`buildGlobalCliCheck`/`buildPluginBuildCheck`/`buildMcpServerCheck`/`buildHookTrustCheck` 五段各自独立、职责清晰），不是局部腐化堆积；
2. 本次改动**局部收敛**在 `parsePluginRegistry` / `hasHooksStateSection` 两个函数 + 2 个新增私有辅助函数，不触碰其余 5 个 `build*Check` 段；
3. `fix-report.md` 已完成两路异构对抗审查定稿，重新引入"顺带重构"会扩大验证面、违反 fix 模式"最小化变更范围"的明确指令；
4. 无循环依赖、无超长函数（改动后最长的 `normalizeTomlLines` 预计 ~25 行）。

## 2. Impact Assessment

- **直接修改文件**：4 个生产 `.mjs` + 4 个测试文件（2 个新增 describe 块所在的既有单测/集成测试文件不新增文件本体）。
- **下游调用方**：
  - `install-codex-hooks.mjs` ← `codex-skills.sh install/remove --global`（只消费退出码，不解析 stdout JSON 字段 → 新增 `removedCommands` 字段对其无影响）。
  - `validate-codex-hooks.mjs` ← 无生产脚本调用方（仅测试 + 人工诊断用途）。
  - `codex-runtime-doctor-io.mjs::runDoctor` ← `codex-runtime-doctor.mjs`（唯一消费方，只用导出的 `runDoctor`；`parsePluginRegistry`/`hasHooksStateSection` 未导出，改动零外部可见面）。
- **跨包影响**：0（全部在 `plugins/spec-driver/scripts/` 内，不涉及 `src/`）。
- **数据迁移 / schema 变更**：无。`hooks.json`/`config.toml` 均为读取/合并写入现有格式，不改变文件 schema。
- **API / 契约变更**：`installCodexHooks()` 返回值新增 `removedCommands: string[]` 字段（纯新增，向后兼容）；`validate-codex-hooks.mjs --desired` 新增可识别的第三种文档形态（纯新增，旧两形态不变）；退出码合同不变。
- **风险等级：LOW**（影响文件 4 个生产文件 < 10；跨包影响 0；无数据迁移；仅新增可选字段/可选输入形态，不修改必需契约）。按规则 LOW 不要求强制分阶段实现，单阶段交付。

## 3. 变更清单（逐文件逐函数）

### 3.1 `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`（W3 + W1b）

| 函数 | 改动 |
|---|---|
| `writeJsonAtomic(filePath, data)` → `writeJsonAtomic(filePath, data, { diagnostics = [] } = {})` | 1) 写 tmp 前 `statSync(filePath).mode & 0o7777` 读原权限（try/catch，任何失败含 ENOENT → 默认 `0o600`）；2) `fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })`（tmp 创建即最严格权限，umask 只会更严不会更松，消除内容以 0644 暴露的窗口）；3) `chmodSync(tmpPath, targetMode)` 精确化，包一层独立 try/catch：失败时**不**抛错、**不**清理 tmp、**不**中断安装，push `{level:'warning', code:'target-mode-preserve-failed', errno}` 到 `diagnostics` 后继续 `renameSync`（见裁决点 1）；4) 外层 try/catch（写 tmp / rename 失败）逻辑不变，失败仍清理 tmp 并 rethrow；5) TOCTOU（stat 与 rename 之间目标 mode 被并发修改）在注释显式承认，不做补偿 |
| `commit({targetPath, exists, nextDoc, diagnostics})` | `writeJsonAtomic(writeTarget, nextDoc)` → `writeJsonAtomic(writeTarget, nextDoc, { diagnostics })`（透传同一个数组引用，chmod 失败诊断汇入已有的 diagnostics 通道） |
| `reportRemovedCommands(diagnostics, removedCommands, reinstatedCommands=[])` | 由 `void` 改为**返回**"本轮真正消失（未被重新写回）"的 command 数组（原逻辑不变，只是把已经算出来的 `trulyRemoved` 显式 return，而非只 push diagnostics 后丢弃） |
| `installCodexHooks({codexHome, entries})` | 1) 捕获 `reportRemovedCommands(...)` 的返回值为 `removedCommands`；2) 早退分支（`!changed`）与最终 return 均在返回对象里新增 `removedCommands` 字段（数组，可能为空），字段顺序紧跟 `writtenCommands` 之后，与 `removeCodexHooks` 的 `removedCommands` 同名同形（`string[]`），对齐"移除清单一等化"要求 |
| `removeCodexHooks(...)` | `reportRemovedCommands(diagnostics, stripped.removedCommands)` 调用点不变（忽略新返回值，原有 `removedCommands: stripped.removedCommands` 字段不变，因为卸载路径不存在"重新写回"，过滤前后集合恒等）|

### 3.2 `plugins/spec-driver/scripts/validate-codex-hooks.mjs`（W1a + W1b）

| 函数 | 改动 |
|---|---|
| 顶部 import | 从 `./lib/codex-hooks-installer.mjs` 追加导入 `RAW_DOCUMENT_KEY, RAW_HOOKS_KEY` |
| 新增 `isPlainObject(value)`（模块内私有） | 与 installer.mjs 同定义（`typeof === 'object' && !== null && !Array.isArray`），本文件此前没有这个判据，新增 |
| 新增 `exemptEmptyEventKeys(beforeProjected, afterProjected, afterDoc)` | 见 §4 裁决点 2 的算法描述；纯函数，不改动入参，返回 `[before, after]` 元组 |
| `checkForeignPreservation(baselineFile, targetDoc, desiredFile)` | `const before = JSON.stringify(projectForeignOnly(baselineDoc))` / `after` 两行改为：先各自 `projectForeignOnly`，再过 `exemptEmptyEventKeys(..., targetDoc)`，最后才 `JSON.stringify`。其余逻辑（`allowedToDisappear`/`survivors`/`lostCommands` 命令字面量口径）**不动**——这条口径本就与投影正交，W1a 只改投影侧比较语义 |
| 新增 `isInstallResultShape(parsed)` / `collectInstallResultCommands(parsed)`（模块内私有） | 见 §4 裁决点 2 |
| `readDesiredCommands(file)` | 在"数组字符串"分支之后、`collectCommandLiterals(parsed)` 兜底之前插入：`if (isInstallResultShape(parsed)) return collectInstallResultCommands(parsed);`。旧两形态（字符串数组 / `{hooks:{...}}` 文档）判断顺序与行为完全不变 |

### 3.3 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`（W2）

| 函数 | 改动 |
|---|---|
| 新增 `stripTomlComment(rawLine)`（模块内私有） | 单/双引号互斥跟踪 + **双引号内 `\` 转义感知**（`inDouble && ch === '\\'` 时把反斜杠与下一字符一并原样保留、跳过、不触发引号 toggle）；单引号内反斜杠不做特殊处理（TOML 字面量字符串无转义语义，与 spec 一致）。**不复用** `simple-yaml.mjs` 的 `stripYamlComment`（后者无转义感知，照抄会在 `[mcp_servers."a\"b"] # note` 形态下失败——这是本修复自身需要规避的教训，见 fix-report 根因链） |
| 新增 `createMultilineStringTracker()` | 闭包持有 `kind: null | 'triple-double' | 'triple-single'`；`consumeLine(rawLine)` 返回"该行**起始**时是否已处于多行字符串内部"（`startedInsideString`），并在函数内根据本行出现的 `"""`/`'''` 序列更新状态供下一行使用。每行独立调用一次，状态只跨行传递（不跨文件，`tomlText` 每次 `parsePluginRegistry`/`hasHooksStateSection` 调用各自新建 tracker） |
| 新增 `normalizeTomlLines(tomlText)` | 共享的行规范化管线：对每行，先用 tracker 判断是否整行处于多行字符串内部（是则 `{text:'', headerName:null, isArrayTable:false}`，即"串内行不参与任何段头/键值判定"）；否则 `stripTomlComment` 剥注释 → `trim()` → 依次尝试 `/^\[\[([^\]]+)\]\]$/`（数组表，`isArrayTable:true`）与 `/^\[([^\]]+)\]$/`（普通表，`isArrayTable:false`）；均不匹配则 `headerName:null`。返回 `Array<{text, headerName, isArrayTable}>` |
| `parsePluginRegistry(tomlText)` | 改为遍历 `normalizeTomlLines(tomlText)`：`headerName !== null` 时，**仅当 `!isArrayTable`** 才尝试 `/^plugins\."([^"]+)"$/` 注册为 entry；否则（含 `isArrayTable === true` 的情形，即便内容形如 `plugins."x@m"`）一律 `current = null`（重置段边界但不注册——`[[plugins."x@m"]]` 语义上是数组表，[推断] Codex 侧预期反序列化失败，absent 与事实同向）。非 header 行沿用原 `enabled = true` 精确匹配逻辑，只是判定对象从 `line`（原始 trim）换成 `text`（已剥注释） |
| `hasHooksStateSection(tomlText)` | 改为遍历 `normalizeTomlLines(tomlText)`：`headerName !== null` 时用**收窄后**的正则 `/^hooks\.state(\.|$)/`（原 `/^hooks(\.|$)/`）判断，`[[x]]` 与 `[x]` 一视同仁（不像 `parsePluginRegistry` 那样区分 `isArrayTable`，因为这里只是"存在性"探测不是"注册"）|

**不支持形态清单**（沿用 fix-report 已定稿边界，本次在模块头部注释显式列出，非代码逻辑变更）：段头内侧空白 `[ plugins."x@y" ]`、literal string 键 `[plugins.'x@y']`、点分键 `plugins."x@y".enabled`、无 `@marketplace` 段、名含多个 `@`——全部落 `absent → indeterminate`（方向安全）。

### 3.4 `plugins/spec-driver/scripts/install-codex-hooks.mjs`（W4）

| 函数 | 改动 |
|---|---|
| `renderDiagnostic(diagnostic)` → `renderDiagnostic(diagnostic, backupPath)` | 1) `owned-entry-removed` 分支：`<目标>.bak` 替换为 `backupPath ?? '<目标>.bak'`（理论上此诊断出现时 backupPath 必已存在，`??` 仅作防御性兜底）；文案追加"回滚前请先核对该文件内容"提醒（升版路径一次会刷多条该诊断，且 `.bak` 可能早于用户近期手工改动，盲目整份回滚会丢改动）；2) `REPLACEMENT_WARNINGS` 分支：同样把 `<目标>.bak` 替换为 `backupPath ?? '<目标>.bak'`；3) 新增 `backup-already-exists` 专属分支：用 `diagnostic.path`（该诊断自带的真实路径，见 `codex-hooks-installer.mjs:255` 已有的 `{level:'info', code:'backup-already-exists', path: backupPath}`）渲染"`${diagnostic.path}` 已存在，本次未覆盖；本工具仅在 `.bak` 不存在时创建备份（保留最早一份），不随每次写入刷新"——**不指认**这份 `.bak` 的来历；4) 新增 `target-mode-preserve-failed` 分支：渲染权限位保全失败的告警（含 `diagnostic.errno`），说明"内容已正常写入，仅原有权限位未能恢复，请手动核对"；5) 通用兜底分支 `suffix` 追加 `${diagnostic.path ? \` path=${diagnostic.path}\` : ''}`，避免除上述专属分支外，其余带 `path` 字段的诊断被裁掉信息 |
| `main(argv)` 内诊断打印循环 | 把 `if (diagnostic.level === 'info' && diagnostic.code !== 'owned-entry-removed') continue;`（死分支，`owned-entry-removed` 恒为 warning 从未命中过例外）替换为显式白名单：`const SILENCED_INFO_CODES = new Set(['target-missing', 'nothing-to-remove']); ... if (diagnostic.level === 'info' && SILENCED_INFO_CODES.has(diagnostic.code)) continue;`（这两个 code 的语义已被 stdout 侧的成功文案覆盖，保持静默避免重复噪声；`backup-already-exists` 不在白名单内 → 不再被吞掉）；`console.error(renderDiagnostic(diagnostic))` → `console.error(renderDiagnostic(diagnostic, result.backupPath))` |

## 4. 四个裁决点的定案与理由

### 裁决点 1 — W3 chmod 失败容忍策略

**定案：降级继续（不是硬失败）**，diagnostic code 定为 `target-mode-preserve-failed`（level: `warning`）。

理由：
- 无权限位文件系统（exFAT / SMB / 某些容器 overlay）上"权限被放宽"这个风险面本就不存在——chmod 在这类文件系统上失败是预期内噪声，不是数据安全问题；
- 调用方 `codex-skills.sh` 对本脚本非零退出本就"仅告警不阻断"（退出码合同 `1 = 一般失败，仅告警`），如果让 chmod 失败硬中断整个安装（`installCodexHooks` 抛错），反而**新增**一个此前不存在的阻断面——用户的 hooks 条目本可以正常写入，却因为一个权限元数据的锦上添花失败而完全装不上；
- 内容原子性（tmp+rename）与权限位保全是两个独立维度，前者失败必须硬失败（`writeJsonAtomic` 外层 try/catch 不变），后者失败应可降级——这与"目标是别人的文件，除我方条目外一个字节都不动"的第一不变量不冲突：chmod 失败时内容仍然正确写入，只是**没有变得更差**（tmp 从创建起就是 0600，即使 chmod 失败，最终文件权限也不会比 0600 更宽，只是没有精确匹配到原文件可能存在的更严格权限如 setgid 位）。

穿参方式：`writeJsonAtomic` 增加第三参数 `{ diagnostics = [] }`，`commit()` 把自己已持有的 `diagnostics` 数组透传下去（同一数组引用，push 即可见），无需新建返回通道或改变 `installCodexHooks`/`removeCodexHooks` 现有的 diagnostics 聚合方式。

### 裁决点 2 — W1b 数据形状

**installer 返回值字段名：`removedCommands: string[]`**（与 `removeCodexHooks` 的同名字段形状完全一致：本轮真正消失、未被重新写回的 command 字面量数组）。实现上通过让内部函数 `reportRemovedCommands` 把它已经算出的"排除 reinstated 后的真实移除集合"显式 return 出来，而不是新增重复计算逻辑。

**validate 的 `--desired` 第三形态识别**：新增 `isInstallResultShape(parsed)` 判据——

```js
function isInstallResultShape(parsed) {
  return (
    isPlainObject(parsed) &&
    Array.isArray(parsed.writtenCommands) &&
    (parsed.removedCommands === undefined || Array.isArray(parsed.removedCommands))
  );
}
```

命中时用 `collectInstallResultCommands(parsed)` 取 `writtenCommands ∪ removedCommands`（去重后的字符串数组）作为减数。

**向后兼容路径**：`readDesiredCommands` 判断顺序为 `字符串数组 → isInstallResultShape → 兜底 collectCommandLiterals`。旧的 `{hooks:{...}}` 生成器文档形态没有 `writtenCommands` 字段（顶层只有 `hooks`），`isInstallResultShape` 恒为 false，天然落到原有 `collectCommandLiterals(parsed)` 分支，行为完全不变；纯字符串数组形态在第一个分支就已返回，同样不受影响。

**豁免边界**：`isOwnedEntry` 判据本身**绝不**被用来自动豁免 baseline 命令——`removedCommands` 只是"写入器自己声明本轮删了什么"，不等于"这些删除都是合法的"，判据 2（`foreign-command-lost`）依然只认写入器的自我声明，误认（第三方条目被错误认领后删除）仍然会被写入器自己记进 `removedCommands`（因为归属误认时 `stripOwnedHandlers` 一样会把它摘掉、`reportRemovedCommands` 一样会把它记进 diagnostics 和现在的返回值），从而如实出现在 `--desired` 里——这**不是**放宽判据、而是让"写入器自曝了什么"这件事本身更容易被消费方拿到并交叉核对，判据 2 检出"归属误认误删"的能力不受影响（详见 §5 M1/RAW 红先行测试）。

### 裁决点 3 — W4 文案落点

**定案：只改模块级注释 + CLI 输出文案，不新增 README/SKILL 章节。**

核实过程：`grep -rn '\.bak' plugins/spec-driver` 命中 7 个文件，其中生产代码 4 个（本次改动范围内）、测试 3 个；唯二命中的 `SKILL.md`（`spec-driver-doc`）里的 `.bak` 是该 skill **自己的文档覆盖备份机制**（`cp {fileName} {fileName}.bak`），与 Codex hooks 安装器的 `.bak` 无关联、无需同步。仓库根 `README.md` 与 `plugins/spec-driver/README.md` 均未提及 `codex-hooks-installer` 或其 `.bak` 语义。结论：**没有需要同步的 README/SKILL 章节**，`.bak` 语义与 W2 不支持形态清单的说明落点维持在两处模块头部注释（`codex-hooks-installer.mjs` 已有的头部注释段 + `codex-runtime-doctor-io.mjs` 新增的段头判据注释）。

### 裁决点 4 — 测试组织

**定案：新增断言一律落在既有测试文件内，不新建测试文件。**

| 回归护栏组 | 落点文件 | describe 块 |
|---|---|---|
| W3（0600 保全 / 0o7777 高位 / 首创建 0600 / tmp 无 0644 窗口 / chmod 降级） | `tests/unit/codex-hooks-installer.test.ts` | 新增 `describe('(h) 权限位保全（W3）', ...)`，插在既有 `(e) 写入前备份` 之后、`owned-entry-removed 诊断` 之前（同属 `commit()`/`writeJsonAtomic` 路径，主题相邻） |
| W1a（FP 消除 + M1 变异检出 + RAW 槽检出） | `tests/integration/codex-hooks-install-flow.test.ts` | 新增 `describe('🔴 W1a 第三方保全比较语义豁免：用户预存空数组事件键不误报', ...)`，插在既有 `🔴 C1 第三方数据保全门禁` 块之后（同属 `checkForeignPreservation` 主题） |
| W1b（install --json 完整输出作 --desired / 不传时仍最严格） | `tests/integration/codex-hooks-install-flow.test.ts` | 新增 `describe('🔴 W1b 升版路径：--desired 直接消费 install --json 完整输出', ...)`，紧邻上一条之后 |
| W2（6 组 fixture：行尾注释错归属 / `\"` 转义 / `[[array]]` 泄漏 / FORM-D / FORM-E / `[hooks]` 收窄）| `tests/unit/codex-runtime-doctor.test.ts` | 前 5 组新增 `describe('F262 / W2 — config.toml 词法扫描形态清单', ...)`，插在既有 `plugin-build check` 系列用例（现第 193-343 行）之后、`按产品分组的比较矩阵` 之前；`[hooks]` 收窄这 1 组追加进既有 `F240 T048 — hook-trust 四情形固定状态值` describe 块（同属 hook-trust 主题） |
| W4（backup-already-exists 可见 + 真实路径 + 回滚提醒 + 死分支收口）| `tests/integration/codex-hooks-install-flow.test.ts` | 新增 `describe('🔴 W4 .bak 可观测性（W4）', ...)`，插在既有 `I6：替换用户数据这类警告在 CLI 里是醒目告警` 用例之后（同属 CLI 输出可观测性主题） |

**W2 fixture 组内联（不建独立 fixture 文件）**：全部 TOML 片段用 `configToml: [...].join('\n')` 内联字符串传入既有 `makeFixture()` 辅助函数（该函数已支持 `configToml` 选项），与文件内现有 6+ 处用法风格一致；不新建 `tests/fixtures/*.toml`——片段均在 5-8 行以内，内联可读性优于跳转外部文件，且避免为一次性回归钉子新增需要长期维护的 fixture 资产。

## 5. 测试计划（红先行清单，逐条对应回归护栏）

> 全部用例先在当前代码（改动前）验证为**红**（复现 fix-report 描述的误报/放宽），再实现修复使其转绿。

### 5.1 W3 — `tests/unit/codex-hooks-installer.test.ts` 新增 `(h)` 块

| # | 用例 | 断言 | 对应护栏 |
|---|---|---|---|
| 1 | 目标原有权限 0600，写入后保全 | `fs.statSync(target).mode & 0o777 === 0o600`（改动前会是 0o644）| 0600 保全 |
| 2 | 目标原有 setgid 高位权限（`chmodSync(target, 0o2640)`），写入后保全 | `fs.statSync(target).mode & 0o7777 === 0o2640` | 0o7777 高位保全 |
| 3 | 目标不存在（首次创建），`process.umask(0o000)` 模拟宽松 umask | `fs.statSync(target).mode & 0o777 === 0o600`（改动前 umask 000 下会是 0o666，世界可写）| 首创建 0600 |
| 4 | spy `fs.writeFileSync`，断言写 tmp 那次调用的 `options.mode === 0o600` | tmp 调用参数包含 `{mode: 0o600}` | tmp 全程无 0644 窗口 |
| 5 | mock `fs.chmodSync` 抛错（`ENOTSUP`），断言安装仍成功、内容仍正确写入、`diagnostics` 含 `target-mode-preserve-failed` | `result.ok===true`、`result.changed===true`、`ownedHandlers(...).length===5`、diagnostics 命中 | chmod 降级容忍（新增，非 fix-report 逐字列出但属"实现细节"必要覆盖） |

### 5.2 W1a — `tests/integration/codex-hooks-install-flow.test.ts` 新增 W1a 块

| # | 用例 | 断言 | 对应护栏 |
|---|---|---|---|
| 1 | baseline=`{hooks:{Stop:[]}}`，`installCli` 写入四事件后 `--baseline` 校验 | `report.foreignPreservation.projectionEqual === true`（改动前为 `false`，`foreign-entries-mutated` 会出现）；`lostCommands` 为空 | FP 消除 |
| 2 | 手工构造 baseline=`{hooks:{Stop:[], PermissionRequest:[foreign]}}`，target=`{hooks:{PermissionRequest:[foreign]}}`（模拟"安装器把用户空键整个删掉"）| `report.foreignPreservation.projectionEqual === false`；`findings` 含 `foreign-entries-mutated` | M1 变异检出保持 |
| 3 | baseline=`{hooks:[{foo:1}]}`（数组形态，RAW 槽），target=`{hooks:[{foo:2}]}` | `report.foreignPreservation.projectionEqual === false`；`findings` 含 `foreign-entries-mutated` | RAW 槽检出保持 |

### 5.3 W1b — 同文件新增 W1b 块

| # | 用例 | 断言 | 对应护栏 |
|---|---|---|---|
| 1 | 首次 `installCli(['--json'])` 后以其文档为 baseline；再用 `--plugin-root UPGRADED_PLUGIN_ROOT --json` 升版安装，把**完整** `stdout` 落盘作 `--desired` | `validate --baseline <首次文档> --desired <完整升版结果> --skip-shape` → `report.foreignPreservation.lostCommands` 为空，`exitCode===0`（改动前旧路径命令会被判丢失）| install --json 输出直接作 --desired → 零误报 |
| 2 | 同一升版场景，**不传** `--desired` | `exitCode===1`，`findings` 含 `foreign-command-lost`（回归钉子：新增第三形态不放宽默认最严格口径）| 不传 --desired 仍最严格口径 |

（两条均加 `--skip-shape`，因 `UPGRADED_PLUGIN_ROOT` 是虚构路径、脚本文件不存在，避免无关的 `owned-command-target-missing` 干扰断言目标。）

### 5.4 W2 — `tests/unit/codex-runtime-doctor.test.ts` 新增块

| # | fixture（TOML 片段）| 断言 | 对应护栏 |
|---|---|---|---|
| 1 | `[plugins."spec-driver@m"]\nenabled=false\n\n[plugins."spectra@m"] # comment\nenabled=true`，为 spectra 预置真实快照 | `plugin-build.spectra.status==='ok'`；`plugin-build.spec-driver.status==='indeterminate'`（改动前 spectra 段头被注释吞掉，spectra 判 `indeterminate`，且泄漏可能把 spec-driver 误标 enabled）| 行尾注释跨产品错归属（主锚点）|
| 2 | `[plugins."spec-driver@m"]\nenabled=false\n\n[mcp_servers."a\"b"] # note\nenabled=true`，为 spec-driver 预置一个**旧版本**快照（`3.0.0`）| `plugin-build.spec-driver.status==='indeterminate'`（若转义处理有误，`enabled=true` 泄漏会让它读到旧快照 `3.0.0` 与仓库版本不符，误判 `fail`）| `\"` 转义 |
| 3 | `[plugins."spec-driver@m"]\nenabled=false\n\n[[profiles.batch]]\nenabled=true`，同样预置旧版本快照 | `plugin-build.spec-driver.status==='indeterminate'`（同上机制，`[[x]]` 不应重新点燃前一段）| `[[array]]` 泄漏 |
| 4 | `[plugins."spec-driver@m"]\nenabled=false\ndescription="""\nenabled=true\n"""`，同样预置旧版本快照 | 同上：`status==='indeterminate'` | FORM-D 多行串值泄漏 |
| 5 | `[plugins."spec-driver@m"]\nenabled=false\nnotes="""\n[plugins."spectra@evil-market"]\nenabled=true\n"""`，为 `evil-market/spectra` 预置一个假快照（`9.9.9`）| `plugin-build.spectra.status==='indeterminate'`（不应等于 `fail`：幻影段不得被注册为真实 entry）| FORM-E 多行串幻影段 |
| 6（追加进既有 hook-trust 块）| `configToml: '[hooks]\nsome_feature = true\n'`，`hooksJson` 存在 | `hook-trust.status==='warning'`、`trustStatus==='untrusted'`、`remediation.code==='grant-hook-trust'`（改动前会被判 `indeterminate`，因为旧正则把裸 `[hooks]` 误当信任记录段）| `[hooks]` 产品段不再误判 hooks.state |

用例 2-5 均用"预置一个明显与仓库版本不符的旧/假快照"这个统一手法，把"段头解析是否被污染"转成"最终状态是 `indeterminate` 还是 `fail`/`ok`"的强判别信号（而不是弱信号如"absent 也可能仅仅因为没查到"），避免假阳性通过。

### 5.5 W4 — `tests/integration/codex-hooks-install-flow.test.ts` 新增块

| # | 用例 | 断言 | 对应护栏 |
|---|---|---|---|
| 1 | 首次安装产生 `.bak`；升版安装（`UPGRADED_PLUGIN_ROOT`）触发 `backup-already-exists` | `stderr` 含 `backup-already-exists` 且含真实 `${target}.bak` 路径（改动前该诊断被静默吞掉，`stderr` 不含该 code）| backup-already-exists 不再静默 + 真实路径 |
| 2 | 同上场景 | `stderr` 含 `owned-entry-removed` 且含"核对"一类提醒用词 | 回滚指引微调 |
| 3 | 目标文件顶层写成数组触发 `document-not-object-replaced` | `stderr` 含真实 `${target}.bak` 路径，**不**含字面量占位符 `<目标>.bak` | 真实路径替换占位符 |
| 4 | 复用既有 I6 用例场景，追加断言 `stderr` **不**重复出现 `target-missing`/`nothing-to-remove` 字样（若原本没触发这两个 code 则此断言恒真，仅作静态检查） | 死分支收口不引入新噪声 | 收掉 L196 死分支且不放宽为"全部 info 都打印" |

## 6. 回归风险评估

| 风险 | 评估 | 缓解 |
|---|---|---|
| W3 chmod 精确化在 CI 容器 / 沙箱环境里可能因权限受限而抛错 | 已被裁决点 1 的"降级继续"策略覆盖：任何 chmod 失败都不阻断安装，只记诊断 | 红先行用例 5 直接 mock chmod 失败验证降级路径 |
| W1a 的键级豁免逻辑被误用为掩盖真实数据丢失的通道 | 豁免条件严格限定"baseline 侧值为空数组 **且** 该键在 after 原始文档物理存在"，且显式排除 `RAW_*_KEY` 槽；命令字面量口径（`lostCommands`）完全不受影响，双重口径不因此减弱 | M1/RAW 两条红先行测试专门钉死"豁免不越界" |
| W1b 新增 `--desired` 第三形态误吞旧调用方 | `isInstallResultShape` 判据要求 `writtenCommands` 必须是数组这一独有特征，旧 `{hooks:{...}}` 文档结构上不可能满足；判断顺序把字符串数组放在最前，三形态互斥 | 无需新增专门测试，现有 C1 系列用例（用 `writtenCommands` 单字段数组作 `--desired`）继续覆盖字符串数组形态；W1b 新增用例覆盖完整 result 对象形态 |
| W2 词法管线重写引入新的漏报/误报（F259 同类教训：枚举式判据每多一种真实形态漏一次）| 已在模块注释显式列出"不支持形态清单"，全部落 `absent → indeterminate`（安全方向）；多行字符串状态机与注释剥离各自独立、职责单一，便于审查 | 5 组 W2 fixture 覆盖 fix-report 点名的全部已知形态；不支持形态清单作为已知边界登记，不在本次测试范围内苛求覆盖（其安全性来自"方向"而非枚举） |
| `install-codex-hooks.mjs` 死分支收口后，之前依赖"info 全部静默"的隐性行为被打破 | 排查确认唯二会被新代码改变可见性的 info code 是 `backup-already-exists`（本卡明确要求可见）；`target-missing`/`nothing-to-remove` 仍在白名单内静默，不引入噪声 | 红先行用例 4 做静态防回归检查 |
| `codex-runtime-doctor-io.mjs` 内部重构（`parsePluginRegistry`/`hasHooksStateSection` 消费新管线）影响其余未改动的探针（`codex-cli-help`/`codex-doctor-checks`/`codex-home-paths`/`app-server-rpc`）| 这 4 个探针不读 `config.toml`，与本次改动完全解耦 | 既有全部 `plugin-build`/`hook-trust` 用例（改动前已通过）作为回归网，运行 `npx vitest run tests/unit/codex-runtime-doctor.test.ts` 全量验证零回归 |
| `hasHooksStateSection` 判据收窄（`^hooks(\.|$)` → `^hooks\.state(\.|$)`）可能让此前误判为 `present-unconfirmed` 的某些真实生产配置改判 `absent` | 属故意行为修正（`[hooks]` 是 Codex 产品特性段，非信任记录段），T062（信任记录位置未确证）挂账不受影响——`indeterminate` 与 `absent` 的下游 remediation 都不会假设"已信任" | 既有 `[hooks.state]` 用例（第 823-843 行）验证收窄不影响真正的信任记录段识别 |

**总体风险等级：LOW**（与 §2 Impact Assessment 一致）。四处改动彼此正交（W3 只碰 `commit()`/`writeJsonAtomic` 路径；W1a/W1b 只碰 `checkForeignPreservation`/`readDesiredCommands`；W2 只碰 `parsePluginRegistry`/`hasHooksStateSection`；W4 只碰 `renderDiagnostic`/诊断打印循环），无交叉依赖，可独立验证、独立回滚。

## 7. 验证命令序列

```bash
# 1. 单测（含新增 W3/W1a/W1b/W2 用例）
npx vitest run tests/unit/codex-hooks-installer.test.ts
npx vitest run tests/unit/codex-runtime-doctor.test.ts
npx vitest run tests/unit/hook-installer-semantics-parity.test.ts   # 波及确认：无断言变化，只验证零回归
npx vitest run tests/unit/codex-hooks-event-gate.test.ts            # 波及确认：与本次改动无交集，验证零回归
npx vitest run tests/integration/codex-hooks-install-flow.test.ts   # 含新增 W1a/W1b/W4 用例

# 2. 全量单测 + 构建 + 插件测试 + repo/release 校验（运行时上下文规定的验证链，零失败）
npx vitest run
npm run build
npm run test:plugins
npm run repo:check
npm run release:check
```

红先行验证顺序（implement 阶段执行）：先在改动前的代码上跑一遍 §5 全部新增用例，确认按护栏描述全部失败（红）；再按 §3 变更清单实现；再重跑确认全部转绿；最后跑第 2 步全量命令序列。
