# 问题修复报告 — Codex hooks 分发纠偏（卡面 F265 / 仓内编号 264）

> **编号说明**：卡面（`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-B）派发时写作 F265；
> 按仓库"不预占编号"约定，`git fetch origin --prune` 后 `specs/` 最大编号为 263，本卡实际落 **264**。
> 两个编号指同一张卡，后续账本引用以 264 为准。

## 问题描述

M9 的 F213（FR-006）与 F240（FR-011）都建立在一条前提上：**Codex 不读插件自带的 `hooks/hooks.json`，
hooks 只有 `$CODEX_HOME/hooks.json` 一个全局位置**。据此 spec-driver 走了"全局合并器"路线
（`codex-skills.sh install --global` → `install-codex-hooks.mjs` 把 5 条 hook 合并写进 `$CODEX_HOME/hooks.json`）。

该前提**不成立**。`codex plugin add` 之后 Codex 直接注册插件包内的 `hooks/hooks.json`；再按 README 跑一次
全局合并器安装，同一批 hook 被**注册两遍**：判定器每次 Stop 跑两遍、`BLOCK_LIMIT=2` 一次 Stop 即烧尽降级放行、
postinstall 每 SessionStart 跑两遍。

## 复现（隔离 CODEX_HOME，本机 codex-cli 0.144.6，2026-08-24）

隔离家目录：`$SCRATCH/codexA`；marketplace 指向本 worktree；探针脚本 `$SCRATCH/probe-hooks.mjs`
经 `codex app-server` stdio 发 `initialize` → `hooks/list`。

| 步骤 | 命令 | `hooks/list` 结果 |
|---|---|---|
| 1 | `codex plugin marketplace add <worktree>` + `codex plugin add spec-driver@cc-plugin-market` | **5 条**，全部 `source=plugin`、`pluginId=spec-driver@cc-plugin-market`、`sourcePath=<cache>/hooks/hooks.json`、`trustStatus=untrusted`；`${CLAUDE_PLUGIN_ROOT}` **已展开**为 cache 绝对路径；`WorktreeCreate`/`WorktreeRemove` **静默丢弃**（`warnings: []`、`errors: []`） |
| 2 | 叠装 `bash plugins/spec-driver/scripts/codex-skills.sh install --global` | **10 条**：5 条 `source=user`（`$CODEX_HOME/hooks.json`）+ 5 条 `source=plugin`，同名重复，Codex **不去重、不告警** |

→ 卡面事实**逐条复现成立**。

### 复现中新采到的四条一手事实（超出卡面，直接决定守卫判据）

| # | 事实 | 证据 | 对设计的影响 |
|---|---|---|---|
| E1 | `codex plugin remove` **同时**删掉 `config.toml` 的 `[plugins."<n>@<mp>"]` 表与 `plugins/cache/<mp>/<n>/` 整个目录 | remove 后 `find $CODEX_HOME/plugins` 只剩空的 `cache/cc-plugin-market` | 卸载后不会留下"幽灵 cache"，缓存目录可作为守卫的**一个**证据 |
| E2 | `enabled = false` 时 `hooks/list` 返回 **0 条**，但 **cache 目录仍在** | 改 config.toml 后重探 → TOTAL: 0；`ls cache/.../spec-driver` 仍有 `4.4.2` | **只看 cache 目录会误拒**（用户显式禁用插件后仍被拒装合并器）→ 守卫必须同时读 config.toml 的启用状态 |
| E3 | `[plugins."spec-driver@cc-plugin-market"]` 表存在但**不写 `enabled` 键**时，hooks **照常注册 5 条** | 删掉 `enabled` 行后重探 → TOTAL: 5 | 守卫判据必须是"表存在 **且** `enabled` 未被显式置 false"，不能是"`enabled == true`" |
| E4 | 0.144.6 上 `SessionEnd` **不被接受**——写进 hooks.json 后 `hooks/list` 静默丢弃，与 `WorktreeCreate` 同待遇；被接受的恰是现有 `CODEX_EVENT_SCHEMA_SET` 的 10 项 | 14 个候选事件名各写一条 → 返回 10 条，缺 `SessionEnd`/`WorktreeCreate`/`WorktreeRemove`/`Notification` | 卡面要求补 `SessionEnd`（10→11）源自 0.149.0 口径；本机 0.144.6 **实测反证**。补入时必须带版本出处注记，且**不得**把它放进产品集 |

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何同一批 hook 被注册两遍？ | 插件包内 `hooks/hooks.json` 与 `$CODEX_HOME/hooks.json` 是两个互不知情的注册源，Codex 对二者不做同名去重 |
| Why 2 | 为何我方同时占了两个源？ | `codex plugin add` 自带包内 hooks（我方本就随包 ship 了 `hooks/hooks.json`，F213 FR-006 明确要求"随包 ship 保证文件系统可发现"）；同时 F240 FR-011 又实现了全局合并器 |
| Why 3 | 为何做了本不必要的合并器？ | F240 判定"Codex hooks 只有全局位置，无项目级/插件级语义"（`_grounding.md` §8.1），把包内 hooks 视为"仅可被发现、不会被执行" |
| Why 4 | 该判定为何不成立？ | F213 的实测口径是**读 manifest schema**（两份第三方 `plugin.json` 均无 `hooks` 字段）——由此推出"manifest 不支持 hooks 字段"是对的，但被**外推**成"Codex 不读插件 hooks"。Codex 的插件 hooks 走**目录约定**（`<pluginRoot>/hooks/hooks.json`），根本不经 manifest 字段声明 |
| Why 5 | 为何未被现有机制捕获？ | 全部门禁（`validate-codex-hooks.mjs` / `codex-plugin-consistency` / `repo:check`）都只看**我方磁盘产物的一致性**，没有任何一处去问"Codex 运行时实际注册了几条"；`hooks/list` 这条 RPC 在 F240 的 `_grounding.md` 里被记载为"探测入口"却从未真正跑过 |

**Root Cause**：把"Codex plugin **manifest** 无 hooks 字段"错误外推为"Codex 不读插件包内 hooks"，
于是在插件已经自带（且真实生效）的 hooks 之外，又造了一条全局合并器注册路径；两条路径都活着且互不去重。

**Root Cause Chain**：Stop hook 跑两遍 / BLOCK_LIMIT 一次烧尽 → `hooks/list` 10 条同名重复 →
包内 hooks 与全局 hooks.json 双注册 → 合并器路线基于"Codex 不读插件 hooks"前提 →
该前提由"manifest 无 hooks 字段"外推而来 → 从未用运行时注册视图（`hooks/list`）验证过前提。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` | 模块头注释 | "`$CODEX_HOME/hooks.json` 是 Codex 的全局唯一共享声明文件" | 注释补正：全局文件仍唯一，但**不是唯一注册源**；插件包内 hooks 才是主路径 |
| `plugins/spec-driver/scripts/codex-skills.sh` | `run_codex_hooks_cli` 上方注释 L~200 | "Codex hooks 只有全局位置，无项目级语义（§8.1）" | 同上补正 + 接入双注册守卫 |
| `plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs` | `owned-command-interpolated` 分支注释 | "Codex 不注入任何 plugin root 变量（§8.6），运行期插值必然展开为空串" | 该结论**仅对 `$CODEX_HOME/hooks.json` 成立**；插件源已实测会展开 `${CLAUDE_PLUGIN_ROOT}`。判据本身不变（我方写全局文件时仍必须是绝对路径），只补作用域限定 |
| `specs/213-codex-plugin-distribution/spec.md` FR-006 | L94 / L141 | 前提错误 | **不改 shipped 报告正文**，在 spec 文件加"后续更正"注记指向本卡 |
| `specs/240-codex-runtime-closeout/spec.md` FR-011 | L182 起 | 同上 | 同上 |
| `README.md` §Codex Support | L280-320 | 仍是 M9 前 skills-only 路径，未提 `codex plugin add`，且把合并器安装当默认路径 | 重写为当前真实路径：插件安装为主、skills-only 为 fallback |

