# spectra-cli 发布流程（npm publish SOP）

本文档是 `spectra-cli` 包发布到 npm 的标准流程。每次升版都按此走，不要凭记忆发版。

---

## 前置条件（一次性）

1. **本地已 npm login**

   ```bash
   npm whoami
   # 若提示 ENEEDAUTH，先跑：
   npm login
   ```

   maintainer 必须已被加到 npm 包的 maintainer 列表（首次发布的人是 owner，后续可用 `npm owner add <user> spectra-cli` 邀请）。

2. **已开启 2FA — npm 当前强制要求（2026-05 实测验证）**

   > ⚠️ npm 政策变化频繁，请以 [npm 官方 2FA 文档](https://docs.npmjs.com/configuring-two-factor-authentication) 为准。

   **强制状态**：所有 npm `publish` 操作都要求 2FA，否则返回 `E403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。两种合法方式：

   **方式 A（推荐）— 添加 security key / passkey**

   npm CLI 已不再支持添加 TOTP（authenticator app），只能走 **FIDO2/WebAuthn**：
   - macOS：iCloud Keychain passkey、Touch ID、1Password passkey
   - Windows：Windows Hello、YubiKey
   - 跨平台：硬件密钥（YubiKey、Titan Key 等）

   **添加步骤**（必须用浏览器）：
   1. 登录 `https://www.npmjs.com/settings/<your-username>/tfa`
   2. 点 "Add security key"，按 WebAuthn 提示完成（macOS 上弹 Touch ID / iCloud passkey）
   3. 选 mode：`Authentication and writes`（login + publish 都要验证，最安全）

   配置完后，本地 `npm publish` 终端会等待 OTP（passkey 弹窗）；终端跑 publish 时浏览器自动弹出 WebAuthn 验证。

   **方式 B（次推荐）— Granular Access Token + Bypass 2FA**

   适用场景：CI/CD 自动发版、本地 passkey 配置不便。
   1. 登录 `https://www.npmjs.com/settings/<your-username>/tokens`
   2. 点 "Generate New Token" → 选 "Granular Access Token"
   3. 关键：勾选 **"Allow this token to bypass 2FA"** 选项
   4. 选 packages 范围（推荐只勾 `spectra-cli` 单包，最小权限）+ 过期时间（推荐 30/90 天，定期轮换）
   5. 复制 token 后立即设环境变量：

      ```bash
      export NPM_TOKEN=npm_XXXXXXXX
      npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
      npm publish    # 会用 token 认证，无需 OTP
      ```

   **方式 B 风险**：bypass-2FA token 一旦泄漏 = 攻击者可直接发恶意版本到 spectra-cli。务必：
   - 选最小 packages 范围（只 `spectra-cli`，不要 "All Packages"）
   - 设过期时间（不要 "no expiration"）
   - 不要 commit 进 git，走 GitHub Secret / 1Password 等密钥库

3. **release contract 同步无错**

   ```bash
   npm run release:check
   npm run repo:check
   ```

   两条都 pass 才能进入发版流程。

---

## 升版步骤

### 1. 改版本号（canonical source 是 release contract）

`spectra-cli` 的 npm 版本号 = `contracts/release-contract.yaml` 里 `products.spectra.version` 字段。**不要直接改 `package.json` 的 version**。

按 SemVer 规则升级：
- 纯 bug fix → patch（4.1.1 → 4.1.2）
- 新功能、向后兼容 → minor（4.1.1 → 4.2.0）
- 破坏性变更 → major（4.1.1 → 5.0.0）

改完 contract 后，跑同步：

```bash
# 编辑 contracts/release-contract.yaml 把 spectra.version 改到目标版本
npm run release:sync          # 把 contract 字段广播到 package.json / plugin.json / marketplace.json / README badge
npm run release:check         # 必须 pass
```

### 2. 写 CHANGELOG

`CHANGELOG.md` 顶部插入新版本节，格式参考已有节（含日期、Changed/Added/Removed 分类、影响评估、验证结论）。

### 3. 同 commit 提交所有改动

```bash
git add contracts/release-contract.yaml package.json package-lock.json \
        plugins/*/.claude-plugin/plugin.json plugins/*/README.md \
        .claude-plugin/marketplace.json README.md CHANGELOG.md
git status                    # 确认没漏文件
git commit -m "chore(release): spectra-cli vX.Y.Z"
```

按 CLAUDE.local.md 约定，commit 前由 codex 跑对抗性 review。

### 4. 干跑（强烈推荐）

实际 publish 前先 `--dry-run`，不会真的发布，但会跑全部 prepublishOnly 检查 + 列出会上传的文件清单：

```bash
npm run release:publish:dry
# 等价于：npm publish --dry-run
```

仔细看输出末尾的文件清单：
- ✅ 应该有：`dist/**`（业务代码）、`grammars/`、`queries/`、`templates/`、`plugins/`、`README.md`
- ❌ 不应该有：`__tests__/`、`*.test.js`、`*.spec.js`、`__fixtures__/`、`node_modules/`、`.env*`

如果出现不该发的文件，**立刻停止**，回去修 `tsconfig.json` 的 `exclude` 或 `package.json` 的 `files` 字段。

### 5. 真发布

```bash
npm run release:publish
# 等价于：npm publish（带 prepublishOnly hook + publishConfig）
```

`prepublishOnly` 会强制依次跑：
1. `npm run release:check`
2. `npm run repo:check`
3. `npm run build`
4. `npx vitest run`

任何一步失败都会阻止 publish。开了 2FA 时会在 publish 一步要求输 OTP。

### 6. 打 git tag + push

```bash
git tag -a vX.Y.Z -m "spectra-cli vX.Y.Z"
git push origin vX.Y.Z
git push origin master        # 把 release commit 推到远端（按"Rebase + Push Origin Master"约定）
```

### 7. 验证发布成功

```bash
# 等 ~30 秒让 npm registry 索引同步
npm view spectra-cli version           # 应该显示新版本
npm view spectra-cli                   # 看完整 metadata

# 真实环境验证
npm install -g spectra-cli@latest
spectra --version
```

确认 README 里的 npm version badge 变成新版本（`https://img.shields.io/npm/v/spectra-cli.svg` 自动从 npm registry 取最新）。

---

## 故障恢复

### prepublishOnly 失败

最常见情况。`npm publish` 自动跑 prepublishOnly，挂掉就阻断发布。看错误来源：

| 失败步骤 | 处理 |
|---------|------|
| `release:check` | release contract 字段不一致，跑 `npm run release:sync` 重同步 |
| `repo:check` | 仓库同步合同不通，跑 `npm run repo:sync` 重同步 |
| `build` | TypeScript 类型错误，按错误修代码再重试 |
| `vitest run` | 测试失败，先修测试再发版 |

### 发布到 npm 后发现 bug

**前 72 小时内**可以 unpublish（npm 限制）：

```bash
npm unpublish spectra-cli@X.Y.Z
```

**超过 72 小时**：不能 unpublish，必须发新版本。如果 bug 严重需要弃用旧版：

```bash
npm deprecate spectra-cli@X.Y.Z "严重 bug，请升级到 X.Y.Z+1"
```

### npm publish 提示 EOTP

开了 publish 级 2FA 但没输 OTP：

```bash
npm publish --otp=123456     # 6 位数字 OTP
```

或交互式 publish 直接在 prompt 里输。

### npm publish 提示 E403

权限不足。常见原因：
- 当前 npm 账号不是 spectra-cli 的 maintainer
- 包名被占用（`spectra-cli` 当前已有 owner 时，新账号要先被 `npm owner add` 加入）
- 触发 npm 的 spam/account 限制

排查：`npm owner ls spectra-cli` 看 maintainer 列表。

---

## 自动化（可选 — 未启用）

如果想让 git tag 自动触发 publish，可加 GitHub Actions workflow `.github/workflows/release.yml`：

```yaml
name: Release to npm
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org/'
      - run: npm ci
      - run: npm run release:publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

启用前置：
1. 在 npm.com 生成 Automation token（`npmjs.com → Account → Access Tokens → Generate New Token (Automation)`）
2. 在 GitHub 仓库 settings → Secrets → 添加 `NPM_TOKEN`
3. 该 token 不需要 OTP，**所以人手挂 2FA 后这条路才安全**

---

## 发布实操检查单（2026-08 双 4.4.0 发版实测沉淀）

按时间序，每条都是真实踩过的坑：

1. **发版前后跑 `npm run judge:doctor`**：安装版 plugin 快照 vs 仓库源码的漂移诊断。
   发版动机常常就是 doctor 报 `drift`（判定器等修复躺在 master 上、安装版零生效）；
   发完 + 重装后复检应转 `match`（active 路径按 installPath 解析，需重启 session 刷新）。
2. **plugin 升级用 `claude plugin update`，不是 `install`**：`install` 对已装项直接跳过
   （"already installed"），只有 `update` 才会 4.x → 4.y。
3. **本地 `prepublishOnly` 全量 vitest 可能"全过仍 exit 1"**（F235 worker RPC 超时签名，
   publish 链嵌套 npm 进程吃余量）——已在 `prepublishOnly` 固定 `--maxWorkers=4`；若复发，
   独立跑 `npx vitest run` 判别真失败 vs 该签名。
4. **npm 登录会话会过期**（浏览器 web-auth 约两周量级）：`npm whoami` 返回 E401 时发布会
   报 404/401。先 `npm login`。
5. **发布动作本身可能再触发一次浏览器授权挑战**（2FA auth-and-writes + web-auth）——该
   挑战**必须在交互式终端完成**（会自动弹浏览器）；非交互 shell 里 npm 只打印授权 URL 就
   退出。此时由操作者在自己终端跑最后一步。
6. **本地图新鲜度门**：repo:check 的 graph-quality 族会拦本地陈旧图（dangling-edge fail）；
   `spectra batch --mode graph-only`（秒级）重建即绿。
7. 改过任何 SKILL.md 后：`npm run repo:sync` 重生 codex wrapper（body-sha256 门禁 + F213
   双写链），否则 repo:check fail。

## 备注

- canonical 版本号在 `contracts/release-contract.yaml`，不是 `package.json`
- `prepublishOnly` 是 npm 内置 hook，`npm publish` 时**自动**调用。`--ignore-scripts` 原则
  禁止；**唯一例外**：四道门刚刚在同机独立跑过且全绿、仅为完成上条第 5 点的交互式授权
  挑战时，允许在操作者终端用 `npm publish --ignore-scripts` 免重复 8 分钟门禁（2026-08-02
  4.4.0 发版即此情形）——门禁没跑过就绝不允许
- `publishConfig.access: public` 防止 scope 包默认 private 的坑（spectra-cli 不带 scope 实际是默认 public，但显式声明更安全）
- npm 发布是**不可逆的公开操作**，72 小时后不能撤回，发版前务必跑 dry-run + 审包
