# F265 代码上下文摘要（story 模式，替代调研阶段）

> 由编排器在初始化阶段扫描生成。事实全部经本 worktree（基线 `ee6e8314`）实测核对。
> 上游调研已由 M10 交界 workflow（wf_0532a10b，4.06M token）完成，结论落在
> `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md`（本卡 SSoT，§3 = G0-1..G0-4）。

## 1. 卡面四个子目标与落点

| 子目标 | SSoT | 主要落点 |
|---|---|---|
| G0-1 发布 spectra-cli 4.5.0 + spec-driver 同步 | §3 | `contracts/release-contract.yaml`、`CHANGELOG.md`，经 `npm run release:sync` 传导 |
| G0-2 CI 接治理链 + 发布断层 warning | §3 | `.github/workflows/ci.yml`、`scripts/lib/release-contract-core.mjs` |
| G0-3 doctor 比 commit + MCP 版本自省 | §3、§2-7 | `plugins/spec-driver/scripts/lib/codex-runtime-doctor-{core,io}.mjs`、`src/mcp/server.ts` |
| G0-4 adoption / 图质量基线（只交付脚本 + 冻结口径文档，数字发布后一周回收） | §3 | 新增 `scripts/`，新增 `docs/design/` 口径文档 |

## 2. 实测事实（含与卡面表述的偏差）

### 2.1 发布断层（已核实，与 SSoT §0 一致）

- `npm view spectra-cli version` = **4.4.0**；`contracts/release-contract.yaml` `products.spectra.version` = 4.4.0；`package.json` version = 4.4.0。
- 已发布 build 戳 `0ae3eb7`；`git log --oneline 0ae3eb7..HEAD -- src/ | wc -l` = **18**，其中 3 个 `feat(`（F241/F249/F250）→ spectra minor bump 到 **4.5.0** 有 feature 支撑。
- `products.spec-driver.version` = **4.4.2**，自 `21458ac1`（F256，设定 4.4.2 的那次）起 `plugins/spec-driver/` 有 **4** 个 commit：F257、F258、F261、F262，**全部是 fix**。
  - **用户裁决（2026-08-24）**：spec-driver → **4.4.3**（patch）。两产品在 release-contract 中本来就是独立版本线，"同步"理解为同批发布而非同号。
- 本 worktree `dist/.spectra-build-meta.json` 的 commit 是 `0d3e385f…` 且 `dirty: true` —— **dist 是陈旧产物**，任何依赖 dist 的验证前必须先 `npm run build`（F258/F253 教训）。

### 2.2 CI 现状（`.github/workflows/ci.yml`）

现有步骤：checkout → setup-node 20 → `npm ci` → `npm run lint` → `npm run build` → `node dist/cli/index.js batch --mode graph-only` → `npm test` → `npm run test:plugins`（`if: always()`）。

- **`repo:check` / `release:check` 均不在 CI**（与 SSoT §0 "CI 从不执行治理链" 一致）。
- `.github/workflows/claude-review.yml` 是 PR 触发的 LLM review，`repo:check` 只作为 prompt 文本出现在那里。
- 平台只有 `ubuntu-latest`（SSoT §8：M10 不承诺 Windows，但文档须明示）。
- `prepublishOnly` 已串 `release:check && build && repo:check && vitest --maxWorkers=4` —— 即发布路径上有治理链，**只有 CI 路径没有**。

### 2.3 release:check 结构（新增 warning 的落点）

- `scripts/validate-release-contracts.mjs`（48 行）是薄壳：调 `validateReleaseContract(projectRoot)` + `validateCodexPluginConsistency`，两者的 `checks/errors/warnings` 扁平合并；`status !== 'pass'` → `exitCode = 1`。
- **warnings 已有承载通道**：薄壳里 `payload.warnings` 已存在并被打印（`! ${warning}`），且注释明说 "validateReleaseContract 自身当前不产出 warnings，缺失时以空数组起底"。→ 新增"master 领先已发布版本 N 个 src commit"的 warning **不需要改输出契约**，只需让 `validateReleaseContract` 产出 warnings。
- `scripts/lib/release-contract-core.mjs`（356 行）：`loadReleaseContract` / `syncReleaseContract` / `validateReleaseContract`。`validateReleaseContract` 目前只有 `expectEqual` 一种断言（marketplace / package / package-lock / plugin manifest / codex plugin manifest / README / postinstall / product mapping），**全部是 fail 级**。
- **注意**：warning 不得让 `status` 变 fail（`prepublishOnly` 串着 `release:check`，warning 变红会把发布路径自己堵死）。

### 2.4 doctor 的 commit 丢弃是"刻意的脱敏"，不是疏忽（⚠️ 与卡面表述有出入）

`plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（859 行）：

- `VERSION_LINE_RE`（:178）已经**能匹配** commit 后缀：`/^(?:([A-Za-z][A-Za-z0-9._-]{0,23}) )?(v)?(\d+)\.(\d+)\.(\d+)(?: \([0-9a-f]{7,40}\))?$/`。
- `parseVersionLine`（:216-232）把 commit **结构性丢弃**，只回 `{semver, hadVPrefix, commitSuffixPresent}`。
- 丢弃的理由写在 :167-176 的注释里，是 **F236/F240 的 C1 裁决**：*"40 位十六进制 commit 后缀在语法上与一个 32/40 位十六进制凭据完全同构，`v4.4.0 (deadbeefcafebabefeedface01234567)` 能原样通过本语法。因此本正则只用于判定，其匹配到的任何子串（尤其 commit）一律不得进入报告。"*
- 报告 schema（:312-335 `repo-version` / 版本行 shape）与消息表（:390-432）目前只承载 `semver`；有专门的脱敏测试 `tests/unit/codex-runtime-doctor-redaction.test.ts`。
- **对 spec 的约束**：G0-3 要"按 commit 比对"必须**同时满足**这条脱敏不变量 —— 可行方向是"内部比对、外部只输出派生枚举"（如 `commitMatch: 'match' | 'mismatch' | 'absent' | 'unreadable'`），**绝不把 commit 原串写进报告**。把这条当成缺陷直接删掉脱敏 = 回归 F236/F240 的安全裁决。

其它相关：`codex-runtime-doctor-io.mjs:273` 的 `.find` 首匹配非首可用（SSoT §4 P0-D 已认领，**不属本卡**，别顺手改）。

### 2.5 MCP 版本自省现状

- `src/mcp/server.ts:29-31`：`pkg = JSON.parse(readFileSync(pkgPath))`，:67 `version: pkg.version` 注入 `McpServer` 的 serverInfo。
  → **只有 semver，没有 commit / dirty**。客户端 `initialize` 拿到的版本无法区分"哪个 build"。
- build 戳事实源：`dist/.spectra-build-meta.json`，由 `scripts/postbuild-stamp.mjs` → `scripts/lib/spectra-version-gate.mjs` 的 `stampBuild()` 生成，字段 `{commit, dirty, sourceDirty, distSha256, distFileCount, builtAtIso}`。`spectra --version` 已消费它（F186 T3）。
- `plugins/spectra/.mcp.json` 是 `{"command": "spectra", "args": ["mcp-server"]}` —— 走 PATH 上的全局二进制，所以"MCP 跑的是哪个 build"当前从客户端侧不可见（SSoT §0 的"自用 MCP 跑的也是旧二进制"就是这个洞）。
- 现有 MCP 工具 17 个，注册在 `graph-tools.ts` / `agent-context-tools.ts` / `file-nav-tools.ts` + `server.ts` 内联的 prepare/generate/batch/diff/panoramic-query。
- 向后兼容（宪法 XIII）：新增自省只能是**增量**（serverInfo 补字段 或 新增一个工具），不得改既有 17 个工具的 schema。

### 2.6 G0-4 两条基线的可行数据源

- **adoption census**：`src/mcp/lib/telemetry.ts` 的 `writeTelemetry` **由 `SPECTRA_MCP_TELEMETRY_PATH` 环境变量门控**，未设置即 no-op（评测脚本专用）。→ 日常使用**没有**落盘 telemetry，census **不能**从这里取数。
  可用替代事实源（已实测存在）：`~/.claude/projects/**/*.jsonl` 会话 transcript（本机 156 个项目目录、近 30 天 1118 个 jsonl），里面记录 `mcp__*spectra*` 工具调用；Codex 侧对应 `~/.codex/sessions/`。
  → census 脚本形态应是"扫 transcript 目录 → 按工具名聚合调用次数 → 输出 17 工具的调用分布 + 零调用清单"，零依赖 Node，**不入库原始 dump**（SSoT §9 纪律）。
- **图质量复测（caller recall/precision）**：F241 pilot 的冻结口径资产在 `specs/241-graph-keepalive-kb-grounding/pilot/`：`measurement-design.md`（口径）、`m3-preregistration.md`（预注册）、`predicted-impact-set.md`、`metrics-raw.md`（**唯一在案数字：修复前 caller 命中 25%**）、`ledger.jsonl` + `ledger-verify.mjs` + `ledger-schema-check.mjs`（校验器）、`report.md`。
  → 本卡只交付"可一键重跑的测量脚本 + 冻结口径文档"，**数字由发布后一周的 milestone-next 回收**（卡面硬约束）。SSoT §9 另有硬约束：图解析类验收须带**外部语料**第二口径。

## 3. 本卡不做（避免范围蔓延，全部已被 M10 其它卡认领）

- `codex-runtime-doctor-io.mjs:273` `.find` 首匹配缺陷 → P0-D
- Codex hooks 双注册 / `hooks/hooks.json` 分发 → P0-B
- MCP 返回面 `freshness` / coverage-boundary 四分 / nextStepHint 改写 → P0-C（本卡只做 **server 级版本自省**，不碰工具返回体）
- fix-compliance 门禁证据源换代 → P0-A
- CHANGELOG 之外的产品表面清扫（lineRange 死功能、graph_community 死工具等）→ P1-E

## 4. 已知地雷（来自历史卡教训）

1. **禁手改受控行**：版本只改 `contracts/release-contract.yaml` 再 `npm run release:sync`；`plugin.json` / `marketplace.json` / `package-lock.json` / README 受控行由 sync 传导。
2. **dist 陈旧**：本 worktree dist 的 commit 与 HEAD 不符且 dirty；跑任何依赖 `dist/` 的验证（含 `batch --mode graph-only`、`spectra --version`）前必须 `npm run build`。
3. **PATH 上的 `spectra` 是旧全局产物**（F258 教训）：验证新 CLI/MCP 行为要用 `node dist/cli/index.js` 或 tsx 直跑，不能靠全局 `spectra`。
4. **`npm publish` 由用户在 host shell 执行**（历史 E401 / 交互式 auth）；本卡准备到 `npm run release:publish:dry` 通过为止。
5. **新门禁自己会 fail-open**（F258 教训）：新增的 "N 个 src commit 领先" warning 必须用**变异证明会红**（卡面硬约束），不能只看它在当前状态下不报。
6. **冻结型快照测试严禁 `vitest -u`**（F223/F255）。
