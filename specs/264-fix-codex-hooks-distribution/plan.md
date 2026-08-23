# 修复规划 — Codex hooks 分发纠偏（卡面 F265 / 仓内编号 264）

> 输入：`specs/264-fix-codex-hooks-distribution/fix-report.md`（全部实测事实与推荐方案 A，已锁定，不重新论证）+
> `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-B（用户已拍板路线）。
> 本文件只把方案 A 转成**可执行的最小变更清单 + commit 切分 + 验证方案**，不重新设计架构。

## 0. 路线复述（已拍板，不再论证）

插件自带 `plugins/spec-driver/hooks/hooks.json` 为主路径（Codex `plugin add` 后原生发现并展开
`${CLAUDE_PLUGIN_ROOT}`）；全局合并器（`codex-skills.sh install --global` →
`install-codex-hooks.mjs`）降级为 **skills-only 安装的 fallback**，且必须在写入前拒绝"插件已原生
注册同名 hook"的场景（双注册守卫）。项目级 `.codex/config.toml` 路线（spec-kit 形态）记为候选，
本卡**不做**。

## 1. 关键设计决策（fix-report 未展开、plan 阶段必须钉死的实现口径）

### D1 — 双注册守卫判据：不能直接复用 `codex-runtime-doctor-io.mjs` 的 `parsePluginRegistry`

`lib/codex-runtime-doctor-io.mjs:360` 的 `parsePluginRegistry` 已经是一个单遍 TOML 词法扫描器（F262
硬化过，同时处理三引号多行串与注释剥离，避免幻影串错归属），本应是复用首选。但它的 `enabled`
语义是**默认 `false`，只有显式扫到 `enabled = true` 才置真**（`current = { ..., enabled: false }` +
`if (.../enabled\s*=\s*true$/) current.enabled = true`），这是 doctor 自己"保守确认 active"的语义，
消费方 `probeCodexPluginManifest`（L416）用 `.find(item => item.enabled)` 过滤。

守卫需要的判据方向相反：按 fix-report E3 实测，**`enabled` 键缺失时 Codex 仍注册 5 条 hook**——
守卫必须把"表存在 + 未显式 `enabled = false`"都判定为"会双注册"，否则会在 E3 场景下放行合并器、
造成守卫本该拦住的双注册。直接复用 `parsePluginRegistry` 的现有导出会得到相反结论（假阴性）。

**决策**：不改 `parsePluginRegistry` 的既有语义（避免影响 doctor 自身的 4 个消费点与既有测试），
改为：
1. 从 `codex-runtime-doctor-io.mjs` **新增导出** `normalizeTomlLines`（当前模块私有，第 334 行），
   把单遍词法扫描器暴露为可复用的纯函数——避免第三份手写 TOML 解析器（F231/F259 教训：手写解析器
   每次独立实现都会漏判某种形态）。
2. 新建 `plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs`，基于 `normalizeTomlLines`
   自行遍历 `[plugins."<name>@<marketplace>"]` 段，对 `enabled` 采**三态**记录
   （`true` / `false` / `undefined`——即"从未出现过该键"），导出
   `detectNativePluginRegistration({ codexHome, pluginName, marketplaceName })`，判据：
   - 表存在 **且** `enabled !== false`（含 `undefined`）→ `registered: true`（E3 场景）；
   - `enabled === false` → `registered: false`（E2 场景，即使 cache 目录还在）；
   - 表不存在 → `registered: false`（E1 场景，卸载后表与 cache 同时消失）。

### D2 — cache 目录判据只需"存在性"，不追求 doctor 那种"精确 active 快照"

`probeCodexPluginManifest` 要处理"多快照给出不同版本→歧义化"，因为它要回答"哪个版本在跑"；守卫
只需要回答"这个插件的 hooks 是否已经在这台机器上被 Codex 原生发现"，判据可以更宽松（偏保守，宁可
多算一次"已注册"也不误放行）：`plugins/cache/<marketplace>/<name>/` 下任意一个快照子目录含
`hooks/hooks.json`，且该文件解析后含至少一条 `isOwnedEntry` 判真的 handler，即算命中，不判定
"哪个是 active"。

### D3 — 新退出码 + 逃生口，不复用既有码

`install-codex-hooks.mjs` 现有退出码合同：0 成功 / 1 一般失败（仅告警不阻断）/ 3 非法 JSON
（fail-loud 中断）。双注册命中是**第三种性质**——不是失败，是"确认了不需要做"，且必须**中断写入**
（不能像退出码 1 那样"仅告警继续"，因为继续写入正是要拦住的双注册本身）。新增：

- `EXIT_ALREADY_REGISTERED = 4`：检测到原生插件注册，拒绝写入 hooks.json（skills 侧安装不受影响，
  由 `codex-skills.sh` 侧决定如何呈现，见 D4）。
- `--force-hooks`：逃生口，跳过守卫直接走原合并写入路径，服务"Codex 版本老到不读插件 hooks"的
  人工判断；命中时在 stdout/stderr 打印"已跳过双注册检测，如实际已原生注册将产生重复 hook"的
  代价说明。

只有 `action === 'install'` 分支跑守卫；`--remove` 不受影响（用户需要能随时清理历史遗留的合并器
写入的重复条目，不因"现在已原生注册"而拦住卸载）。

### D4 — `codex-skills.sh` 侧新增码 4 的分流 + `--force-hooks` 透传

`run_codex_hooks_cli` 当前只分流码 3（fail-loud exit 1）与非 0 非 3（告警不阻断）。新增码 4 分支：
打印中文指引（"hooks 已由 Codex 原生插件注册生效，无需再跑合并器；如确认当前 Codex 版本不读取
插件内 hooks，可在命令后加 --force-hooks 强制安装"），**不阻断** skills 安装（`return 0`，与现有
非 0 非 3 分支同一"仅告警"语义，只是文案更精确）。顶层参数解析新增 `--force-hooks` case，
`ACTION=install` 且该 flag 置真时透传给 `run_codex_hooks_cli` → `install-codex-hooks.mjs`。

### D5 — handler 级产品层判据：新增 code，不取代既有事件级判据

现状 `validateCodexHooksDocument` 的产品层只判"owned 事件集合恰等于 `CODEX_EVENT_PRODUCT_SET` 四项"
（`product-event-missing` / `product-event-out-of-scope`）。卡面要求：`Stop` 事件存在但缺
`stop-fix-compliance-check.sh` 这一条 handler，也必须判 fail——这是现有判据的**盲区**（事件集合层面
`Stop` 已经"存在"，不会触发 `product-event-missing`）。

**决策**：不删除既有两个 event 级 code（它们仍能抓"整个事件缺失/越界"这一更粗粒度的破坏），
新增 handler 级判据作为**补充**（AND 关系，两层都要过）：

1. `codex-hooks-schema.mjs` 的 `OWNED_HOOK_SCRIPT_SUFFIXES` 目前只是 `[父目录, 文件名]` 二元组，
   不带"期望挂在哪个事件下"的信息。新增一个并列的期望映射表
   `OWNED_HOOK_SCRIPT_EXPECTED_EVENT`（`[父目录, 文件名] → event`），5 条：
   `postinstall.sh→SessionStart`、`pre-tool-use-guard.sh→PreToolUse`、
   `post-tool-use-format.sh→PostToolUse`、`stop-task-check.sh→Stop`、
   `stop-fix-compliance-check.sh→Stop`（后两条同挂 `Stop`，允许一个事件下多条 owned handler）。
2. `validateCodexHooksDocument` 产品层新增一轮校验：对文档中**全部** owned handler，反查其脚本名
   命中的期望 event；命中且实际所在 event 与期望一致 → 通过；命中但挂错事件 → 新 code
   `product-handler-misplaced`（fail）；`checkCommandShape` 开启时，对**期望存在**的 5 条脚本，
   若在全文档 owned handler 集合中一条都没找到 → 新 code `product-handler-missing`（fail）。
   这条判据天然覆盖卡面要求的"`Stop` 存在但缺 `stop-fix-compliance-check.sh`"。
3. `lib/codex-hooks-generator.mjs` 的自检（生成期跑 `validateCodexHooksDocument`）与
   `validate-codex-hooks.mjs` CLI 两处消费方均自动继承新判据，无需改调用点。

### D6 — `SessionEnd` 补入 schema 全集，版本出处必须内嵌注释

`CODEX_EVENT_SCHEMA_SET` 10→11，追加 `'SessionEnd'`，紧邻处补注释：
"0.149.0 changelog 口径；本机 0.144.6 实测该事件名被静默丢弃（fix-report E4），此处只扩展 schema
全集以匹配新版本能力，不代表当前环境已验证"。**不**加入 `CODEX_EVENT_PRODUCT_SET`（我方当前无
`SessionEnd` handler，加入产品集会让下一轮 D5 判据误报"缺失"）。

### D7 — `mcp__plugin_spectra_spectra__*` 命名空间替换 + 窄门禁

**替换点**：`extract-wrapper-body.mjs` 的 `rewriteCodexRuntimeText` 替换表新增一条，把
`mcp__plugin_spectra_spectra__` 前缀相关的整句改写为运行时中立表述（Codex 下无该 MCP 工具命名空间，
改用通用描述"Spectra MCP 工具（`impact` / `context` / `detect_changes` 等）"，去掉 `mcp__` 前缀字面
量）。这是唯一实现点（`codex-skills.sh` 的 `write_skill_body` 已在 F186 T2 收敛为直接调用本 helper，
不存在需要同步改的第二份 sed/awk 实现）。

**连带**：改动后 5 个含该句的 canonical skill（feature/implement/story/fix/refactor）派生的 wrapper
body 字节变化 → 对应 `.codex/skills/*/SKILL.md`（9 个中的这 5 个）与
`plugins/spec-driver/skills-codex/*/SKILL.md`（5 个）的 `Source SHA256` 行必须随 `npm run repo:sync`
重生，否则 `validate-wrapper-sources.mjs` 的 sha256 比对判 fail。

**窄门禁**：新增 check，只扫 `mcp__` 字面量（不复用 `scripts/lib/codex-plugin-consistency-core.mjs`
的 `NEUTRALITY_HARD_MARKER = /Task tool|mcp__|AskUserQuestion|Task\(/`——它连带匹配 `Task tool`，而
wrapper 正文合法保留该短语，见 `extract-wrapper-body.mjs` 的另一条替换"Claude Code 的 Task
tool"→"Task tool（Codex 下子代理执行能力以 …）"，直接复用会对合法文本假阳性）。落点：
`validate-wrapper-sources.mjs` 新增一个 check 函数（与既有 `validateWrapperMarkers` 并列），对
`.codex/skills/*/SKILL.md` 与 `plugins/spec-driver/skills-codex/*/SKILL.md` 两个 root 各扫一遍
`content.includes('mcp__')`，命中即 fail，check id `codex-wrapper-mcp-neutral`。该 check 天然接入
既有 `npm run repo:check` 链路（`validateWrapperSources` 已被 repo-check 消费）。

## 2. 变更清单

| 文件 | 改动点 | 所属 commit | 风险 |
|---|---|---|---|
| `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` | `normalizeTomlLines` 新增 `export`（函数体不变） | 1 | 极低：纯加导出，不改任何调用点行为 |
| `plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs`（新建） | `detectNativePluginRegistration()`：三态 `enabled` 解析 + cache 存在性判据（D1/D2） | 1 | 中：核心判据，误判方向决定"漏拦双注册"还是"误拒合法合并器安装"，需单测覆盖 E1/E2/E3 三态 + 表不存在 + config.toml 不存在/非法 |
| `plugins/spec-driver/scripts/install-codex-hooks.mjs` | `parseArgs` 加 `--force-hooks`；`execute()` 的 install 分支前置守卫调用；新增 `EXIT_ALREADY_REGISTERED`（D3）；`main()` 分流新退出码 + 指引文案 | 1 | 中：改写主入口的控制流；🔴 不得触碰模块头部声明的"该字面量不出现在本文件"的信任绕过 flag 守卫断言（新增代码不得引用它） |
| `plugins/spec-driver/scripts/codex-skills.sh` | `run_codex_hooks_cli` 新增码 4 分支（D4）；顶层参数解析加 `--force-hooks` 并透传；模块头注释补正（"Codex hooks 只有全局位置"前提更正，见 §3） | 1 | 低：新增分支不改变既有码 0/1/3 路径；`--force-hooks` 需 usage 文案同步 |
| `plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs` | `CODEX_EVENT_SCHEMA_SET` 补 `SessionEnd`（D6，带版本出处注释）；新增 `OWNED_HOOK_SCRIPT_EXPECTED_EVENT` 映射表 + handler 级判据（D5，`product-handler-missing` / `product-handler-misplaced`）；`owned-command-interpolated` 分支注释补作用域限定（见 §3） | 2 | 高：改的是全仓唯一的两层门禁实现，`validate-codex-hooks.mjs` / `codex-hooks-generator.mjs` 自检 / 既有 `codex-hooks-event-gate.test.ts` 全部消费它——必须先跑现有测试基线，逐条对照新判据不引入假阳性（合法安装态被新判据误伤） |
| `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` | 模块头注释补正（"全局唯一共享文件"仍成立，但"唯一注册源"前提错误，见 §3） | 2 | 低：仅注释 |
| `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs` | `rewriteCodexRuntimeText` 替换表新增 `mcp__plugin_spectra_spectra__` 一条（D7） | 3 | 中：影响 5 个 wrapper 的 sha256，必须同一 commit 内联动重生两处分发产物，否则 `repo:check` 立即红 |
| `.codex/skills/{feature,implement,story,fix,refactor}/SKILL.md`（5/9） | 随 D7 替换表重生（`npm run repo:sync`） | 3 | 低：机械再生，人工不手改 |
| `plugins/spec-driver/skills-codex/{feature,implement,story,fix,refactor}/SKILL.md`（5/5） | 同上 | 3 | 低：机械再生 |
| `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | 新增 `codex-wrapper-mcp-neutral` check（D7 窄门禁） | 3 | 低：新增独立 check 函数，不改既有 check 逻辑 |
| `README.md` §Codex Support | 重写：`codex plugin add` 为主路径（含 marketplace add 前置步骤），`codex-skills.sh install --global` 降级为"仅需要 skills 而不想装完整插件"时的 fallback 说明 | 4 | 低：纯文档 |
| `specs/213-codex-plugin-distribution/spec.md` | FR-006 附近加更正注记（指向本卡，说明"manifest 无 hooks 字段"结论仍成立，但被外推成"Codex 不读插件 hooks"的推论错误） | 4 | 低：只加注记，不改 shipped 正文（硬约束） |
| `specs/240-codex-runtime-closeout/spec.md` | FR-011 附近（L182 起）加同类更正注记 | 4 | 低：同上 |
| `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-B | 标注已交付 + 链接本卡 | 4 | 极低：文档 |
| 测试新增/修改（见 §5） | 见验证方案 | 1/2/3 各自 | — |

## 3. 同源注释更正（不改行为，只改文案，随对应 commit 一并改）

- `codex-hooks-installer.mjs` 模块头："`$CODEX_HOME/hooks.json` 是 Codex 的全局唯一共享声明文件"
  → 补一句"（全局文件仍是唯一的**该文件**，但不再是 hooks 的唯一**注册源**——插件包内
  `hooks/hooks.json` 才是主路径，见 F264/F265）"。
- `codex-skills.sh` L~223-230 注释："Codex hooks 只有全局位置，无项目级语义（§8.1）"
  → 同上补正，并说明本文件调用点现在多了守卫分支。
- `codex-hooks-schema.mjs` 的 `owned-command-interpolated` 判据注释："Codex 不注入任何 plugin root
  变量（§8.6），运行期插值必然展开为空串" → 补"（该结论仅对 `$CODEX_HOME/hooks.json` 这份全局合并
  写入成立；插件原生加载路径下 `${CLAUDE_PLUGIN_ROOT}` 已实测被展开，见 fix-report 复现步骤 1）"。

## 4. Commit 切分方案

| # | 内容 | 独立性 | 依赖 |
|---|---|---|---|
| 1 | **双注册守卫**（D1-D4）：`codex-plugin-registration.mjs` 新建、`codex-runtime-doctor-io.mjs` 导出、`install-codex-hooks.mjs` 主流程、`codex-skills.sh` 分流+透传、对应单测 | 独立、可单独验证（安装前置） | 无 |
| 2 | **handler 级判据 + SessionEnd**（D5/D6）：`codex-hooks-schema.mjs` 改动 + 同源注释更正、对应单测（含既有 `codex-hooks-event-gate.test.ts` 回归） | 独立 | 无（与 commit 1 不共享代码路径，可先可后，但按卡面派发顺序排在守卫之后） |
| 3 | **mcp__ 命名空间纠偏**（D7）：`extract-wrapper-body.mjs` + 两处分发产物重生 + `validate-wrapper-sources.mjs` 新 check | 独立 | 无 |
| 4 | **文档纠偏**：README + F213/F240 spec 更正注记 + milestone 卡面标注 | 独立、纯文档 | 建议排最后（README 需引用 commit 1 落地后的真实行为） |

四个 commit 两两之间无代码路径重叠（各自独立文件集），可按任意顺序提交，但 commit 1 必须最先
（milestone 卡面写明"第一步、独立小 commit"，且 T062 人工验证的前置条件是它落地）。

## 5. 回归风险评估

### 5.1 守卫误拒面（D1/D2，commit 1 核心风险）

| 场景 | 期望结果 | 会不会被新判据误伤 |
|---|---|---|
| 用户从未装过插件，纯 skills-only 全局合并器安装（现状主流程） | 放行（`registered: false`） | 不会：`config.toml` 无对应表 |
| 用户装了原生插件（E3，未写 `enabled` 键） | 拒绝（`registered: true`） | 这正是本次要修的漏洞面，必须命中 |
| 用户装了原生插件后又显式 `enabled = false`（E2） | 放行（`registered: false`） | 需验证：只查 cache 目录存在会误拒，必须读 config.toml 的三态 |
| `codex plugin remove` 之后（E1，表与 cache 同时消失） | 放行 | 需验证：不能只查其中一个信号源 |
| `$CODEX_HOME/config.toml` 不存在（全新环境） | 放行（absent → 不拦） | 与 `probeCodexPluginManifest` 对"文件不存在"的处理方向一致（ENOENT → absent） |
| `config.toml` 存在但含畸形/无法解析的 plugins 段（如段名带 `]`） | 按 `normalizeTomlLines` 既有的"判不出就 absent”方向，不拦 | 复用同一扫描器保证同向；不新增第二套解析容错逻辑 |
| 用户显式传 `--force-hooks` | 跳过守卫，走原合并逻辑，打印代价说明 | 逃生口按设计放行 |

### 5.2 handler 级判据对既有 fixture/测试的冲击面（D5，commit 2 核心风险）

- `tests/unit/codex-hooks-event-gate.test.ts` 当前基于"事件集合恰四项"构造用例，新增 handler 级
  判据后需**逐条重跑**并确认：所有此前 pass 的合法安装态 fixture（5 handler 各在正确事件下）在
  新判据下仍然 pass；同时新增专门覆盖"`Stop` 存在但只有 `stop-task-check.sh`、缺
  `stop-fix-compliance-check.sh`"的用例，断言判 fail（这是卡面点名的核心验收点）。
- `lib/codex-hooks-generator.mjs` 的生成期自检（`validateCodexHooksDocument` 直接消费同一份判据）
  必须确认：`generateCodexHooks` 的正常产物（5 handler 各在预期 event 下）仍能通过自检，不会因为
  新判据把生成器自己的合法产物判 fail（否则 `install-codex-hooks.mjs` 每次运行都会在生成阶段炸）。
- `validate-codex-hooks.mjs` 的 `--canonical-source` 校验路径（校验 canonical
  `plugins/spec-driver/hooks/hooks.json`，路径含 `${CLAUDE_PLUGIN_ROOT}` 占位）需要单独验证新
  handler 级判据在 `allowPlaceholderRoot: true` 下依然能正确归属（`extractOwnedScriptPath` 与
  `OWNED_HOOK_SCRIPT_EXPECTED_EVENT` 的映射键必须一致，否则 canonical source 校验会假红）。

### 5.3 wrapper sha256 变更的连带门禁（D7，commit 3 核心风险）

- 改 `extract-wrapper-body.mjs` 后，若忘记同一 commit 内跑 `npm run repo:sync` 重生
  `.codex/skills/` 与 `skills-codex/`，`validate-wrapper-sources.mjs` 的既有 sha256 比对
  （`codex-wrapper-markers` / `codex-plugin-distribution-markers` 两个 check）会立即判 fail——
  这是**既有**门禁，不是本次新加的，必须在同一 commit 完成"改替换表 → 重生两处产物 → repo:check
  绿"三步，不能拆成两个 commit（否则中间态会让 `repo:check` 在 commit 3 落地前红）。
- 新增的 `codex-wrapper-mcp-neutral` check 本身不应该在**其余 4 个不含该句的 skill**（constitution/
  resume/sync/doc）上产生任何变化——验证时需确认这 4 个 wrapper 的 sha256 保持不变（`git diff`
  只应看到 5 个含 `mcp__` 句子的 skill 文件变化）。

### 5.4 不得回退的既有护栏（全部 commit 通用）

- F262 W3：权限位保全（`writeJsonAtomic` 的 mode 快照/恢复）与幂等（多次安装 owned handler 数恒为
  5）——守卫只是在写入**之前**加一道判定，不改 `installCodexHooks` 本身的写入逻辑，理论上不触碰
  这条护栏，但仍需跑一遍既有 `codex-hooks-installer.test.ts` 确认无副作用。
- F240 四方一致性诊断（`codex-runtime-doctor` / `check-codex-inventory`）：`codex-runtime-doctor-io.mjs`
  本次只新增一个 `export`，不改函数体，理论零风险，仍需跑 `codex-runtime-doctor*.test.ts` 全套确认。
- `npm run repo:check` 的 codex 分发一致性矩阵与 wrapper sha 门必须绿（见 5.3）。
- 已知既有 warning：`graph-quality:freshness`（图 stale）是基线噪声，非本次改动引入，验证时不必
  当作新增回归处理。

## 6. 验证方案

### 6.1 单元/集成测试（每个 commit 各自跑一次，最终全量再跑一次）

```bash
# commit 1：双注册守卫
npx vitest run tests/unit/codex-hooks-installer.test.ts tests/integration/codex-hooks-install-flow.test.ts
# 新增：tests/unit/codex-plugin-registration.test.ts（E1/E2/E3 三态 + absent + 畸形 TOML + --force-hooks）

