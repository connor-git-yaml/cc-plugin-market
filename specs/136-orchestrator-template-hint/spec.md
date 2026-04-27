# Spec — 136: orchestrator-cli generate-template + schema-fallback hint + loader-error 诊断

## 背景与动机
Feature 133 落地后，用户在写 `.specify/orchestration-overrides.yaml` 时碰到三个高频痛点：
1. mode 整段替换要求完整 phase 对象（8+ 字段），文档示例只写了 `id+name`，首次使用必然碰壁——`schema-fallback` 一次性打出 28 个字段错误，无修复引导
2. 即使知道字段要求，也没有便捷方式获取参考模板，只能翻 `orchestration.yaml` 复制粘贴
3. `_loadOverrides` 注入函数（135 引入，供测试用）抛出非 YAML 错误时，被错误归类为 `parse-error`，message 写"YAML 解析失败"，语义不准确（Codex 对抗审查轴 5 标记 warning）

本 story 同时解决这三个问题：
- 新增 `generate-template <mode>` 子命令解决问题 2
- 在 schema-fallback 报错末尾追加 hint 引导用户去用 `generate-template`，闭环修复 B2（问题 1）
- 拆分 `loader-error` 与 `parse-error` 两个 diagnostic code，准确反映错误来源（问题 3）

## User Stories

### US-1: 用户从零写 mode override
作为 spec-driver 用户，我想知道一个 mode 的完整 phase 结构，这样我可以基于模板修改而不是凭空写。

- **AC-1.1**: `node orchestrator-cli.mjs generate-template fix` 输出可直接保存为 `.specify/orchestration-overrides.yaml` 的合法 YAML
- **AC-1.2**: 输出包含 `version` 字段、`modes.<mode>` 完整结构、所有 phase 字段（含 `gates_before/gates_after/conditional/skip_if_exists/is_critical`）
- **AC-1.3**: 输出顶部有引导注释（"由 generate-template 生成；修改 phases 内容后保存..."）
- **AC-1.4**: 输出可被 `orchestrator-cli effective-orchestration <mode>` 立即识别，无 schema-fallback diagnostic（roundtrip 验证）
- **AC-1.5**（边界）：`generate-template <invalid-mode>` 退出码为 1，stderr 输出错误信息（含合法 mode 列表），与 `effective-orchestration` 行为一致
- **AC-1.6**（输出风格）：phase 之间用空行分隔，缩进 2 空格，字段顺序遵循 `phaseSchema` 定义顺序，整体风格与 `plugins/spec-driver/config/orchestration.yaml` 保持一致

### US-2: 用户写错 phase 格式时获得修复引导
作为不熟悉完整 schema 的用户，我希望在写错 phase 格式时被告知如何获取正确模板，避免逐字段试错。

- **AC-2.1**: 当 `orchestration-overrides.yaml` 中 `modes.*.phases.*` 的字段缺失触发 schema-fallback 时，diagnostic message 末尾追加 hint 行
- **AC-2.2**: hint 文本明确引用 `orchestrator-cli generate-template <mode>` 命令名（`<mode>` 替换为命中错误的实际 mode 名）
- **AC-2.3**: hint 仅在 issues 命中 `modes.*.phases.*` 路径时附加；其他类型的 schema 错误（如 mode 名 typo、gate 字段错误、parallel_scheduling 错误）不附 hint

### US-3: CLI 子命令支持项目根参数
作为外部项目使用方，我希望 `generate-template` 与其他子命令一样支持 `--project-root`，便于工作目录灵活。

- **AC-3.1**: `generate-template fix --project-root <path>` 正常工作
- **AC-3.2**: 默认 `process.cwd()`

### US-4: loader-error 与 parse-error 拆分
作为 resolver 维护者，我希望注入函数（`_loadOverrides`）抛错与文件 IO/YAML 解析失败被区分到不同 diagnostic code，避免排查时被误导。

- **AC-4.1**: 当 `_loadOverrides` 注入函数抛出异常时，diagnostic code 为 `orchestration-overrides.loader-error`，message 不再写"YAML 解析失败"
- **AC-4.2**: 当文件路径方式（`fs.readFileSync` + `parseYamlDocument`）抛出异常时，diagnostic code 仍为 `orchestration-overrides.parse-error`，message 保持原状
- **AC-4.3**: 两种 diagnostic 都触发降级到 base config，行为不变（仅 code 和 message 区分）
- **AC-4.4**: `docs/shared/agent-orchestration-overrides.md` 的 diagnostic codes 表新增 `loader-error` 行

## 非功能要求

- **NFR-1**: 输出格式跟 `effective-orchestration --format yaml` 风格一致（见 AC-1.6）
- **NFR-2**: 不引入新依赖（复用现有 yaml 序列化器 `orchestration-output-serializer.mjs`）
- **NFR-3**: schema-fallback hint 不破坏现有 diagnostic 结构（仅在 message 末尾追加文本，code 不变）
- **NFR-4**: 测试覆盖
  - generate-template happy path（fix mode 输出 + roundtrip）
  - generate-template invalid mode → exit 1 + stderr
  - schema-fallback hint 命中（写不完整 phase override → message 末尾出现 hint）
  - schema-fallback hint 不命中（mode 名 typo → message 不附 hint）
  - loader-error 诊断（注入抛错的 `_loadOverrides` → diagnostic code = loader-error）

## 非目标（Non-goals）

明确**不在**本 story 范围的事，避免后续被误读为"已解决"：

1. **整段替换语义本身的痛点**：mode override 仍要求用户提供完整 phase 对象，本 story 仅通过 generate-template 降低获取模板的门槛，**没有**改变 schema 的"整段替换"语义。真正的局部覆盖（phase_patch / patches）是下一个独立特性（暂编号 137），需要单独 spec 周期：
   - phase_patch 的 schema 设计（`add_phase` / `remove_phase` / `update_phase_field` 等操作）
   - 多个 patch 顺序与冲突处理
   - 调研其他系统的局部覆盖实践（Helm overlays、Kustomize patches、JSON Merge Patch 等）

2. **`generate-template` 不支持 `--format json`**：仅输出 YAML，因为目标用例是粘贴到 `.specify/orchestration-overrides.yaml`。如果未来需要给程序消费，再单独加。

3. **不支持自定义 phase 子集生成**（如只输出 verify phase）：复杂度高、用例少，目前不做。

4. **不支持反向**（从用户的 overrides.yaml 推导 patch）：这属于二期 phase_patch 功能。

5. **除 schema-fallback 外的 diagnostic 类型不加 hint**：parse-error、version-mismatch、unsupported-field 都已经有清晰错误信息，加 hint 反而是噪音。
