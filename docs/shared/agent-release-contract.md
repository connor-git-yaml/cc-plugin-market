## 发布合同约定

- 版本、plugin metadata、marketplace entry、产品级 release 文案的 canonical source 在 `contracts/release-contract.yaml`
- 需要更新这些字段时，优先改 contract，再运行 `npm run release:sync`
- 不要手工分别修改 `plugin.json`、`marketplace.json`、`package-lock.json`、README 里的受控 release 行
- 提交前运行 `npm run release:check`；仓库级 `check-plugin-sync.sh` 也会复核 release contract
- 版本号还被 `tests/e2e/feature-170a-spectra-spec-driver-integration.e2e.test.ts` 钉死（F237「释出欠账检测器」，刻意不动态读 contract）：bump contract 的同一批必须改该断言并重跑全量 vitest，否则 `prepublishOnly` 会在发布现场失败（4.7.0 实证）