# commit 2：handler 级判据
npx vitest run tests/unit/codex-hooks-event-gate.test.ts tests/unit/codex-hooks-generator.test.ts tests/unit/codex-hooks-installer.test.ts

# commit 3：wrapper 命名空间
npx vitest run tests/unit/wrapper-sha256.test.ts  # 若存在；否则经由下方 repo:check 覆盖
node plugins/spec-driver/scripts/validate-wrapper-sources.mjs --project-root . --json

# 每个 commit 前必跑全量基线，确保零新增失败
npx vitest run
npm run build
npm run repo:check
```

### 6.2 隔离 CODEX_HOME 端到端复验（复现 fix-report 的复现步骤，验证已修复）

沿用 fix-report 的隔离方法（禁 `git stash`/`git checkout` 做隔离，只在 `/tmp` 或 scratchpad 内起
隔离 `CODEX_HOME`），流程：

```bash
export SCRATCH=/tmp/f264-verify   # 或 scratchpad 路径
export CODEX_HOME="$SCRATCH/codexB"
mkdir -p "$CODEX_HOME"

# 1. 原生安装（复现 fix-report 步骤 1）
codex plugin marketplace add <本 worktree 路径>
codex plugin add spec-driver@cc-plugin-market

# 2. 叠装合并器（验证守卫拦截，D1-D4 核心验收点）
bash plugins/spec-driver/scripts/codex-skills.sh install --global
# 期望：stdout/stderr 出现"hooks 已由 Codex 原生插件注册生效，无需再跑合并器"，退出码非 fail、
#       skills 部分正常完成（.codex/skills 类比路径不受影响，本例走 --global 走 CODEX_HOME/skills）

