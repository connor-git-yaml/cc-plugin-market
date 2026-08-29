# F267 复现脚本

开工前实证用（F248 先例：每条缺陷先证再修）。全部只在临时目录里写，不改仓库状态。

```bash
export REPO=$(git rev-parse --show-toplevel)
R=$REPO/specs/267-fix-atomic-write-defects/verification/repro
mkdir -p /tmp/f267 && cd /tmp/f267

# D1 软链拆链 + D2 mode 放宽（复刻当前 writeAtomicJson 实现，不依赖 dist）
mkdir -p real proj/.claude
node $R/d1-d2-symlink-mode.mjs symlink   # 期望（修复前）：AFTER isSymlink=false 且真实文件内容未更新
node $R/d1-d2-symlink-mode.mjs mode      # 期望（修复前）：600 → 644

# D3 并发固定 tmp 名互截（两进程各 40 轮）
node $R/d3-concurrent-tmp.mjs A & node $R/d3-concurrent-tmp.mjs B & wait
# 期望（修复前）：若干次 WRITE-ERR ENOENT（对方把共享 tmp rename 走了）

# D5 chmod 放宽 + D6 .bak 被顶掉（走 dist 真实产物，需先 npm run build）
node $R/d5-d6-hook-installer.mjs
# 期望（修复前）：settings 600→644、script 700→755、.bak 的 precious 备份被顶掉、remove 后无 .bak

# D7 doctor-io .find 首匹配（受控 A/B）
mkdir -p home/plugins/cache/cc-plugin-market/spec-driver/abc123hash/.codex-plugin
echo '{"version":"4.4.0"}' > home/plugins/cache/cc-plugin-market/spec-driver/abc123hash/.codex-plugin/plugin.json
printf '[plugins."spec-driver"]\nenabled = true\n\n[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n' > home/config.toml
node $R/d7-doctor-find.mjs                       # A：畸形段在前 → absent
printf '[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n' > home/config.toml
node $R/d7-doctor-find.mjs                       # B：仅合法段 → found
```

## 修复后如何验证翻转

⚠️ **`d1-d2-symlink-mode.mjs` 与 `d3-concurrent-tmp.mjs` 内联了一份冻结的旧 `writeAtomicJson` 副本**
（"复刻当前实现"），它们是缺陷的**演示器**而非修复的**验证器**——无论源码改成什么样，重跑它们
都只会重现旧行为。冻结副本作为基线证据有价值（不随源码漂移），故原样保留。

D1/D2/D3 的修复后验证走对**真实构建产物**跑同一组场景的脚本：

```bash
npm run build
REPO=$(git rev-parse --show-toplevel) node "$REPO/specs/267-fix-atomic-write-defects/verification/repro/verify-fixed-d1-d3.mjs"
# 期望：isSymlink=true / 真实文件收到更新 / mode 600 / 新建 600 / ENOENT=0 / payload 完整 / tmp 残渣 0
```

D5/D6/D7 的脚本本就 `import` 真实代码，直接按上面的步骤重跑即可：
D5/D6 应翻转为 mode 全保全 + `.bak` 保留 `precious` + remove 后 `.bak` 存在；
D7 的 config A 与 B 应给出同一结论（均 `found`）。
