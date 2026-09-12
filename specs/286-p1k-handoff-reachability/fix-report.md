# F286 · P1-K / F277 移交承接：导出符号可达性检查 + 审查子代理写盘 / 证据契约 + RED 级取证 + 向后兼容类 SC 模板

> 模式：spec-driver fix（story · medium，M10 §12.4 批次 3）。基线 `9362f1a8`。改动面：**prompt 层 + 一个脚本 + 测试**，不触碰判定器 / hook / src。
> 审查档位：一般生产代码档——主线程自审 + 独立子代理对抗复审（一个子代理两个切入角：脚本判据的绕过 / 假报警面；prompt 合同的可执行性与漂移面）+ verify 子代理两轮（首轮 NEEDS FIX → 修 → 复核）。

## 1. 问题（改动前事实）

| 来源 | 缺口 | 证据 |
|---|---|---|
| F277 verification-report 移交 FR-010~013 | 「新增导出符号生产可达性」检查只在 F277 spec 里成文，没有脚本、verify.md 没有对应层、报告模板没有落点；F270 `routeNonBlock`（生产零接线、单测全绿）形态无人拦 | `specs/277-*/verification/verification-report.md` 移交 4 项；`grep -n "可达性" plugins/spec-driver/agents/verify.md` 改动前 0 命中 |
| 账本 F279 ① | `spec-driver:spec-review` 子代理 frontmatter 无 Write，但 SKILL 要求它产出 `verification/spec-review-report.md`——报告只能走 chat 回复，编排器不转录即随会话流失（quality-review 同病） | `agents/spec-review.md` / `quality-review.md` tools 行；两份 artifact `output_path` 写着「无文件输出」 |
| 账本 F278 ③ / F279 ⑤ | spec-review 无 Bash，拿不到任何实测证据只能读代码脑补；F279 实证「编排器预跑注入证据包」可行且成本低，但没有写进任何 SKILL 的派发步骤 | 四个 SKILL 的 VERIFY_GROUP 段改动前均无 `evidence-pack` 字样 |
| 账本 F279 ② | implement 子代理 63 次调用后断连，红先行证据永久丢失；F279 用「新测试 × `git show HEAD:` 旧实现」替代证明补救，未固化 | `agents/implement.md` 改动前无逐任务取证要求 |
| 账本 F278 ②（F279 ④ 再现） | 向后兼容 / 逐字节不变类 SC 被钉成 sha256 绝对值快照，`.spec-driver-path` 切版本即失效；正确手段（同时刻 A/B）无模板 | `agents/verify.md` 改动前无 A/B 指引 |

## 2. 修复

