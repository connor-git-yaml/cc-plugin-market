# Tasks — 136: orchestrator-cli generate-template + schema-fallback hint + loader-error

## Task 1 — orchestration-resolver.mjs 改造（US-2 + US-4）

**文件**: `plugins/spec-driver/lib/orchestration-resolver.mjs`

- [ ] 步骤 4（约 L246-265）：拆分 `_loadOverrides` 与文件路径的 try/catch，新增 `loader-error` 诊断分支
- [ ] 步骤 7（约 L315-322）：检测 issues 中是否命中 `modes.<m>.phases.*` 路径，命中则在 message 末尾追加 hint 行（含 mode 名变量替换）
- [ ] 关键边界：hint 检测仅命中 `path[0]==='modes' && path[2]==='phases'` 且 `path.length >= 4` 的 issue；不要影响 mode 名 typo（L1 path）和 gate 字段错误的 message

## Task 2 — orchestrator-cli.mjs 新增 generate-template 命令（US-1 + US-3）

**文件**: `plugins/spec-driver/scripts/orchestrator-cli.mjs`

- [ ] 在 `cmdEffectiveOrchestration` 后新增 `cmdGenerateTemplate(mode, { projectRoot })` 函数
  - 复用 `resolveOrchestrationConfig` 取得 base config
  - 校验 mode 在 `mergedConfig.modes` 中（不在则 stderr + exit 1）
  - 构造 `{ version, modes: { [mode]: mergedConfig.modes[mode] } }` 对象
  - 顶部输出注释块（3 行：生成来源、保存路径提示、整段替换约束说明）
  - 用 `serializeYaml` 序列化正文
  - 后处理：在 phases 数组元素之间插入空行（提升可读性）
- [ ] 在 main switch 中新增 `case 'generate-template'`
- [ ] 在用法提示（约 L334）中新增 `generate-template <mode> [--project-root <path>]` 行

## Task 3 — 文档更新

**文件**: `docs/shared/agent-orchestration-overrides.md`

- [ ] 新增 `### 生成 mode override 模板` 小节，给出 `node ... generate-template fix > .specify/orchestration-overrides.yaml` 用法
- [ ] diagnostic codes 表新增 `orchestration-overrides.loader-error` 行
- [ ] 同步：commit 前需运行 `npm run docs:sync:agents`

## Task 4 — 测试

**文件**: `plugins/spec-driver/tests/orchestration-resolver.test.mjs`

- [ ] T3-Y：`runCli(['generate-template', 'fix'])` 输出验证（exit 0、含 version、modes.fix、所有 phase 字段名）
- [ ] T3-Z：`runCli(['generate-template', 'invalidmode'])` 错误验证（exit 1、stderr 含合法 mode 列表）
- [ ] T2-X：hint 命中（不完整 phase override → message 末尾含 hint，引用正确 mode 名）
- [ ] T2-Y：hint 不命中（mode 名 typo → message 不含 hint）
- [ ] T1-Z：loader-error 诊断（注入抛错 `_loadOverrides` → code=loader-error、message 含 "loader 失败"）

## Task 5 — 验证

- [ ] `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs` 零失败（含 5 个新增用例）
- [ ] `npx vitest run` 不引入新失败（预存 3 个失败保持原样）
- [ ] 手动验证：在 micrograd 项目实际跑 `generate-template fix` 输出有效（如时间允许）
- [ ] `npm run docs:sync:agents` + `npm run repo:check` 全绿

## Task 6 — Codex 对抗审查（CLAUDE.local.md 要求）

- [ ] 提交前启动 codex:codex-rescue 子代理，对抗审查本次改动
- [ ] 评估发现：critical/warning 必须修复或明确拒绝；info 可以记录后续跟进
- [ ] 提交时在 commit message 中注明审查结论
