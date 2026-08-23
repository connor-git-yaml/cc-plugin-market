# Tasks: Codex hooks 分发纠偏（卡面 F265 / 仓内编号 264）

**输入制品**：
- `specs/264-fix-codex-hooks-distribution/fix-report.md`（诊断 + 实测事实 E1~E4，已锁定）
- `specs/264-fix-codex-hooks-distribution/plan.md`（**已批准，D1~D7 设计决策已钉死，不得重新论证**）

**模式**：fix（无 spec.md / User Story，按 plan.md §4 的 4 个 commit 组织任务）

**Tests**：本卡属门禁/判定器/安全类改动，测试任务**必须**包含，且与实现任务在同一 commit 内先后排列（测试先行，覆盖 E1~E4 场景）。

## Format: `[ID] [P?] [C#] 描述 + 文件路径`

- **[P]**：可并行（不同文件、无依赖）
- **[C#]**：所属 commit（C1~C4，对应 plan.md §4）
- 每条任务给出**验收命令**与期望结果

---

## Commit 1：双注册守卫（D1-D4）— 独立、可单独验证，T062 人工验证前置条件

**目标**：`install-codex-hooks.mjs` 安装前探测本插件是否已被 Codex 原生注册，命中则拒绝写入，避免同一批 hook 被注册两遍。

**独立验证方式**：跑 `tests/unit/codex-plugin-registration.test.ts` 覆盖 E1/E2/E3/absent/畸形 TOML/`--force-hooks` 六态；隔离 `CODEX_HOME` 端到端复验（plan.md §6.2）。

- [ ] T001 [C1] 在 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` 中把私有函数 `normalizeTomlLines`（第 334 行附近）改为具名导出，函数体不变
  验收：`grep -n "^export function normalizeTomlLines\|^export const normalizeTomlLines" plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` 有匹配；`npx vitest run tests/unit/codex-runtime-doctor*.test.ts` 全绿（既有测试零回归）

- [ ] T002 [C1] 新建 `plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs`：基于 T001 导出的 `normalizeTomlLines` 实现 `detectNativePluginRegistration({ codexHome, pluginName, marketplaceName })`，三态 `enabled` 解析（`true`/`false`/`undefined`）+ cache 目录存在性判据（D1/D2 判据）
  验收：`node -e "const m=require('./plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs'); console.log(typeof m.detectNativePluginRegistration)"`（或等价 ESM import）输出 `function`

- [ ] T003 [P] [C1] 编写 `tests/unit/codex-plugin-registration.test.ts`：覆盖 E1（remove 后表与 cache 同时消失→`registered:false`）、E2（`enabled=false`，cache 仍在→`registered:false`）、E3（表存在未写 `enabled` 键→`registered:true`）、`config.toml` 不存在（absent→`registered:false`）、畸形 TOML（段名带 `]`等，判不出→`registered:false`，与 `normalizeTomlLines` 既有容错方向一致）
  验收：`npx vitest run tests/unit/codex-plugin-registration.test.ts` 全绿，六个场景各至少一条断言

- [ ] T004 [C1] 修改 `plugins/spec-driver/scripts/install-codex-hooks.mjs`：`parseArgs` 新增 `--force-hooks`；`execute()` 的 `action === 'install'` 分支前置调用 T002 的守卫，命中且未传 `--force-hooks` → 新增 `EXIT_ALREADY_REGISTERED = 4` 并中断写入（不写 `$CODEX_HOME/hooks.json`）；`--remove` 分支不受影响；命中且传 `--force-hooks` → 跳过守卫走原合并写入路径，并打印代价说明
  验收：`node plugins/spec-driver/scripts/install-codex-hooks.mjs --action install --help` 输出含 `--force-hooks`；见 T006 集成测试覆盖退出码 4 路径

- [ ] T005 [C1] 修改 `plugins/spec-driver/scripts/codex-skills.sh`：`run_codex_hooks_cli` 新增码 4 分支（打印中文指引，`return 0` 不阻断 skills 安装）；顶层参数解析新增 `--force-hooks` case，`ACTION=install` 时透传给 `run_codex_hooks_cli`；usage 文案同步补 `--force-hooks` 说明；同源注释更正（模块头 L~200-230：补正"全局唯一注册源"前提错误，见 plan.md §3）
  验收：`bash plugins/spec-driver/scripts/codex-skills.sh --help` 输出含 `--force-hooks`；`bash -n plugins/spec-driver/scripts/codex-skills.sh` 语法零错误

- [ ] T006 [C1] 补充/修改 `tests/integration/codex-hooks-install-flow.test.ts`：新增用例覆盖"守卫命中→退出码 4→未写入 hooks.json"与"`--force-hooks`→跳过守卫→正常写入"两条路径；确认既有安装流程（未注册场景）用例不受影响
  验收：`npx vitest run tests/unit/codex-hooks-installer.test.ts tests/integration/codex-hooks-install-flow.test.ts` 全绿

- [ ] T007 [C1] 提交前门禁：全量测试 + 构建 + repo:check
  验收：依次执行
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  ```
  期望：三条命令均零失败/零错误（已知 `graph-quality:freshness` 基线噪声不计入新增回归，见 plan.md §5.4）