- **(a) `plugins/spec-driver/scripts/export-reachability.mjs`（新）**：纯词法检查（FR-012）。判据（对抗复审 A-C1 / A-C2 后收紧）：新增导出符号在生产侧的**合格使用行** = 定义文件自身的非声明 / 非注释 / 非 import 行，或 **import 了定义文件**（模块说明符 basename 相同，re-export 链追一跳）的生产文件里的非声明 / 非注释 / 非 import 行；import 类行含多行 `import {…} from` 块 / `export {…} from` 再导出块 / `module.exports = {…}` 块 / require / 动态 import——一行或一块死 import 洗不白；他文件碰巧同名的声明 / 调用不算。盘点面：单行声明式 export（default / declare / async / `const enum` / 装饰器与块注释前缀 / 同行多语句）、解构 export、多行本地导出列表、CJS `exports.x` / `module.exports.x` / `module.exports = {…}`；再导出 / `export default` 别名 / `export =` 不盘点（登记）。契约：`--base` 必填、按 `git merge-base <ref> HEAD` 解析（master 领先时不出反向 diff 噪声）、解析后 == HEAD 且工作树干净 ⇒ exit 2（`--allow-head` 才放行；树脏时只打 WARN）、已删除文件单列不盘点、`--scope` 无尾斜杠按目录前缀、`--format md|json` 同源、`--fail-on-warning` 可接门禁、`--base --format json` 一类缺值 fail-loud。固定口径 `HONESTY_BOUNDARY` 两种格式恒随行；零新增符号时结论紧跟命令与原始输出。
- **(b) `agents/verify.md`**：Layer 1.85 首句写适用范围（feature / story / implement 强制；fix / refactor 有代码改动或延期承诺时；doc / sync 记不适用）；`<baseRef>` 唯一合法来源 = 编排器预跑注入的 `evidence-pack.md` 首行 `baseRef:`（缺席 ⇒ 未执行（缺席），禁止自行现推 / 默认 HEAD）；6b 三支处置各带落点、「有意的预留」必须派生延期任务否则无效、任一未处置 ⇒ NEEDS FIX；6c 固定口径随行；手工口径与脚本口径对齐（定义文件自身 / importer 文件、多行 import 块、同名声明不算）。Layer 1.86：先读 `red-first-evidence.md`，禁钉绝对值快照、必用同时刻 A/B、F279 替代证明 SOP。合并律映射表 +4 行（无报警或全部已处置 / 报警未处置 / 未执行（缺席）/ 不适用），换算式 10 → 14；返回摘要模板加 1.85 行；报告结构行登记两层。
- **(c) `agents/spec-review.md` + `quality-review.md`（对称）**：tools 加 `Write`，正文限定仅可写各自的 `verification/*-report.md`；artifact `output_path` 改真实路径；spec-review 证据来源 = Read `evidence-pack.md`，缺席时全局受限声明 + 依赖实测的 FR 归未核验。
- **(d) `agents/implement.md`**：每个「红先行 → 变绿」任务完成即 append 到 `{feature_dir}/verification/red-first-evidence.md`（append-only，与覆盖写入的 `implementation-notes.md` 分离——B-W3）；证据仍丢失时按 F279 SOP 补替代证明。
- **(e) 四个 SKILL（feature / story / implement / fix）**：VERIFY_GROUP 段的「spec-review 派发前置」：编排器 MUST 先写 `evidence-pack.md`（**首行 `baseRef: $(git merge-base origin/master HEAD)`**，feature 模式取 trace.md 最后一条 `phase_start_ref: implement=`；diff --stat、门禁结果、新增用例名、BEHAVIOR_VERSION / pinned A/B、`export-reachability.mjs --base <baseRef>` 输出）并把路径同时注入 spec-review 与 verify 的派发块；**返回处理**：`test -f` 两份审查报告（缺席按 NEEDS FIX 侧计）+ 派发前后 `git status --porcelain` 对比判越界写入；明示不开 Bash 白名单。
- **(f) 模板**：插件模板加 Layer 1.85 / 1.86 槽位；本机 `.specify/templates/verification-report-template.md` 同步改写（B-C2：verify.md 优先读项目级模板）——⚠️ 该目录被 .gitignore、由 `init-project.sh` **只在缺席时**拷贝一次，插件模板升级永远到不了既有项目，本卡只能同步本机副本 + 守护「存在即同源」（CI 无该目录跳过），**同步机制缺席登记 M11**（init-project 加模板刷新或 repo:sync 加步骤）；`verify.artifact.yaml` 登记两可选章节并如实注明「无校验器消费、纯登记」。
- **(g) 守护**：`tests/export-reachability.test.mjs`（10：词法盘点面 / classifyLines / 判据七形态 / 契约字段 / baseRef 缺席抛错 / merge-base / 零符号附输出 / CLI 缺值 / 基线 == HEAD 三形态 / md+json+fail-on-warning）与 `tests/f286-handoff-contracts.test.mjs`（13：段落级——1.85 关键句与削弱词 / 1.86 / 映射表四行 / artifact 非注释行 + 模板同源 / 两审查 agent 对称 / implement 独立文件 / 四 SKILL 前置段 + baseRef 首行 + 返回处理 + 位序 + 两派发块注入）。

## 3. 如实登记（能力边界 / 未做）