# 3. 经探针脚本核对 hooks/list 恒 5 条不重复（沿用 fix-report 的 codex app-server stdio 探针）
node "$SCRATCH/probe-hooks.mjs"   # 期望 TOTAL: 5，全部 source=plugin，无 source=user 重复条目

# 4. --force-hooks 逃生口验证
bash plugins/spec-driver/scripts/codex-skills.sh install --global --force-hooks
node "$SCRATCH/probe-hooks.mjs"   # 期望 TOTAL: 10（此为预期内的强制叠装后果，验证 flag 确实生效）

# 5. E2/E3 场景补充验证（人工改 config.toml 的 enabled 键）
#    - 删除 enabled 行（E3）→ 步骤 2 命令应仍被拦
#    - 显式写 enabled = false（E2）→ 步骤 2 命令应放行（因为 hooks/list 此时应为 0，合并器需要接管）

# 6. codex plugin remove 之后（E1）→ 步骤 2 命令应放行
codex plugin remove spec-driver
bash plugins/spec-driver/scripts/codex-skills.sh install --global
node "$SCRATCH/probe-hooks.mjs"   # 期望 TOTAL: 5，全部 source=user（合并器接管）
```

### 6.3 handler 级判据验证（D5，构造反例）

```bash
# 人为造一份只含 4/5 owned handler（缺 stop-fix-compliance-check.sh）的 hooks.json
node plugins/spec-driver/scripts/validate-codex-hooks.mjs --target /tmp/f264-missing-handler.json
# 期望：exit 1，findings 含 product-handler-missing（event=Stop, script=stop-fix-compliance-check.sh）
```

### 6.4 wrapper sha256 与命名空间门禁验证（D7）

```bash
npm run repo:sync
git status --short plugins/spec-driver/skills-codex .codex/skills
# 期望：只有 feature/implement/story/fix/refactor 5 个目录出现改动，
#       constitution/resume/sync/doc 4 个目录零 diff