**依赖**：T001 → T002 → T003；T002 → T004 → T005 → T006；T007 依赖 T001-T006 全部完成。C1 与 C2/C3/C4 无代码路径重叠，可先于其他 commit 独立提交。

---

## Commit 2：handler 级判据 + SessionEnd（D5/D6）

**目标**：两层门禁（事件级 + handler 级 AND 关系）能抓住"`Stop` 事件存在但缺 `stop-fix-compliance-check.sh`"这一现有判据盲区；`CODEX_EVENT_SCHEMA_SET` 补 `SessionEnd`（10→11，仅扩展 schema 全集，不入产品集）。

**独立验证方式**：`tests/unit/codex-hooks-event-gate.test.ts` 全量回归 + 新增反例用例（plan.md §6.3）。

- [ ] T008 [C2] 修改 `plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs`：`CODEX_EVENT_SCHEMA_SET` 追加 `'SessionEnd'`（10→11），紧邻处补版本出处注释（"0.149.0 changelog 口径；本机 0.144.6 实测该事件名被静默丢弃（fix-report E4），此处只扩展 schema 全集，不代表当前环境已验证"）；**不**加入 `CODEX_EVENT_PRODUCT_SET`
  验收：`grep -n "SessionEnd" plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs` 命中 `CODEX_EVENT_SCHEMA_SET` 但不命中 `CODEX_EVENT_PRODUCT_SET` 定义处

- [ ] T009 [C2] 同文件新增 `OWNED_HOOK_SCRIPT_EXPECTED_EVENT` 映射表（`[父目录, 文件名] → event`，5 条：`postinstall.sh→SessionStart`、`pre-tool-use-guard.sh→PreToolUse`、`post-tool-use-format.sh→PostToolUse`、`stop-task-check.sh→Stop`、`stop-fix-compliance-check.sh→Stop`）
  验收：`grep -n "OWNED_HOOK_SCRIPT_EXPECTED_EVENT" plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs` 命中，映射表条目数 = 5

- [ ] T010 [C2] 同文件 `validateCodexHooksDocument` 新增 handler 级校验轮：对文档全部 owned handler 反查期望 event，挂错事件 → 新 code `product-handler-misplaced`；`checkCommandShape` 开启时对期望存在的 5 条脚本，一条都没找到 → 新 code `product-handler-missing`（AND 于既有两个事件级 code，不取代）；`owned-command-interpolated` 分支注释补作用域限定（plan.md §3：仅对 `$CODEX_HOME/hooks.json` 全局合并写入成立）
  验收：见 T012 单测覆盖两个新 code 各自触发路径

- [ ] T011 [P] [C2] 修改 `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` 模块头注释：补正"全局文件仍唯一，但不是唯一注册源"（plan.md §3，纯注释不改行为）
  验收：`git diff plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` 仅注释行变化，无逻辑行变化

