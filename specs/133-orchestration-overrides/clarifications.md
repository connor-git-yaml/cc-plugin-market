---
feature_id: "133"
created_at: "2026-04-26"
clarifications_version: "1.0"
status: "pending-gate-design"
---

# Feature 133 — 需求澄清记录

> 本文件在 Phase 3 DESIGN_PREP_GROUP 并行执行期间生成，仅输出澄清问题，不修改 spec.md。
> 所有"实现侧可决定"条目可在 plan 阶段直接拍板；"GATE_DESIGN 必须审批"条目须在 GATE_DESIGN 阶段等待用户确认后方可进入 plan。

---

## 一、数据契约歧义

### CL-001 — overrides 中自定义 mode 名的合法性边界

**问题**：spec.md Edge Cases 描述"overrides 声明了 base 不存在的 mode 名，合并后新增该 mode"，但 FR-004 和 AC-013 要求 Zod schema 使用 `.strict()` 策略。如果 schema 对 `modes` 的 key 做 enum 校验（只允许 base reserved names），则用户无法新增自定义 mode；如果 schema 允许任意 string key，则"拼写错误的 mode 名"也会被静默新增而非报错（如 `modes.fxi` 不触发任何 diagnostic）。

**影响**：FR-004、FR-007、AC-013、Edge Cases 章节第一条、R7（命名冲突风险）、`orchestrationOverridesSchema` 的 `modes` 字段类型

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `modes` key 允许任意 string，不做 enum 校验；依靠 `orchestration-overrides.mode-overridden` info diagnostic 提醒用户 | 灵活，允许未来自定义 mode；边界明确（新增 = 合并后多出一个 mode） | 拼写错误（`fxi`）被静默接受，用户看不到报错，只看到 info diagnostic |
| B | `modes` key 在 schema 层做 enum 校验（base reserved list：`feature\|story\|fix\|implement\|refactor\|resume\|sync\|doc`），未知 key → schema 校验失败 → fallback base + warning | 防御性强，避免拼写错误被静默忽略 | base mode 名如将来新增，schema 需同步更新；阻止了"自定义 mode"场景（Edge Cases 第一条会矛盾） |
| C | `modes` key 允许任意 string，但对 key 做正则格式校验（kebab-case / alpha-numeric），对非 base reserved name 发出 `warning` 级（而不是 `info` 级）diagnostic | 在灵活性和防错性之间折中；拼写错误概率被警告捕捉 | schema 需维护 reserved list 用于区分 warning vs info；逻辑稍复杂 |

**推荐答案**：**选项 B**——`modes` key 使用 enum 校验（locked to base reserved names）。理由：Edge Cases 中"新增 mode"场景实际上是语义歧义而非高价值需求（MVP Out of Scope 未列入，研究汇总 R7 也建议"Zod schema 对 mode 名做 enum 校验"）；防止拼写错误比允许自定义 mode 的价值更高；未来若要支持自定义 mode 可在二期升级 schema。

**决策权**：**GATE_DESIGN 必须审批**（影响 Edge Cases 第一条的处理方式、schema 设计和 AC-013 的 parallel_groups reject 逻辑方向）

---

### CL-002 — `fieldSources` key path 命名风格

**问题**：spec.md `fieldSources` 数据结构示例使用 dot-path 风格（`"modes.feature"`、`"gates.GATE_DESIGN"`），但 Diagnostic 对象的 `details.field` 示例使用 `"modes.fix.phases[1].id"`（带数组下标），两者命名惯例不一致。当 `--diff` 命令输出字段路径时，应统一使用哪种风格？

**影响**：FR-005、FR-010、Diagnostic 数据结构、CLI `--diff` 输出格式（spec.md `--diff` 示意图使用 `modes.fix`、`gates.GATE_DESIGN.default_behavior`）

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 统一使用 dot-path（`modes.fix`、`gates.GATE_DESIGN.default_behavior`），数组元素用 `[N]` 后缀（`phases[1]`） | 与 spec.md `--diff` 示意图一致；JavaScript 对象解构友好 | 与 JSONPath 标准（`$.modes.fix`）不完全兼容 |
| B | `fieldSources` 用 dot-path，Diagnostic `details.field` 用 JSONPath（`$.modes.fix.phases[1].id`）；两者并存 | 各司其职，互不干扰 | 两种风格并存，阅读时需区分上下文 |
| C | 全部统一用 dot-path，包括 Diagnostic，丢弃 JSONPath 标识 | 一致性最高，实现最简单 | 未来若接入 JSON Schema 工具链需要转换 |

