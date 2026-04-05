## 发布合同约定

- 版本、plugin metadata、marketplace entry、产品级 release 文案的 canonical source 在 `contracts/release-contract.yaml`
- 需要更新这些字段时，优先改 contract，再运行 `npm run release:sync`
- 不要手工分别修改 `plugin.json`、`marketplace.json`、`package-lock.json`、README 里的受控 release 行
- 提交前运行 `npm run release:check`；仓库级 `check-plugin-sync.sh` 也会复核 release contract