- [ ] T012 [C2] 扩充 `tests/unit/codex-hooks-event-gate.test.ts`：
  1. 逐条重跑既有"事件集合恰四项"合法安装态 fixture（5 handler 各在正确事件下），确认新判据下仍 pass（零假阳性）；
  2. 新增用例：`Stop` 事件存在但只有 `stop-task-check.sh`、缺 `stop-fix-compliance-check.sh` → 断言 `product-handler-missing`（event=Stop, script=stop-fix-compliance-check.sh）；
  3. 新增用例：某 owned handler 脚本名命中但挂在错误事件下 → 断言 `product-handler-misplaced`
  验收：`npx vitest run tests/unit/codex-hooks-event-gate.test.ts` 全绿，含上述 3 类断言

- [ ] T013 [C2] 验证 `plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs` 生成期自检不受新判据误伤（`generateCodexHooks` 正常产物仍通过 `validateCodexHooksDocument`）
  验收：`npx vitest run tests/unit/codex-hooks-generator.test.ts` 全绿；额外手动验证：
  ```bash
  node plugins/spec-driver/scripts/validate-codex-hooks.mjs --canonical-source
  ```
  期望：exit 0（canonical `plugins/spec-driver/hooks/hooks.json` 在 `allowPlaceholderRoot: true` 下通过新 handler 级判据）

- [ ] T014 [C2] 人为构造反例文件 `/tmp/f264-missing-handler.json`（只含 4/5 owned handler，缺 `stop-fix-compliance-check.sh`），验证 CLI 层面判 fail
  验收：
  ```bash
  node plugins/spec-driver/scripts/validate-codex-hooks.mjs --target /tmp/f264-missing-handler.json
  ```
  期望：exit 1，findings 含 `product-handler-missing`（event=Stop, script=stop-fix-compliance-check.sh）

- [ ] T015 [C2] 提交前门禁：全量测试 + 构建 + repo:check
  验收：同 T007 三条命令，零失败/零错误

**依赖**：T008 → T009 → T010 → T012 → T013 → T014；T011 可与 T008-T010 并行（不同文件）；T015 依赖 T008-T014 全部完成。C2 与 C1 无代码路径重叠，可先可后，但按卡面派发顺序排在 C1 之后。

---

## Commit 3：mcp\_\_ 命名空间纠偏（D7）

**目标**：`skills-codex/*/SKILL.md` 中残留的 Claude 专属 `mcp__plugin_spectra_spectra__*` 命名空间改为运行时中立表述；新增窄门禁防回归。

**独立验证方式**：`git status --short` 只应看到 5 个含该句的 skill 变化；`grep -rl mcp__` 应为空；`repo:check` 含新 check 后仍绿（plan.md §6.4）。

- [ ] T016 [C3] 修改 `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`：`rewriteCodexRuntimeText` 替换表新增一条，把 `mcp__plugin_spectra_spectra__` 前缀相关整句改写为运行时中立表述（"Spectra MCP 工具（`impact` / `context` / `detect_changes` 等）"，去掉 `mcp__` 前缀字面量）
  验收：`grep -n "mcp__plugin_spectra_spectra__" plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs` 命中替换表新增行

- [ ] T017 [C3] 同一 commit 内执行 `npm run repo:sync` 重生 `.codex/skills/{feature,implement,story,fix,refactor}/SKILL.md`（5/9）与 `plugins/spec-driver/skills-codex/{feature,implement,story,fix,refactor}/SKILL.md`（5/5）的 `Source SHA256` 行
  验收：
  ```bash
  npm run repo:sync
  git status --short plugins/spec-driver/skills-codex .codex/skills
  ```
  期望：只有 feature/implement/story/fix/refactor 5 个目录出现改动；constitution/resume/sync/doc 4 个目录零 diff

