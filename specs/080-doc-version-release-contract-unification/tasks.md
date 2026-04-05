# Tasks: 080-doc-version-release-contract-unification

- [x] 建立 `contracts/release-contract.yaml`，定义 reverse-spec / spec-driver 的 release metadata canonical source
- [x] 实现 `scripts/lib/release-contract-core.mjs`
- [x] 实现 `scripts/sync-release-contracts.mjs`
- [x] 实现 `scripts/validate-release-contracts.mjs`
- [x] 将 release 校验接入 `scripts/check-plugin-sync.sh`
- [x] 通过共享片段把 release contract 规则同步到 `AGENTS.md` / `CLAUDE.md`
- [x] 清理 README 中不必要的当前版本硬编码，并为插件 README / current-spec 增加稳定 release 行
- [x] 更新 `product-mapping.yaml` 与产品活文档，纳入 080（并补齐 078 / 081 漂移）
- [x] 补测试与验证报告