- 词法层无法区分「引用」与「调用」：赋值 / 传参 / 成员访问都计为使用——**仅拦无意遗漏，不拦有意规避**（FR-012 固定口径，测试钉住）。同 basename 的不同模块仍可能同名碰撞；re-export 链只追一跳；`export default` 别名与字符串反射不可见。
- 改名会表现为「删一个 + 新增一个」→ 新名按新增符号报警，须在处置表里三支择一（改名通常是接线遗漏支，落点=改名后的调用点）。
- 检查的执行是 **prompt 层义务**（verify 子代理必须跑并贴输出；合并律映射表把「未执行（缺席）」拉红），没有引擎级硬门（`--fail-on-warning` 已备，接入 repo:check 留 M11）；制品合同无校验器（纯登记）。
- `spec-review` / `quality-review` 的 Write 限制是 prompt 约束（frontmatter 工具粒度做不到路径级）；越界靠 SKILL 返回处理段的 `git status --porcelain` 对比。
- `TEST_PATH` 对 `e2e/` / `spec/` / `bench/` 目录不识别（本仓 scope 内无此类目录，登记）。
- `.specify/templates/` 是本地未跟踪副本：插件模板升级不会自动刷新既有项目（init-project 只在缺席时拷贝），B-C2 在本仓只修了本机；机制补齐（刷新策略 / repo:sync 步骤）留 M11。

## 4. 影响范围与边界

- 不改判定器、hook、`src/`；`skills-codex/` 与 `.codex/skills/` 由 `npm run repo:sync` 再生（wrapper SHA 同步）；`specs/products/_generated/*` 与 `.specify/project-context.suggestions.*` 为再生噪声已还原不入库。
- 消费方：verify / spec-review / quality-review / implement 四个 agent prompt、两份 artifact 合同、四个 SKILL 的编排段、两份报告模板；无 schema / CLI 合同变化。

## 5. 验证

- `node --test plugins/spec-driver/tests/export-reachability.test.mjs plugins/spec-driver/tests/f286-handoff-contracts.test.mjs` → 10 + 13 = **23 / 0**（首稿写 22 与 16 均为数错，verify B-W5 更正）。
- **Layer 1.85 自查**（本 worktree，`--base 9362f1a8`，树脏故基线 == HEAD 只打 WARN）：新增导出 `HONESTY_BOUNDARY / extractExportedNames / classifyLines / BaseRefError / analyzeExportReachability / renderMarkdown / main` 生产使用行分别 1 / 3 / 1 / 5 / 4 / 1 / 1（全部是脚本自身文件内的非声明行使用），**报警 0 条**。首稿脚本（不计自身文件使用）曾报警 3 条而 §5 写「非报警」——verify 子代理判 CRITICAL，本版按 A-W2 修正判据后如实为 0，处置表空。
- `npm run test:plugins` / `npm run repo:check`（wrapper SHA 三副本同步）/ 全量 vitest / `npm run release:check`：见 push report。

## 6. 对抗复审与 verify 处置

### 6.1 角 A · 脚本判据（2C / 5W / 6I）

| # | 发现 | 处置 |
|---|---|---|
| A-C1 | 多行 import 块的裸标识符行计为使用（本仓 155 处 / 110 文件是这种形态）| **已修**：`classifyLines` 跟踪 import / re-export / 导出列表块状态；测试 `deadMultiImport` |
| A-C2 | 他文件同名声明 / 调用计为使用（自查实证 `renderMarkdown`/`main` 被别的脚本洗白）| **已修**：使用行须在定义文件自身或 import 了定义文件的文件里，且不是声明行；测试 `collideOnly` |
| A-W1 | 盘点盲区：多行导出列表 / `export * as` / 解构 / `export declare` / 装饰器前缀 / 同行双 export / `function *` / CJS / `const enum` 抽成 `enum` | **已修**（re-export / default 别名 / `export =` 登记不盘点）；测试逐形态 |
| A-W2 | 仅在定义文件内部使用的导出恒报警；作者处置「非报警」不在三支内 | **已修**：自身文件非声明行计入；§5 如实改写 |
| A-W3 | master 领先时反向 diff 噪声 | **已修**：merge-base 解析，契约块同时打印 ref / sha / merge-base / HEAD |
| A-W4 | 12 组变异 6 组存活（M2b / M3 / M4 / M7 / M10 / M11）| **已修**：夹具 + 用例覆盖六组（库函数缺 baseRef 抛错 / 测试文件不进盘点与不计生产 / 注释提及不算 / 多行块 / 零符号紧跟原始输出）|
| A-W5 | 显式 `--base HEAD` 干净树静默「零新增」 | **已修**：解析后 == HEAD 且树干净 ⇒ exit 2；`--allow-head` 显式放行；树脏只 WARN |
| A-I1 / A-I2 / A-I3 | `--base --format` 缺值归因 / 已删除文件与无尾斜杠 scope / 无门禁退出码 | **已修**（缺值 fail-loud / deletedFiles 单列 / scope 归一化 / `--fail-on-warning`）|
| A-I4 / A-I5 / A-I6 | `export type {…} from` 双记 / 手工口径与脚本不同 / rename 噪声 | **已修**（再导出不盘点 / verify.md 手工口径对齐）/ rename 登记 |