- [ ] T018 [C3] 新增 `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` 的 `codex-wrapper-mcp-neutral` check 函数（与既有 `validateWrapperMarkers` 并列）：对 `.codex/skills/*/SKILL.md` 与 `plugins/spec-driver/skills-codex/*/SKILL.md` 两个 root 各扫一遍 `content.includes('mcp__')`，命中即 fail；**不复用** `NEUTRALITY_HARD_MARKER`（避免连带匹配合法保留的 "Task tool" 短语误报）
  验收：`grep -n "codex-wrapper-mcp-neutral" plugins/spec-driver/scripts/validate-wrapper-sources.mjs` 命中新 check 函数

- [ ] T019 [P] [C3] 若存在 `tests/unit/wrapper-sha256.test.ts` 则同步更新其快照断言；若不存在则跳过（由 repo:check 覆盖）
  验收：`npx vitest run tests/unit/wrapper-sha256.test.ts`（若文件存在）全绿；文件不存在时本任务标记跳过并在 commit message 注明

- [ ] T020 [C3] 命名空间清零验证 + 窄门禁验证
  验收：
  ```bash
  grep -rl 'mcp__' .codex/skills plugins/spec-driver/skills-codex
  ```
  期望：无匹配

- [ ] T021 [C3] 提交前门禁：全量测试 + 构建 + repo:check（含新增 `codex-wrapper-mcp-neutral` check）
  验收：
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  ```
  期望：三条命令均零失败/零错误

**依赖**：T016 → T017（同一 commit 内必须连续完成，不可拆分——中间态会让 `repo:check` 假红，见 plan.md §5.3）→ T018 → T019 → T020 → T021。

---

## Commit 4：文档纠偏

**目标**：README 与历史 spec 补正"Codex 不读插件 hooks"这一已证伪前提；milestone 卡面标注已交付。

**独立验证方式**：纯文档改动，目视审查 + `repo:check` 中的文档一致性 check（如有）。

- [ ] T022 [P] [C4] 重写 `README.md` §Codex Support（约 L280-320）：`codex plugin add` 为主路径（含 marketplace add 前置步骤），`codex-skills.sh install --global` 降级为"仅需要 skills 而不想装完整插件"时的 fallback 说明
  验收：`grep -n "codex plugin add" README.md` 命中；`grep -n "fallback" README.md` 命中降级说明段落

- [ ] T023 [P] [C4] 在 `specs/213-codex-plugin-distribution/spec.md` FR-006 附近（L94 / L141）加"后续更正"注记，指向本卡（264），说明"manifest 无 hooks 字段"结论仍成立，但被外推成"Codex 不读插件 hooks"的推论错误；**不改 shipped 正文**
  验收：`grep -n "264\|后续更正" specs/213-codex-plugin-distribution/spec.md` 命中新增注记；`git diff specs/213-codex-plugin-distribution/spec.md` 仅新增行，无删除/修改原有正文行

- [ ] T024 [P] [C4] 在 `specs/240-codex-runtime-closeout/spec.md` FR-011 附近（L182 起）加同类更正注记
  验收：同 T023 验收方式，路径替换为本文件

- [ ] T025 [C4] 在 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-B 标注已交付，链接本卡 `specs/264-fix-codex-hooks-distribution/`
  验收：`grep -n "264-fix-codex-hooks-distribution" docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` 命中

- [ ] T026 [C4] 提交前门禁：全量测试 + 构建 + repo:check
  验收：同 T007/T015/T021 三条命令，零失败/零错误（纯文档改动预期不影响测试结果，仅确认无联动破坏）

**依赖**：T022/T023/T024/T025 相互独立可并行（不同文件）；T026 依赖前四项完成。建议排在 C1-C3 之后（README 需引用 C1 落地后的真实行为）。

---

## 对抗审查任务（全部 commit 完成后，push 前必做）

- [ ] T027 门禁/hooks 类改动异构对抗审查（Codex 配额暂停期档位）：启动**独立子代理**（`general-purpose`，不提供本次实现思路，只给"证伪这段代码"的任务），针对 C1（`codex-plugin-registration.mjs` + `install-codex-hooks.mjs` 守卫逻辑）与 C2（`codex-hooks-schema.mjs` handler 级判据）两处门禁改动，至少 **2 个不同切入角**独立执行：
  1. **切入角 A："双注册守卫绕过面"**——尝试构造能骗过 `detectNativePluginRegistration` 的 `config.toml` 形态（如多重表、大小写/引号变体、`enabled` 出现多次取最后一次语义是否正确处理等），使已原生注册场景被误判 `registered:false` 从而放行双写
  2. **切入角 B："handler 级判据漏判/误判面"**——尝试构造能骗过 `product-handler-missing`/`product-handler-misplaced` 的 hooks.json 形态（如脚本名大小写变体、路径分隔符差异、同名脚本挂多个事件下的边界），或反向找出合法安装态被误判 fail 的场景
  验收：两条切入角各自产出 critical/warning/info 三档结论；critical/真实缺陷必须修复并重新执行对应 commit 的提交前门禁（T007/T015）；风格类建议记录在 commit message 备注
  **commit message 中必须显式标注**：「Codex 审查暂停，异构档位缺席」

**依赖**：T027 依赖 C1（T001-T007）与 C2（T008-T015）全部完成；在 push 之前执行，早于向用户列 push report。

---

## Dogfooding 反馈任务

- [ ] T028 收尾附"工具使用反馈"（四维，覆盖 Spectra MCP 与 Spec Driver 流程本身；没遇到问题也须显式写"无"，不省略）：
  1. **MCP 是否可用**：连接是否正常、工具是否齐全、调用是否报错
  2. **返回信息是否够用**：字段是否缺失、上下文是否完整、是否缺 next-step 提示
  3. **流程是否顺畅**：Spec Driver 的 gate / phase / 产物是否卡住、冗余或难用（本卡为 fix 模式，无 spec.md/User Story，tasks 组织方式改按 commit 切分，需记录该适配是否顺畅）
  4. **结果是否准确**：impact / graph / fuzzy match 等给出的结果是否有错误或误导
  验收：交付报告末尾含该节；有实质反馈（非"无"）时按条目格式 append 到 `docs/design/dogfooding-feedback-ledger.md`（状态：待处理），随本次实现一并提交

---

## 任务总览与依赖图

```
C1: T001→T002→T003 ; T002→T004→T005→T006 ; (T001..T006)→T007
C2: T008→T009→T010→T012→T013→T014→T015 ; T011 ∥ (T008-T010)
C3: T016→T017→T018→T019→T020→T021（T017 必须紧跟 T016，不可拆分）
C4: {T022,T023,T024,T025}（并行）→T026
对抗审查: T027 依赖 C1+C2 完成
Dogfooding: T028 收尾，不阻塞交付

