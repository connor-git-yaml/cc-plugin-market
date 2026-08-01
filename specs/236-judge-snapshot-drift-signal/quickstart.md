# Quickstart：手动验证判定器快照漂移检测

供 implement 后的手工验证，以及 spec.md User Story 1 的 Independent Test 落地步骤。

## 前置条件

- 在 spec-driver 仓库自身内操作（本机需存在仓库 checkout）。
- 本机已通过 marketplace 安装过 `spec-driver` 插件（存在 `~/.claude/plugins/cache/**/spec-driver/<version>/` 快照目录）。

## 场景 1：制造 drift 并验证

```bash
# 1. 找到当前生效的快照目录（doctor 命令自己也会算出这个路径，这里先手工确认用于验证）
cat .specify/.spec-driver-path

# 2. 人为在快照侧修改一个字节（不影响仓库侧），制造 drift
SNAPSHOT=$(cat .specify/.spec-driver-path)
echo "// drift-test-marker" >> "$SNAPSHOT/scripts/lib/simple-yaml.mjs"

# 3. 跑 doctor 命令
npm run judge:doctor

# 期望：status: drift，files[] 中 scripts/lib/simple-yaml.mjs 标注 mismatch，退出码 0

# 4. 还原快照（避免污染本机已安装插件）
git -C "$SNAPSHOT" checkout -- scripts/lib/simple-yaml.mjs 2>/dev/null \
  || sed -i '' '/drift-test-marker/d' "$SNAPSHOT/scripts/lib/simple-yaml.mjs"
```

## 场景 2：验证 in-sync（真实同步场景，须先跑一次 `repo:sync`/安装刷新快照后才可能成立）

```bash
npm run judge:doctor
# 若本机快照恰好与仓库当前 HEAD 一致 → status: in-sync
# 若本机快照落后于仓库（dogfooding 开发期常态）→ status: drift（这是本 feature 存在的原因，属预期）
```

## 场景 3：验证 not-applicable（非 spec-driver 仓库）

```bash
cd /tmp && mkdir -p not-a-spec-driver-repo && cd not-a-spec-driver-repo
node /path/to/spec-driver/plugins/spec-driver/scripts/judge-snapshot-doctor.mjs --project-root .
# 期望：status: not-applicable, reason: repo-reference-missing
```

## 场景 4：验证 indeterminate（模拟元数据损坏）

单测覆盖（`plugins/spec-driver/tests/judge-snapshot-core.test.mjs`）优先于手工验证，因为需要临时伪造 `installed_plugins.json` 损坏且清空 `CLAUDE_PLUGIN_ROOT`/`.specify/.spec-driver-path`，手工在真实 HOME 目录做这类破坏性操作风险较高，不建议手工复现。

## 验证命令（implement/verify 阶段执行）

```bash
npm run test:plugins   # node:test，含 judge-snapshot-* 单测 + FR-002b 守卫测试 + smoke 测试
npx vitest run          # 确认未影响任何既有 vitest 套件（本 feature 不改 TS 源码，预期无关联失败）
npm run build           # tsc 类型检查（本 feature 只新增 .mjs，预期零影响，仍需跑通确认无副作用）
npm run repo:check      # 确认未挂载到 repo:check、且未破坏既有插件同步校验
```