**推荐答案**：**选项 A**——dot-path 统一风格，数组用 `[N]`。spec.md 示意图已采用此风格，维持一致最省力，与实现侧 `mergeOrchestrationConfigs()` 的路径拼接也最自然。

**决策权**：实现侧可决定

---

### CL-003 — `parallel_scheduling` 的 `fieldSources` 粒度

**问题**：`fieldSources` 对 Mode 级使用 `"modes.feature"` key，对 Gate 级使用 `"gates.GATE_DESIGN"` key，但对 `parallel_scheduling` 只在 spec.md 示例中出现 `"parallel_scheduling"` 一个 key。如果用户只覆盖了 `parallel_scheduling.max_concurrent_tasks`，`fieldSources["parallel_scheduling"]` 应该是 `"overrides"` 还是需要细分到字段级 `"parallel_scheduling.max_concurrent_tasks": "overrides"`？

**影响**：FR-005、FR-010（`--annotate` 注释如何打 source 标注）、AC-003（`fieldSources` 结构体验证）

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `"parallel_scheduling"` 作为整体 key，只要任一子字段被覆盖则标注 `"overrides"` | 与 Mode 级、Gate 级的粒度一致（都是"顶层结构"级） | 用户无法从 fieldSources 得知具体哪个子字段被覆盖 |
| B | 每个被覆盖的子字段生成独立 key：`"parallel_scheduling.max_concurrent_tasks": "overrides"` | 更精确，`--annotate` 可以在具体字段上打注释 | 与 Mode/Gate 粒度不一致，fieldSources 键数量动态 |

**推荐答案**：**选项 A**——`"parallel_scheduling"` 作为整体 key。理由：与 Mode 级和 Gate 级的粒度设计保持一致（FR-005 明确"不下钻到 phase 数组元素"，同理 parallel_scheduling 也不下钻到字段级），实现复杂度低。

**决策权**：实现侧可决定

---

## 二、CLI 行为歧义

### CL-004 — `--format json` 时 `--annotate` 的行为

**问题**：spec.md FR-010 定义 `--annotate` 在 YAML 输出中添加行内注释，`--format json` 输出 JSON 结构体（JSON 不支持注释）。两者同时传入时行为未定义；Edge Cases 章节也未覆盖此组合。

**影响**：FR-010、FR-011（退出码约定）、AC-002、AC-003、CLI 用户体验

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `--format json --annotate` 时，`--annotate` 被静默忽略；`fieldSources` 已在 JSON 结构体中，信息不丢失 | JSON 输出已含 fieldSources，`--annotate` 的语义价值不增加；静默忽略最简单 | 用户传入 `--annotate` 没有任何反馈，可能困惑 |
| B | `--format json --annotate` 时，stderr 输出 `[info] --annotate 在 --format json 模式下无效，来源信息已包含在 fieldSources 字段中`，JSON 输出正常 | 明确告知用户，不是错误只是提示 | 增加一条固定 info 输出，对脚本解析有轻微干扰 |
| C | 视为 CLI 参数错误，退出码 1，stderr 输出 "不能同时使用 --annotate 和 --format json" | 强制用户做显式选择 | 过于严格，`fieldSources` 已包含等效信息，无需报错 |

**推荐答案**：**选项 B**——静默忽略 `--annotate` 但输出一条 info 提示。理由：不破坏脚本管道（JSON 正常输出），同时明确告知用户原因，防止"配置明明传了但没生效"的困惑。

**决策权**：实现侧可决定

---

### CL-005 — `--annotate` 的注释粒度（OQ-001）

**问题**：这是 spec.md 原始 OQ-001。当前 spec.md FR-005 和 FR-010 均明确限定 `--annotate` 只标注 Mode 级和 Gate 级的 source，不下钻到 phase 数组元素。用户调试时，`modes.fix: # source: overrides` 是否足够？还是需要在每个 phase 元素上也打来源注释？

