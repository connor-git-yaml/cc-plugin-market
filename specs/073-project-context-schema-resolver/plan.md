# Implementation Plan

## Goal

将 `.specify/project-context.yaml|md` 从文档约定升级为真正的共享解析机制，并接入所有主要 Spec Driver Skill。

## Workstreams

1. 新增 shared YAML parser / schema / resolver helper
2. 新增 `resolve-project-context.mjs` CLI 脚本
3. 统一更新 `feature/story/fix/resume/sync/doc/implement` 的 project-context 说明
4. 补 integration test，覆盖 canonical YAML、legacy Markdown 和 diagnostics
5. 同步 README、product current-spec、product mapping 与派生产物

## Key Decisions

- 对外文件名仍保持 `.specify/project-context.yaml`
- 内部中间结构统一命名为 `ResolvedProjectProfile`
- `.md` 只做 legacy 兼容，不再作为推荐输入
- 不自动重写用户 context；resolver 只输出 warnings / diagnostics