### 同卡收口（卡面点名，非同源但同文件族）

| 文件 | 问题 | 修复动作 |
|------|------|----------|
| `lib/codex-hooks-schema.mjs` | `CODEX_EVENT_SCHEMA_SET` 缺 `SessionEnd` | 补入并注明"0.149.0 口径；0.144.6 实测不接受（E4）"；产品集不动 |
| `validate-codex-hooks.mjs` + schema | 产品层只判**事件集合**，`Stop` 事件缺 `stop-fix-compliance-check.sh` handler 仍判 pass | 改为按 **handler** 判：期望 5 条 owned handler 各自挂在正确事件上 |
| `plugins/spec-driver/skills-codex/*/SKILL.md`（5 个） | 残留 Claude 专属 `mcp__plugin_spectra_spectra__*` 命名空间 | 在 `extract-wrapper-body.mjs` 的 runtime text 替换表加一条，重生 wrapper；并加一条只扫 `mcp__` 的窄门禁防回归 |

### 类似模式（已评估）

| 位置 | 评估结果 |
|------|----------|
| `plugins/spectra/hooks/`（spectra 插件是否也双注册） | **无 hooks 目录**，spectra 侧不存在该问题面 |
| `contracts/codex-plugin-consistency.yaml` 的 `no-hooks-field` check | **安全**：它断言 manifest 无 `hooks` 字段，这条结论本身正确（Codex 走目录约定而非 manifest 字段），不需改 |
| `.codex/skills/`（仓内项目级 wrapper 副本） | 由 `repo:sync` 从 `skills-codex/` 同源再生，命名空间修复会自动跟随 |