**影响**：FR-005、FR-010、fieldSources 数据结构复杂度、`mergeOrchestrationConfigs()` 实现（需不需要记录 phase 级来源）

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 维持当前设计——Mode 级和 Gate 级注释，不下钻到 phase 元素 | spec.md 已锁定（FR-005 明确"不下钻"）；Phase 整段替换语义下，phase 级来源必然全是 overrides，注释无额外信息量；`fieldSources` 结构简单 | 用户想知道"哪个 phase 字段来自 base"时无法分辨，但 Mode 整段替换语义下这个问题其实无意义 |
| B | 对 `phases` 数组每个元素打 `# source: overrides` 注释（因整段替换，来源必然是 overrides） | 视觉上更完整 | fieldSources 需记录动态数量的 phase 路径；实现复杂度中等增加；信息重复（整段替换时每个 phase 的来源必然相同） |
| C | MVP 维持选项 A；二期在 phase patch 功能落地时再扩展到 phase 级 source 标注 | 与产研汇总 Phase 2 路线图对齐 | 无短期代价 |

**推荐答案**：**选项 A / C 合并**——MVP 维持 Mode/Gate 级粒度，spec.md 当前表述无需修改。理由：Mode 整段替换语义下，phase 级 source 标注提供零增量信息（所有 phase 来源必然相同）；复杂度代价与信息收益不成比例；Phase 2 引入 phase patch 时再扩展是最自然的演进路径。

**决策权**：实现侧可决定（spec.md 已有 FR-005 明确约定，本条确认不需要修改）

---

### CL-006 — mode 不存在时退出码是否区分"用户错误"和"系统错误"

**问题**：spec.md FR-011 规定"指定的 mode 在合并后不存在"退出码为 1。但 Unix 惯例中退出码 1 通常是"通用错误"，有些工具用 2 表示"参数错误（用户输入问题）"。当前 spec.md 没有区分"用户传入了不存在的 mode"和"系统内部错误（如 resolver 抛出未捕获异常）"。

**影响**：FR-011、AC-001 的退出码验证、`orchestrator-cli.mjs` 的错误处理分支

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 统一使用退出码 1 表示所有不可恢复错误（当前 spec.md 设计） | 简单，与现有 `orchestrator-cli.mjs` 错误处理一致；脚本调用方只需 `if exitcode != 0` | 无法从退出码区分用户错误和系统错误 |
| B | 退出码 1 = 系统内部不可恢复错误；退出码 2 = 用户输入错误（无效 mode 名、无效参数组合） | 符合 POSIX 惯例（参数错误用 2）；脚本可分支处理 | 需要更改 FR-011 和 AC 验收标准；现有命令需确认是否也遵循此约定 |

**推荐答案**：**选项 A**——维持退出码 1 统一，不区分。理由：本 Feature 工具定位是开发者内部 CLI，不是要被复杂脚本广泛解析的基础设施；引入退出码 2 需要修改 FR-011 和多个 AC，增量改动不值得；现有 `orchestrator-cli.mjs` 也没有此区分，保持一致。

**决策权**：实现侧可决定

---

## 三、降级路径歧义

### CL-007 — 纯注释或 `{}` 的 overrides 文件是否等同于"文件不存在"

**问题**：spec.md Edge Cases 仅说"零字节文件解析结果为空对象，等效于无 overrides，静默使用 base，不输出 diagnostic"。但以下三种情形未明确：(1) 文件内容仅为 YAML 注释行（`# this is a comment`），`simple-yaml.mjs` 解析结果可能是 `null` 或 `{}`；(2) 文件内容为 `{}`（空对象），明确是空 overrides；(3) 文件内容为 `---`（仅 YAML 文档开始符）。这三种情形各自触发哪条降级路径？

