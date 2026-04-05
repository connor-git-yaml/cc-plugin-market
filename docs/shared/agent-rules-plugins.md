## 插件开发规范

- 插件源码在 `plugins/<name>/`，遵循 `.claude-plugin/plugin.json` 清单格式
- Skills 文件位于 `plugins/<name>/skills/<skill-name>/SKILL.md`
- Agents 文件位于 `plugins/<name>/agents/<phase>.md`
- 版本号遵循 SemVer（patch/minor/major），canonical source 在 `contracts/release-contract.yaml`
- 修改插件后运行 `npm run repo:sync`，提交前 `npm run repo:check`
- Bash 脚本必须 `set -euo pipefail`，保持可执行权限（755）