grep -rl 'mcp__' .codex/skills plugins/spec-driver/skills-codex
# 期望：无匹配（命名空间已清干净）

npm run repo:check   # 含新增 codex-wrapper-mcp-neutral check，必须绿
```

### 6.5 提交前硬约束（每个 commit 前）

```bash
npx vitest run       # 零失败
npm run build         # 类型检查零错误
npm run repo:check     # 含 codex 分发一致性矩阵 + wrapper sha 门 + 新增窄门禁
```

## 7. 门禁类改动的审查档位标注

本卡属 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §9 点名的"门禁/判定器/安全类
改动"（`install-codex-hooks.mjs` 是写入用户全局 `$CODEX_HOME/hooks.json` 的唯一入口，
`codex-hooks-schema.mjs` 是两层门禁的唯一实现）。按 `CLAUDE.local.md` 暂停节约定：Codex 配额恢复前
走**异构对抗档位**（独立子代理 + 换视角，至少 2 个不同切入角，如"守卫绕过面"/"handler 级判据漏判
面"），并在提交时的 commit message / fix-report 中显式标注"Codex 审查暂停，异构档位缺席"。

## 8. 范围声明（不做）

- 项目级 `.codex/config.toml` 路线（spec-kit 形态）——milestone 卡面已裁定"记为候选不做"。
- `T062`/`T063` 人工验证本身——本卡只负责让"双注册守卫落地"这一前置条件满足，T062 的实际执行按
  milestone §8 排在 Codex ≥0.149 环境下另行进行，不在本卡验收范围内。
- 不改 `plugins/spec-driver/hooks/hooks.json`（canonical 声明源）本身的内容——本次是分发路线与门禁
  纠偏，不是 hook 行为变更。