**影响**：FR-001、FR-003、FR-006 降级策略表、US-3 验收场景第 3 条

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 解析结果为 `null` → 视为空对象；解析结果为 `{}` 或空对象 → 等同于"文件不存在"，静默使用 base，不输出 diagnostic；解析结果为非 object（如 string / number）→ 视为 schema 校验失败 | 用户意图明确：空文件 = 尚未配置；简单直觉 | 需要 resolver 在合并前判断 parse 结果类型 |
| B | 统一：只要文件存在且可读，不论内容如何，尝试 Zod schema parse；空对象 / `{}` 会通过 Zod（`version` 必填 → 校验失败 → fallback + warning） | 逻辑路径统一，`version` 必填做了兜底过滤 | 空文件会触发 warning diagnostic，可能让用户困惑 |
| C | 解析成功且结果是 object（含空对象）→ 进入 Zod 校验；解析失败（`null`、异常）→ parse-error warning；Zod 校验空对象时因 `version` 必填失败 → schema-fallback warning | 最严格，任何"存在的文件"都走完整校验流程 | 纯注释文件会导致 warning，体验稍差但行为可预期 |

**推荐答案**：**选项 A**——解析结果为 falsy / 空对象时，等同于"无 overrides"，静默使用 base，不输出 diagnostic。理由：与 Edge Cases 章节"零字节文件 → 静默使用 base"的现有表述一致；用户刚创建空 overrides 文件时不应看到警告；`version` 必填校验的副作用不应用来过滤空文件。

**决策权**：实现侧可决定（但实现时需在 `orchestration-resolver.mjs` 中明确写入此判断逻辑，否则选项 B 或 C 都可能被自然实现出来）

---

### CL-008 — overrides `version` 与 base 不一致时的降级行为精确语义

**问题**：spec.md FR-007 说"version 不一致触发 Zod schema 校验失败降级"，FR-006 降级表第二行"Zod schema 校验失败 → schema-fallback warning"。但实现方式有两种：(1) Zod schema 在 `version` 字段上做 `.refine()` 校验（需要在 schema 实例化时注入 base version 值）；(2) Zod schema 只校验 `version` 格式为 string，resolver 在合并后额外做版本比对，不匹配则手动发出 schema-fallback diagnostic 并 fallback。两种方式对 schema 的设计和 diagnostic code 的语义有影响。

**影响**：FR-007、FR-013（orchestration-overrides-schema.mjs 的 Zod schema 设计）、AC-013

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | Zod schema 只校验 `version` 为 string；resolver 在 parse 后额外比对，不一致时发出 `schema-fallback` diagnostic 并 fallback | schema 保持纯静态（不依赖运行时状态）；逻辑在 resolver 中集中，更易测试 | `version` 不一致用了 `schema-fallback` code 而不是更精确的 `version-mismatch` code，信息略粗 |
| B | 新增 diagnostic code `orchestration-overrides.version-mismatch`，version 不一致时发出此 code（而非复用 `schema-fallback`）；resolver 负责比对并发出 diagnostic | 语义更精确，用户看到 version-mismatch 立刻知道怎么修 | 需要修改 spec.md 的 Diagnostic code 清单（增加 `version-mismatch` 条目）；轻微范围扩展 |
| C | Zod schema 使用工厂函数（`createOrchestrationOverridesSchema(baseVersion)`），通过 `.refine()` 在 schema 层完成版本校验 | schema 完全自描述，不需要 resolver 额外比对 | schema 工厂函数与 base 产生耦合，违反 schema 纯静态原则 |

**推荐答案**：**选项 B**——新增 `orchestration-overrides.version-mismatch` diagnostic code，在 resolver 层做版本比对。理由：版本不匹配是高频真实错误场景，用户需要精确的错误码快速定位；实现代价极小（仅多一个 diagnostic code 常量）；`schema-fallback` 语义保留给"真正的 schema 结构问题"更清晰。

**决策权**：**GATE_DESIGN 必须审批**（需要修改 spec.md 的 Diagnostic code 清单，轻微改变合同范围）

---

## 四、合并语义边界

### CL-009 — overrides 中显式声明 `modes.fix: null` 的处理

**问题**：spec.md FR-004 定义合并语义但未覆盖"用户显式声明某 mode 为 null 想清空该 mode"的情形。YAML 中 `modes:\n  fix: ~` 会被解析为 `{ modes: { fix: null } }`。`mergeOrchestrationConfigs()` 遇到 null value 时，是删除该 mode、保留 base 值、还是触发 schema 校验失败？