### 同步更新清单

- 调用方：`codex-skills.sh`（唯一调 `install-codex-hooks.mjs` 的生产入口）
- 测试：新增双注册守卫单测（检出面 + 三条误拒面 E2/E3 + `--force` 逃生口）；handler 级判据单测（`Stop` 缺 handler 须红）；wrapper sha256 快照随替换表更新
- 文档：README §Codex Support 重写；F213/F240 spec 注记；`docs/design/milestone-M10-...md` §4 P0-B 标注已交付

## 修复策略

### 方案 A（推荐）：插件自带为主 + 合并器降级为 skills-only fallback，守卫按"运行时会不会注册"判

1. **双注册守卫**（第一步、独立小 commit）：`install-codex-hooks.mjs` 安装前探测
   `$CODEX_HOME` 是否已把本插件注册为 Codex plugin。判据取 **E2/E3 实测口径**的两条合取：
   - `config.toml` 中存在 `[plugins."<name>@<marketplace>"]` 表（`<name>` 为 `spec-driver`）**且** 其 `enabled` 未被显式置为 `false`；
   - 对应 `plugins/cache/<marketplace>/<name>/<version>/hooks/hooks.json` 存在且含我方 owned handler。
   命中 → **拒绝写入**（专用退出码 + 中文指引），skills 安装照旧完成（合并器的 skills 职责保留）。
   逃生口 `--force-hooks`：给"Codex 版本老到不读插件 hooks"的假设留人工覆盖，并在输出里说明代价。
2. **路线切换**：README 改为"`codex plugin add` 即得 hooks + skills；只装 skills 时才用 `codex-skills.sh`"。
3. 同卡三项收口 + 前提更正注记。

**为何守卫放在 Node 侧而非 shell 侧**：`install-codex-hooks.mjs` 是唯一写 `$CODEX_HOME/hooks.json` 的地方，
守卫贴着写入点最难绕过；shell 侧只负责翻译退出码给用户看。

### 方案 B（备选）：直接删掉合并器

删 `install-codex-hooks.mjs` 与 `run_codex_hooks_cli`。**不采**：卡面拍板保留为 skills-only fallback；
且 0.144.6 之前的 Codex 是否读插件 hooks 未实测，直接删会让老版本用户一条 hook 都没有，属不可回退的能力损失。

## Spec 影响

- 需要更新的 spec：`specs/213-codex-plugin-distribution/spec.md`（FR-006 加更正注记）、
  `specs/240-codex-runtime-closeout/spec.md`（FR-011 加更正注记）——**只加注记，不改 shipped 报告正文**。
- `specs/products/spec-driver/current-spec.md`：安装路径叙述若涉及 Codex hooks 需同步（实施阶段核对）。

---

## 对抗审查第一轮 · 切入角 A「双注册绕过面」（异构档位，Codex 审查暂停）