### 6.2 角 B · prompt 合同（2C / 5W / 6I）

| # | 发现 | 处置 |
|---|---|---|
| B-C1 | `<baseRef>` 无可执行来源（冻结字段可选且不在注入块；「分支基线 ref」零命中；fix 模式无 GATE_TASKS） | **已修**：evidence-pack 首行 `baseRef:` 为唯一来源，四 SKILL 预跑段计算并注入 spec-review + verify 两个派发块；verify.md 缺席 ⇒ 未执行（缺席） |
| B-C2 | 项目级模板遮蔽插件模板（verify.md 优先读 `.specify/templates/`）| **部分修**：本机副本同批改写（目录被 gitignore、不入库）+ 守护「存在即同源」；init-project 只在缺席时拷贝 ⇒ 升级不刷新，机制登记 M11 |
| B-W1 | 制品合同无校验器；mode 规则只在被遮蔽的模板标题 | **已修**：mode 规则进 verify.md 6a 首句；artifact 注释如实 |
| B-W2 | 合并律映射表未登记 1.85 取值 | **已修**：+4 行，换算式 14 |
| B-W3 | implementation-notes.md append 与 Phase 级覆盖写冲突；取证无人读 | **已修**：独立 append-only 文件 + 1.86 先读 |
| B-W4 | spec-review 受限 Write 无核对步骤 | **已修**：四 SKILL 返回处理段（缺席 + `git status --porcelain` 越界）|
| B-W5 | 守护 10 条非 16；子串断言在 10 组削弱下全绿 | **已修**：段落级断言 + 削弱词 + 位序 + 非注释行；数字更正 |
| B-I3 / B-I5 | 返回摘要无 1.85 / quality-review 同病 | **已修** |
| B-I1 / B-I2 / B-I4 / B-I6 | feature 无显式派发块（通用 phase 循环，证据包靠 `{feature_dir}` 约定）/ SHA 已核 / 受保护检查项已挡降级 / 缺席方向一致 | 登记 / 无动作 |

### 6.3 verify 子代理（首轮 NEEDS FIX → 复核）

- 首轮 2C（自查 3 条报警未按三支处置；跨文件同名假阴性）+ 2W（用例数错报；「处置表去落点列」变异存活）→ 与角 A 同源，随 A-C2 / A-W2 / B-W5 一并修；落点列改为逐字钉表头。复核结论见 `verification/verification-report.md`。

## 7. 工具使用反馈（dogfooding）

- MCP 可用性：本次未用 Spectra MCP——改动面是 prompt 文档 + 自包含脚本，无需依赖图；`repo:check` 仍报本地图 stale（worktree 图未重建，已知）。
- 信息完整性 / 流程顺畅度：spec-review / quality-review 无 Write、无 Bash 两条正是本卡修的对象；本卡自身审查改用独立子代理，未再触发。本卡首版自查即违反自己定义的 FR-013（把 3 条报警写成「非报警」）——Layer 1.85 的第一次真实使用就抓到了作者本人，说明该检查有牙；同时暴露判据两处结构性假阴性 / 假阳性（A-C1 / A-C2 / A-W2），已修。
- 结果准确性：无。
