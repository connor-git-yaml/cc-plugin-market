# Feature 213 澄清扫描（clarify phase，供 GATE_DESIGN 使用）

范围：spec.md 中除 OQ-001（waiver 表达方式）/ OQ-002（marketplace 是否 ship）/ OQ-004（Codex 适配目录落位）之外的欠明确点。hooks 字段问题（AUTO-RESOLVED）与 marketplace 必要性（已有决定性实测证据）不重开。

## 1. 无需澄清项（已确认明确的关键维度）

- **两份 manifest 的 canonical 字段来源**：FR-001/FR-002 明确 version/description 均来自 `contracts/release-contract.yaml`，不允许手改，口径清晰。
- **FR-003 MCP 引用方式**：`"mcpServers": "./.mcp.json"` 字段与本机实测 schema 一致，无歧义。
- **FR-006 hooks 交付边界**：manifest 不声明 hooks 字段、脚本随包 ship 但不验证触发行为，边界清楚（且已 AUTO-RESOLVED，不重开）。
- **FR-007/FR-009 校验接入点**：明确复用 `aggregateValidation` 模式接入既有 `repo:check`/`release:check`，不新增独立命令，接入方式无歧义。
- **FR-010 双层验证策略**：结构性断言必选、真实 CLI 复核可选加强，优先级与降级路径已写清，可直接指导测试设计。
- **FR-011 Claude 侧不变量**：明确列出 4 个 canonical 制品文件路径，边界清晰、可机械验证（测试结果不变）。
- **FR-012 waiver 覆盖对象**：明确限定为当前唯一已知缺口（refactor wrapper 9 vs 8），未来 A2 移除后矩阵行为的期望（无需改校验逻辑本身）已写明；具体存储形式留给 OQ-001，不构成新歧义。
- **FR-013 marketplace schema**：字段结构（`name/interface/plugins[]/source/policy/category`）取自本机实测，非臆测，格式无歧义（仅命名取值待 OQ-002 拍板，不重开）。
- **Edge Case「local 版本缓存混淆」**：已明确指出矩阵校验版本号时需排除/特殊处理 `local`，处理原则清楚，具体判断逻辑属实现细节，非产品级歧义。
- **Non-Goals 边界（A2/A3/A4）**：三个后续 feature 的边界表述清楚，未在 FR/SC 中出现越界描述。
- **术语一致性**：「一致性矩阵」「Codex 适配 skills 目录」「已知缺口 Waiver」等 Key Entities 均有明确定义且在 FR/SC 中用法统一，未发现同义词漂移。

## 2. 建议澄清项（新发现的欠明确点，均为 NON-BLOCKING，给出默认解释）

### 澄清点 1：FR-004「Spectra skills 目录内容 runtime 中立、可直接复用」的假设未经实测验证

- **定位**：FR-004 / Edge Case（Codex manifest 引用的 skills 目录内容与 Claude canonical skills 目录不能直接复用）
- **欠明确处**：FR-004 断言 `plugins/spectra/skills/` 内容不含 Claude 专属工具引用（如 Task tool、`mcp__plugin_spectra_spectra__*`），因此可被 `.codex-plugin/plugin.json` 直接引用而无需像 Spec Driver 那样生成 Codex 适配 wrapper 目录。但 `_grounding.md` 与本机实测记录中未见对 Spectra 3 个 skill 文件内容的实际 grep/扫描证据，这一断言目前是**未经验证的假设**，而非像 FR-005/hooks 字段那样有实测背书的结论。若假设不成立（例如 spectra skill 文档中引用了 Claude 专属 MCP 工具名），会直接影响 US-1 的"一次安装即获得完整能力"承诺与 SC-002 类比对齐的判定基线。
- **建议默认解释**：plan 阶段实现前，先对 `plugins/spectra/skills/{spectra,spectra-batch,spectra-diff}/SKILL.md` 做一次内容扫描（grep `Task tool` / `mcp__plugin_spectra_spectra__` / 其他 Claude 专属 namespace 引用）；若扫描确认无此类引用，FR-004 按现表述执行（直接复用目录）；若发现污染，则将 Spectra 一并纳入与 Spec Driver 相同的「Codex 适配目录生成」路径（即 FR-004 退化为与 FR-005 同构的约束），不需要用户在 clarify 阶段拍板，作为 plan 阶段的前置校验步骤记录即可。

### 澄清点 2：一致性矩阵新增 check 的具体 id / contract 文件命名未固定

- **定位**：FR-007（"如 `codex-plugin-consistency`"用词为示例而非强制）/ 复杂度评估中的 `contracts/<name>.yaml` + `scripts/lib/<name>-core.mjs`
- **欠明确处**：spec 层面只给出了模式（`aggregateValidation(prefix, validateX(...), ...)` + `contracts/<name>.yaml`），未固定具体命名（check id 前缀、contract 文件名），这是纯工程实现细节，不影响产品行为或验收口径，但若不给默认值，plan 阶段可能出现命名风格不一致。
- **建议默认解释**：沿用仓库现有命名惯例——check 前缀用 `codex-plugin`（如 `codex-plugin.skill-count-mismatch`、`codex-plugin.marketplace-entry-missing`），contract 文件命名为 `contracts/codex-plugin-consistency.yaml`，实现模块为 `scripts/lib/codex-plugin-consistency-core.mjs`，导出 `validateCodexPluginConsistency({projectRoot})`。若 plan 阶段有更优命名可覆盖此默认值，无需用户拍板。

## 3. 结论

**NON-BLOCKING**：全部发现点均有合理默认解释，可带默认进入 plan 阶段；OQ-001/OQ-002/OQ-004 仍是唯一需 GATE_DESIGN 用户拍板的决策点（本次扫描未发现需追加的新 BLOCKING 项）。