**结论：1 CRITICAL + 4 WARNING + 5 INFO。CRITICAL 与全部 WARNING 已修，修法是把守卫的安全方向整体翻转。**

### CRITICAL-1：快照目录是 symlink 时守卫整个失效（审查方用完整生产 shell 链实跑出真实双注册）

`hasOwnedHooksInCache` 用 `Dirent.isDirectory()` 判快照目录——那是 **lstat 语义**，指向目录的
symlink 返回 `false` 被 `continue` 跳过 → 判"未注册" → 放行 → `hooks.json` 被写出，双注册重现。

这不是假想布局：本机真实 Codex cache 内即有
`~/.codex/plugins/cache/openai-bundled/chrome/latest -> .../26.810.41047`。

**根因判断（主线程收口）**：同一行判据抄自 `codex-runtime-doctor-io.mjs` 的
`probeCodexPluginManifest`，在 doctor 里"跳过"= `absent → indeterminate`（安全方向），
搬进守卫后"跳过"= **fail-open 放行双注册**——**抄代码时安全方向没跟着翻**。

### 修法不是逐条打补丁，而是翻转整个判据方向

WARNING 组（W1 合法 TOML 段头变体 10 种 / W2 marketplace→cache 目录名推导 / W4 段名缺
`@marketplace` / S3~S6 三引号、EACCES、BOM）看似互不相干，其实是**同一个结构性错误**的分身：
初版把 config.toml 与 cache 写成对等的 AND，于是**任一侧判不出 ⇒ 放行**。

两个失败方向并不对称：

| 方向 | 后果 | 可见性 |
|---|---|---|
| 漏拦（该拒没拒） | 静默双注册：Stop 判定器每轮跑两遍、`BLOCK_LIMIT=2` 一次 Stop 烧尽即降级放行——**损坏的正是依从性门禁本身** | 用户**看不见** |
| 误拒（不该拒却拒了） | 打印一条中文指引 + 现成 `--force-hooks` 逃生口，skills 安装照常完成 | 用户**看得见、可覆盖** |

因此判据改为**非对称两段**：**cache 证据是主信号**（`plugins/cache/<任意 marketplace>/spec-driver/<任意快照>/hooks/hooks.json` 含 owned handler，
`plugin remove` 会连表带 cache 一起删故不存在幽灵 cache，见 E1）；**config.toml 里的显式
`enabled = false` 是唯一豁免**（读不到 / 解析不出 / 键缺失一律不构成豁免，见 E3）。
这样 config.toml 侧的一切解析盲区退化成"找不到豁免 → 拒绝"（落在可见一侧），
cache 侧的盲区退化成"没有证据 → 放行"（没有证据就没有要拦的东西）。

**诚实登记的残余代价**：exotic 但合法的 `enabled = false` 写法（inline table / 点分键 /
literal string 键 / 段头内侧空格等）我方词法扫描器认不出，这类用户会拿到一次**误拒**，
需用 `--force-hooks` 覆盖。这是上述取舍的已知代价，不是疏漏，已写进模块头注释。

### 修后复验（23 条对抗构造全部逐条实跑）

| 组 | 构造 | 修前 | 修后 |
|---|---|---|---|
| 绕过面 | symlink 快照 / 10 种合法 TOML 形态 / cache 目录名错配 / 缺 `@marketplace` / 未闭合三引号 / BOM / config.toml 缺失 / config.toml 不可读 | 全部 **ALLOW（绕过）** | 全部 **BLOCK** |
| 误拒面 | `enabled=false` 三种写法 / 多 marketplace 只关掉有证据的那个 / 已 remove / cache 只含第三方 handler / cache 无本插件 / 同名前缀插件 / cache 不可读 | ALLOW | 仍 **ALLOW**（无新增误拒） |

另：S4/S5 两条"判不出"现在各自产出可见诊断（`config-unreadable` / `cache-scan-unreadable`），
由 CLI 打印，不再静默。审查方确认无问题的两角（shell 退出码分流 I4、调用面唯一入口 I3）保持不变。

### 修后端到端复验（真实 codex-cli 0.144.6，隔离 CODEX_HOME）