**影响**：FR-004、`mergeOrchestrationConfigs()` 函数的边界处理逻辑、NFR-003（schema 使用 `.strict()` 策略）

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | Zod schema 对 `modes.<m>` 的值类型定义为 `ModeOverrideSchema`（object），null 值导致 Zod 校验失败 → schema-fallback warning → 降级 base | 防御性最强；null 不是合法的 mode 覆盖语义；用户意图含糊（删除？清空？）统一拒绝 | 用户如果真的想删除某 mode 没有合法途径 |
| B | null 值被 resolver 在合并前过滤掉，视为"未声明该 mode"；保留 base 中对应 mode | 宽容策略；不崩溃；用户写 null 可能是误操作 | 没有任何 diagnostic 提示用户 null 被忽略，静默行为 |
| C | 同选项 A，但在 schema 层 reject 时增加一条 info diagnostic 指引用户"如果要删除 mode，请参考文档" | 清晰告知用户 null 不合法 + 提供修复建议 | 需要一条额外的 schema 层特殊错误处理 |

**推荐答案**：**选项 A**——Zod schema 对 mode value 类型为 object，null 导致校验失败、fallback base。理由：null 语义在本 feature 的合并模型中没有明确含义（MVP Out of Scope 未定义"删除 mode"操作）；schema 校验失败已有 warning diagnostic 提示用户检查配置；用户修改后再运行即可修复。

**决策权**：实现侧可决定

---

### CL-010 — overrides 中 `parallel_groups.*` 字段的处理方式

**问题**：spec.md FR-004 表格末行"parallel_groups.* → MVP 不支持覆盖，保留 base 值不变"，数据契约章节也注明"`parallel_groups` 字段不支持，schema reject 此字段"。但 AC-013 只说"parallel_groups 字段被 schema reject"。这意味着用户在 overrides 中声明了 `parallel_groups` 时，是 schema 校验失败（fallback base + warning）还是字段被 schema strip 后继续（partial schema validation）？

**影响**：FR-004、AC-013、NFR-003（`.strict()` 策略）、`orchestrationOverridesSchema` 的 `parallel_groups` 字段定义

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `parallel_groups` 字段出现在 overrides 中 → 整个 overrides Zod 校验失败 → schema-fallback warning → 降级 base（与 `.strict()` 一致） | 用户误写 `parallel_groups` 会导致所有 override 失效，报错清晰 | 用户可能同时配置了合法的 gate 覆盖，因一个不支持字段全部失效，体验差 |
| B | schema 对 `parallel_groups` 字段使用 `.strip()`（移除但不报错），其他合法字段正常合并；resolver 额外发出 `warning` diagnostic（code: 新增 `orchestration-overrides.unsupported-field`）提示用户 `parallel_groups` 被忽略 | 宽容策略，不让一个不支持字段破坏其他合法 overrides | 与 NFR-003 的 `.strict()` 策略冲突；需要新增 diagnostic code |
| C | schema 使用 `.strict()` 但对 `parallel_groups` 明确加入 `z.never()` 类型（或在 schema 层 strip + resolver 层发 warning），实现"特殊字段 strip + 告知"行为 | 精确控制哪些字段被 strip | 实现稍复杂，需要在 schema 和 resolver 两层处理 |

**推荐答案**：**选项 B**——strip `parallel_groups` 并发出 warning diagnostic，不让整个 overrides 因此失效。理由：用户完全可能在 CI 迁移时先加了 `parallel_groups`（等待二期支持），让合法的 gate overrides 因此全部失效是不合理的降级代价；需要在 spec.md 的 Diagnostic code 清单中新增 `orchestration-overrides.unsupported-field`。

**决策权**：**GATE_DESIGN 必须审批**（与 NFR-003 `.strict()` 策略有直接冲突，需要决策是"严格拒绝"还是"友好 strip"）

---

## 五、测试与验证歧义

### CL-011 — "base 不可读"场景的测试实现方式

