# Implementation Plan

1. 建立 spec-driver wrapper source-of-truth 合同文件，明确 canonical source、generated wrapper 与 project override 的边界
2. 更新 `codex-skills.sh`，让生成的 Codex wrapper 自动写入 `Wrapper Source Contract` 头部
3. 新增 `validate-wrapper-sources.mjs`，校验 source skill、wrapper、Claude override、plugin metadata 与 marketplace 一致性
4. 将 validator 接入 `package.json` 与 `scripts/check-plugin-sync.sh`
5. 更新 README / AGENTS 与产品级活文档、product mapping
6. 新增/更新集成测试并重新生成 `.codex/skills/**` 与产品派生产物
7. 运行验证并回填 verification report