建议提交顺序：C1 → C2 → C3 → C4（C1 必须最先，是 T062 人工验证前置条件；
C2/C3/C4 之间无代码路径重叠，理论可并行提交但按卡面派发顺序线性执行）
```

## FR/决策覆盖映射（对照 plan.md D1-D7）

| plan.md 决策 | 覆盖任务 |
|---|---|
| D1 双注册守卫判据（三态 enabled） | T001, T002, T003 |
| D2 cache 目录存在性判据 | T002, T003 |
| D3 新退出码 EXIT_ALREADY_REGISTERED=4 + `--force-hooks` | T004, T006 |
| D4 codex-skills.sh 码 4 分流 + 透传 | T005 |
| D5 handler 级判据（product-handler-missing/misplaced） | T009, T010, T012, T014 |
| D6 SessionEnd 补入 schema 全集（不入产品集） | T008 |
| D7 mcp\_\_ 命名空间替换 + 窄门禁 | T016, T017, T018, T020 |
| §3 同源注释更正 | T005（部分）, T010（部分）, T011 |
| §6.2 隔离 CODEX_HOME 端到端复验 | 建议在 T007 后由主线程手动执行（非自动化任务，见验证方案原文） |
| §7 审查档位标注 | T027 |
| 文档纠偏（README/F213/F240/milestone） | T022, T023, T024, T025 |