| 步骤 | 结果 |
|---|---|
| `codex plugin add` | `hooks/list` **5 条**（`source=plugin`） |
| 叠装合并器 | 守卫命中、`hooks.json` **未创建**、`hooks/list` **恒 5 条**、skills 9 个照常安装 |
| 再叠装一次（幂等） | 仍 5 条 |
| 改 `enabled = false` 后叠装 | 合并器正常安装，5 条（`source=user`）——**误拒面未回归** |
| F262 W3 护栏：合并器路径三连装 | owned handler **恒 5**，目标文件 mode **0600 保全** |

### 补强：拒绝安装只挡住"新的"双注册，**已经坏掉的用户**还得能看见

守卫拒绝写入后，用户机器上可能仍有一批**历史**合并器条目（插件注册之前装的）——那才是此刻
正在生效的双注册。只打印"已跳过写入"会让用户以为问题解决了，而 Stop hook 仍在每轮跑两遍。

故守卫命中时额外读一次 `$CODEX_HOME/hooks.json` 计数并点名：
`⚠️ 但 …/hooks.json 里仍有 5 条历史合并器条目 —— 它们与插件注册叠加，此刻就是双注册状态`，
并给出 `codex-skills.sh remove --global` 的清理指引。**不替用户删**（删错就是数据丢失，那是
`--remove` 的职责）。该计数纯只读、绝不抛，任何读取失败都返回 0，不参与任何判定。

真实 Codex 复验：历史条目 + 插件注册 → `hooks/list` **10 条**且警告点名 5 条历史条目；
按指引跑一次 `remove --global` 后 → **恒 5 条**（`source=plugin`）。

---

## 对抗审查第二轮 · 切入角 B「误拒面 / 新增假红」（异构档位，Codex 审查暂停）

**结论：2 CRITICAL + 5 WARNING + 5 INFO。CRITICAL 与全部 WARNING 已修并复验。**

### 归因（审查方给出，主线程复核成立）

> **证据键 ≠ 豁免键。** 主信号用的是 `plugins/cache/<目录名>` 的**磁盘目录名**，豁免用的是
> `config.toml` 里 `[plugins."<name>@<token>"]` 的**注册 token**，二者在真机上并不一一对应。
> 更根本地：**cache 是内容仓，不是注册台账**——"cache 里有 hooks.json ⇒ 已注册"可被本机现状证伪。

### CRITICAL（本机真实 `~/.codex` 反证，主线程已独立复核）

| # | 发现 | 本机证据 |
|---|---|---|
| C1 | 合法的 `enabled = false` **关不掉守卫**：cache 目录名与 config token 不同时，豁免失效，且提示点名的是一个 config.toml 里**根本不存在**的名字，用户无从下手 | `github` 同时在 `openai-curated/` 与 `openai-curated-remote/` 两个 cache 目录，而 `config.toml` 只有 `[plugins."github@openai-curated"]` |
| C2 | **幽灵 cache 真实存在**，主信号可被证伪：换 marketplace 名 / 拷贝 `~/.codex` / 插件改名都会留残留 → 这类用户被**永久**拒绝，且 C1 让豁免路径也走不通 | `openai-curated-remote/` 下 5 个插件目录在 `config.toml` 里零对应条目 |

加重这条的一手事实：codex-cli 0.144.6 的 `codex plugin` **没有 `disable` 子命令**（只有
add / list / marketplace / remove），`enabled = false` 只能手改文件——把它设成"唯一豁免"
等于把误拒出口修在一条大多数用户走不到的路上。

### 终版判据：config.toml 是注册台账（主信号），cache 是"有没有东西可注册"的必要条件

| # | 条件 | 结论 |
|---|---|---|
| 1 | 有 cache 证据 + 台账解析出本插件的表 | 逐条证据裁决：cache 目录名能与某个 `@token` **精确对上**就用那张表的 `enabled`；对不上才退回聚合判断（任一表未显式关闭即算启用） |
| 2 | 有 cache 证据 + 台账读不出 | 拒绝（`config-unreadable`） |
| 3 | 有 cache 证据 + 台账解析不出表但**文本提到插件名** | 拒绝（`config-plugin-mention-unparsed`）——第一轮那 10 种 exotic 写法全含插件名字面量 |
| 4 | 有 cache 证据 + 台账里根本没提到插件名 | **放行**（C2 幽灵 cache） |
| 5 | 无 cache 证据且 cache **干净地**扫完 | **放行**（Codex 无可注册；例如用户装的是更早、还没带 hooks 的插件版本） |
| 6 | 无 cache 证据但扫描本身判不出（EACCES 等）且台账说启用 | 拒绝（`cache-scan-inconclusive`） |