**问题**：FR-018 要求 T2 测试覆盖"base 不可读"情形，但 base `orchestration.yaml` 是 plugin 内置文件，测试中无法真实删除。如何模拟这一情形？spec.md 未指定测试策略（mock fs 还是依赖注入）。

**影响**：FR-018（T2 四种降级路径测试）、`orchestration-resolver.mjs` 的可测试性设计（是否支持注入 `loadBaseFn` 参数）

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `resolveOrchestrationConfig()` 接受可选 `_loadBase` 函数参数（依赖注入），测试时传入抛出异常的 mock 函数 | 无需 mock fs；函数签名轻微扩展（可选参数不破坏 NFR-002） | 函数签名多一个测试用参数，稍显"测试污染" |
| B | 使用 `node:test` 的 `mock.module()` 或 `mock.method()` mock 文件系统读取操作（`fs.readFile`）；测试结束后 restore | 不污染函数签名；标准 mock 实践 | `node:test` 的 mock 能力相对 vitest 较弱；mock `fs` 可能影响同测试进程中的其他 I/O |
| C | 创建临时测试目录，覆盖 `pluginRoot` 指向不含 orchestration.yaml 的目录，间接模拟 base 不可读 | 真实文件系统，不依赖 mock | 需要测试辅助函数创建/清理临时目录；`pluginRoot` 需要是可配置参数 |

**推荐答案**：**选项 A**——依赖注入可选 `_loadBase` 参数。理由：`project-profile-resolver.mjs` 范本实际上也有类似的测试设计；`node:test` mock 能力有限；可选参数对函数签名的影响可忽略（调用方默认不传，行为与当前完全一致）。

**决策权**：实现侧可决定（plan 阶段确认 `resolveOrchestrationConfig` 函数签名是否接受 `_loadBase` 测试钩子）

---

### CL-012 — `npm run repo:check` 返回 `warning` 时的退出码

**问题**：spec.md FR-016 规定 `validateOrchestrationOverrides()` 返回 `{ status: "ok" | "warning" | "error", ... }`。AC-008 说"合法 overrides → 通过"，AC-009 说"非法 overrides → 退出码非零"。但当 `validateOrchestrationOverrides()` 返回 `status: "warning"` 时（如 overrides 文件存在但有轻微问题），整个 `repo:check` 命令退出码是 0 还是非零？其他已有校验器如何处理 warning？

**影响**：FR-016、AC-008、AC-009、US-6 验收场景 2

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | `warning` → 退出码 0（命令通过）；`error` → 退出码非零；与现有 `validateWrapperSources()` 的行为保持一致 | 不打破 CI 流程；warning 仅作为提示 | 有 warning 的项目 `repo:check` 通过，CI 无感知 |
| B | `warning` → 退出码非零（CI 失败）；仅 `ok` → 退出码 0 | 严格；CI 会强制修复所有 warning | 可能过于严格，影响已有项目的 CI 通过率 |

**推荐答案**：**选项 A**——warning 退出码 0，error 退出码非零。理由：需要先确认现有 `validateWrapperSources()` 等校验器的 warning 处理方式（FR-017 要求"不得修改其他校验器行为"），新校验器应与之保持一致；从 AC-009 的描述看，只有"非法 overrides（schema 失败）"才期望退出码非零，这对应 `status: "error"` 而非 `"warning"`。

**决策权**：实现侧可决定（plan 阶段读取 `repo-maintenance-core.mjs` 的 `aggregateValidation` 实现，确认 warning 的退出码处理方式）

---

## 六、文档与同步歧义

### CL-013 — `docs/shared/agent-orchestration-overrides.md` 内容定位

**问题**：spec.md FR-020 说该文档通过 `npm run docs:sync:agents` 同步到 `AGENTS.md` 和 `CLAUDE.md`，用于"说明项目级流程定制约定"。但文档读者有两类：(1) 项目维护者（需要知道"如何写 overrides 文件"）；(2) AI agent（需要知道"执行编排时是否应感知 overrides"）。这两类读者的信息需求不同，应以哪类为主？

