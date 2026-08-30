# spectra-cli 4.5.0 发布命令清单（Feature 265 / T010）

> ⚠️ **以下命令由用户在 host shell 手动执行，本卡自动化流程不代为触发。**
>
> FR-008 明确要求 `npm publish` 必须由用户亲手执行：发布是不可回滚的对外动作
> （npm 的 unpublish 窗口只有 72 小时且会污染版本号空间），且它依赖只存在于
> host shell 的 npm 登录态（`~/.npmrc` 的 authToken），agent 侧的 sandbox 既
> 不该也拿不到那份凭据。

所有命令都在**仓库根**执行。

## 1. 前置检查

```bash
# (1) 确认当前 shell 的 npm 登录态就是要发布的账号
npm whoami
# 期望：输出你的 npm 用户名。报 ENEEDAUTH ⇒ 先 `npm login` 再回到这一步。

# (2) 确认将要发布的版本号与 release contract 一致
node -p "require('./package.json').version"
# 期望：4.5.0

# (3) 打包复核（不真的发布）：过一遍 prepublishOnly 全链 + 看清 tarball 内容
npm run release:publish:dry
```

`release:publish:dry` 会先跑 `prepublishOnly`（`release:check` → `build` →
`repo:check` → `vitest run --maxWorkers=4`），再做一次 `npm publish --dry-run`。
**任何一步非零退出就停在那里**，不要用 `--ignore-scripts` 绕过去——那条链是发布前
唯一的整体性检查。

复核 dry-run 输出时至少确认三件事：

- `name: spectra-cli` / `version: 4.5.0`
- `total files` 与 `package size` 与上一版量级相当（突然翻倍通常意味着某个目录
  漏进了 `files` 白名单）
- 输出里出现的 `release:check` warning 中，发布断层那条（`[publish-gap]`）说的是
  "HEAD 领先已发布版本 4.4.0 N 个 src commit"——这正是本次要消掉的断层

## 2. 发布

```bash
npm publish
```

> `publishConfig.access` 已在 `package.json` 中声明，不需要额外加 `--access` 参数。
> 不要加 `--tag`：本次是正式版，要占 `latest`。

## 3. 发布后验证三件套

```bash
# (1) registry 侧版本已就位
npm view spectra-cli version
# 期望：4.5.0

# (2) 全局重装后 CLI 自报的 build 带上新 commit
npm install -g spectra-cli@latest
spectra --version
# 期望：`spectra v4.5.0 (<7 位 commit>)`，且该 commit 就是本次发布所在的提交
#       （不带 commit 后缀 ⇒ 装到的是没盖章的旧 build，重装或检查 PATH）

# (3) doctor 复跑，四方版本/commit 视图一致
npm run codex:doctor
# 期望：`global-cli.spectra` 为 ok（版本一致且 commitComparison=match）；
#       `mcp-server.spectra` 若报 `commitComparison=mismatch` 或 dirty，
#       按其 next-step 提示在 MCP 客户端重连后复跑——本诊断读的是 PATH 上的二进制，
#       客户端已连接的旧进程需重连后结论才适用。
```

## 4. 发布之后还要做的事（不在本清单的命令范围内）

- 按 M10 Gate 0 的口径，发布后一周跑 `node scripts/adoption-census.mjs` 收 adoption 基线
- F241 冻结口径复测（M-1 / M-3 是人工协议，census 覆盖不了，见
  `docs/design/f265-graph-quality-rerun-plan.md`）