「精确匹配优先、对不上才聚合」是关键：它同时关掉 C1（豁免不再依赖名字对上）与
"多 marketplace 只关掉有证据的那个"这条误拒面，且不重新打开第一轮的 W2 绕过面。

### WARNING 处置

| # | 发现 | 处置 |
|---|---|---|
| W1 | 守卫前置于写入器，**吞掉了 `hooks.json` 非法 JSON 的 fail-loud**（本该退出码 3，实际报"无需再装"）；`countStaleMergedEntries` 又把该情形静默压成 0 条 | 新增只读的 `assertHooksDocumentParsable()`，**先于守卫**求值；补集成测试钉死"退出码 3 优先于 4" |
| W2 | 提示让用户跑 `codex-skills.sh remove --global` 清历史条目，而该命令会**先 `rm -rf` 掉 9 个 Codex 包装 skill** —— 对同时在用 fallback skills 的用户是一次没预告的删除 | 提示与 README 改为默认给**只删 hook 条目**的命令（`install-codex-hooks.mjs --remove`），并明写另一条会连 skills 一起卸载 |
| W3 | 拒绝提示只给 marketplace 名（可能来自 cache 目录、config.toml 里查无此名），误拒时无法自救 | 回传并打印 `evidencePaths`（触发判定的 cache `hooks.json` 绝对路径）；台账分支点名的 token 现在**一定在 config.toml 里找得到** |
| W4 | handler 级判据未发现新增假红（同脚本挂两次 / 第三方条目 / `--skip-shape` 均 pass），但事件越界时与 `product-event-out-of-scope` **同一根因计两次 fail** | `product-handler-misplaced` 收窄为"事件在产品集内但挂错"；越界一侧交给事件级判据。补测试确认去重后**仍不漏报**（缺位由 `product-handler-missing` 覆盖） |
| W5 | 守卫命中时 `--json` 缺 `writtenCommands`/`removedCommands`，打断 `validate-codex-hooks --desired` 的文档化管道 | 如实补两个空数组（确实什么都没写、什么都没删），并补集成测试 |

### INFO 处置

- **I1（已采纳，改法与建议不同）**：把 `SessionEnd` 加进全集会把一条**准确**的 warning 抹掉——
  0.144.6 上第三方写的 `SessionEnd` hook 确实永不执行。故新增 `CODEX_EVENT_VERSION_DEPENDENT`，
  产出语义更准的 `version-dependent-event-name` warning：既不冒充"未知事件名"（新版本里它合法），
  也不静默（旧版本里它确实不执行）。
- **W4.3 / I2~I5（登记不改）**：`product-handler-unregistered` 当前**结构性不可达**（两张表 5/5 对齐），
  已在注释里明确标注"前瞻分支，不得算进已验证的守护力"；窄门禁只在 `repo:sync` 之后变红（检测产物
  而非即将生成的产物）、替换表与 canonical 措辞的耦合，均已在注释登记。审查方明确**未能打穿**的面：
  守卫异常健壮性（数组文档 / 对象 command / 空文件 / BOM / symlink / EACCES 全部正确处理）、
  `--remove` 不受影响、`--json` stdout 纯净、`--force-hooks` 可发现性、`repo:sync` 不触发守卫。

### 修后复验

- 两轮合并的 **26 条对抗构造** + 4 条 marketplace 匹配边界，逐条实跑全部符合期望
- 真实 codex-cli 0.144.6 隔离 CODEX_HOME **6 步端到端**：原生 5 条 → 叠装仍 5 条（打印判定依据路径）→
  幂等 5 条 → `enabled=false` 放行 → 历史条目叠加时点名 10 条 → **只清 hook 条目**后回 5 条且 skills 9 个保留