**影响**：FR-020、docs/shared 文档质量、AGENTS.md / CLAUDE.md 的信噪比

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 以 AI agent 视角为主——说明"agent 在执行编排时，orchestration-resolver 已自动感知 overrides，无需 agent 手动检查"；避免包含过多用户操作指引 | 与 docs/shared/ 中其他 agent 行为规则一致；防止 AGENTS.md 膨胀 | 用户需要另外看 `orchestration-overrides-contract.yaml` 或 `example.yaml` 了解如何写配置 |
| B | 两类内容都包含：一节给 agent（行为约定），一节给用户（配置指引） | 信息完整 | 文档较长，同步进 AGENTS.md 会增加 token 占用 |
| C | 仅包含 agent 约定（1-3 条），与 `## 行为与交互约定` 等章节风格一致；用户指引放入 `contracts/orchestration-overrides-contract.yaml` | 职责分明；docs:sync 管道的共享文档保持精简 | 需要确认 contracts yaml 作为用户文档的可发现性 |

**推荐答案**：**选项 C**——docs/shared 文档仅包含 agent 约定（精简 1-3 条），用户操作指引集中在 `contracts/orchestration-overrides-contract.yaml` 和 `templates/orchestration-overrides.example.yaml`。理由：与现有 docs/shared 文档风格（如 `agent-branch-sync-policy.md`）一致；避免 AGENTS.md 膨胀。

**决策权**：实现侧可决定

---

### CL-014 — `templates/orchestration-overrides.example.yaml` 是否纳入 init-project 复制流程

**问题**：spec.md FR-019 只说"提供示例文件"，未说明该文件是否应被 `init-project.sh`（如果存在）复制到新项目的 `.specify/` 目录作为起点模板。若复制，新项目会立即获得一个合法 overrides 文件（含 `version` 字段），开箱即用；若不复制，只作为 docs 引用，用户需要手动创建。

**影响**：FR-019、用户首次使用体验、与现有 `init-project.sh` 或等效工具的集成

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 仅作为 docs 引用，不复制到新项目（当前 spec.md 设计） | 简单；overrides 是可选配置，不应强制生成；与"文件不存在 → 静默使用 base"的降级策略匹配 | 首次使用需要手动参考 example 文件创建 |
| B | `init-project.sh`（或等效 CLI）将 example 复制到 `.specify/orchestration-overrides.yaml.example`（带 `.example` 后缀，不实际生效）；用户按需重命名 | 提供起点模板，降低使用门槛 | 需要确认 init-project 流程是否存在；文件后缀约定需一致 |

**推荐答案**：**选项 A**——仅作为 docs 引用，不复制。理由：overrides 是项目级可选配置，强制生成会产生用户不必要维护的文件；`example.yaml` + `contract.yaml` 文档组合已足够指导用户按需创建。

**决策权**：实现侧可决定

---

## 七、兼容性边界

### CL-015 — `.specify/spec-driver.config.yaml` 与 `orchestration-overrides.yaml` 的作用范围分界

**问题**：仓库中已存在 `.specify/spec-driver.config.yaml`（推测为用户行为偏好配置），本 Feature 新增 `.specify/orchestration-overrides.yaml`（流程结构配置）。spec.md FR-021 说"project-context.yaml 的 forbidden_changes 追加旁注：流程结构覆盖放 orchestration-overrides.yaml"，但未说明 `spec-driver.config.yaml` 与 `orchestration-overrides.yaml` 的关系。用户可能混淆两者。

**影响**：FR-021、用户文档清晰度、`docs/shared/agent-orchestration-overrides.md` 的说明范围

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | 在 `contracts/orchestration-overrides-contract.yaml` 中增加一节明确说明两者分工；spec.md 不修改 | 不改变实现范围，仅文档层面澄清 | 需要额外写清楚分工文字 |
| B | spec.md FR-021 扩展表述，增加一句说明"spec-driver.config.yaml 控制行为偏好（如 verbosity、timeout），orchestration-overrides.yaml 控制流程结构（phases / gates）" | 就近在 spec 中澄清 | 轻微扩展 FR-021 内容 |

**推荐答案**：**选项 A**——文档层面澄清，不修改 spec.md。理由：本澄清不影响任何实现范围，属于文档质量问题；plan 阶段在写 `contract.yaml` 时自然覆盖此分工说明。

**决策权**：实现侧可决定

---

### CL-016 — 双校验链路长期技术债（OQ-002）

**问题**：这是 spec.md 原始 OQ-002。当前设计明确分工：base config 走手写 `validateOrchestrationYaml()`（`orchestrator.mjs:188-210`），merged config 走 Zod schema。两者并存会随时间漂移（如 base 新增字段，手写校验不更新但 Zod schema 更新，形成不一致）。是否在本 Feature 顺带将 base config 校验迁移到 Zod？

**影响**：`plugins/spec-driver/lib/orchestrator.mjs`（`validateOrchestrationYaml()` 函数）、实现范围（工作量增量约 +50-80 行）、FR 总范围、OQ-002 关闭

**候选答案**：

| 选项 | 描述 | 理由 | 代价 |
|------|------|------|------|
| A | MVP 保留双校验链路，在 `orchestration-resolver.mjs` 的注释中标注"TODO: 二期统一迁移到 Zod"；本 Feature 不触动 `orchestrator.mjs` | 最小改动原则；不引入 `orchestrator.mjs` 的回归风险；`orchestrator.mjs` 是高影响文件（8 个 SKILL.md 依赖） | 技术债明确存在，但有文档化记录 |
| B | 本 Feature 顺带将 `validateOrchestrationYaml()` 迁移到 Zod schema（使用同一个 `orchestrationBaseSchema`）；两套校验合并为一套 | 一次性解决 R8 风险；Zod 校验统一，未来维护成本低 | 工作量增量 +50-80 行；需要修改 `orchestrator.mjs` 的高影响文件；需要额外的回归测试 |
| C | 折中方案：本 Feature 新增 `orchestrationBaseSchema`（Zod），但暂不删除 `validateOrchestrationYaml()`；在 `orchestrator.mjs` 中追加 Zod 校验作为辅助验证（若两者结果不一致则 warn），二期删除手写版本 | 渐进式迁移，无回归风险；提前暴露两套校验的不一致点 | 短期内存在"双重校验"的复杂度 |

**推荐答案**：**选项 A**——MVP 维持双校验链路，文档化 TODO。理由：spec.md R8 风险评估已是"低概率、中影响"，两套校验"校验的字段集合不重叠时不产生冲突"（R8 缓解策略）；`orchestrator.mjs` 是高影响文件，本 Feature 完全不需要触碰该文件；研究汇总已建议"plan 阶段再做一次双校验链路的精确分工设计"，本 Feature 先执行完验证迁移策略的价值。

**决策权**：**GATE_DESIGN 必须审批**（影响本 Feature 是否触动 `orchestrator.mjs`、实现范围是否扩大）

---

## GATE_DESIGN 待审批清单

以下条目有实质范围影响或 spec.md 合同变更，必须在 GATE_DESIGN 阶段由用户确认后方可进入 plan：

| 编号 | 问题标题 | 推荐答案 | 不决策的风险 |
|------|---------|---------|------------|
| **CL-001** | overrides 中自定义 mode 名的合法性边界 | 选项 B：`modes` key 做 enum 校验，拒绝非 base reserved name | schema 设计可能与 Edge Cases 描述矛盾，实现时出现分歧 |
| **CL-008** | `version` 不一致时是否新增 `version-mismatch` diagnostic code | 选项 B：新增 `orchestration-overrides.version-mismatch` code | 实现侧可能复用 `schema-fallback`，诊断信息对用户不够精确 |
| **CL-010** | `parallel_groups` 字段出现时 strip + warn 还是整体 schema 失败 | 选项 B：strip 并发出 warning diagnostic，不使全部 overrides 失效 | 与 NFR-003 `.strict()` 策略产生冲突，实现时无法自行决策 |
| **CL-016** | 双校验链路（OQ-002）：是否本 Feature 顺带迁移 base config 到 Zod | 选项 A：MVP 保留双链路，文档化 TODO | 若 GATE_DESIGN 期望本 Feature 消除技术债，需要扩大 FR 范围 |

---

> **本次澄清完成，共识别 16 条问题，其中 4 条需 GATE_DESIGN 用户审批，12 条实现侧可自决。**
