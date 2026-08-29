# 问题修复报告 — F267 Claude 侧 atomic-write 缺陷群

> 卡面 SSoT：`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-D
> 详单来源：`specs/262-fix-codex-hooks-warnings/fix-report.md` §影响范围扫描 · 同源但分流
> parity 参照：`plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`（F262 / W3）

## 问题描述

Claude 侧的原子写入链路存在一组缺陷（F262 扫描时发现、当时分流出卡）：

1. `src/utils/atomic-write.ts` `writeAtomicJson`：**rename 拆软链**（dotfiles 管理 `.claude/settings.json` 的用户永远收不到更新）、**无 mode 保全**（0600 私密配置被静默放宽成 0644）、**tmp 固定名**（并发互截）、**失败不清理**（残留半截 `.tmp`）。
2. `src/hooks/hook-installer.ts`：L148 无条件 `chmodSync(scriptPath, 0o755)` 放宽用户收紧的 0700；`.bak` 无 `COPYFILE_EXCL` 顶掉更早的备份；`removeClaudeHook` 路径完全不备份。
3. `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`：`.find` 取**首个匹配**而非**首个可用**，畸形段屏蔽后面的合法段 → 误报 `absent`。

## 开工实证（F248 先例：每条先证再修）

全部 7 条缺陷已在本机实跑确认，无一条来自纸面推演。复现脚本见 `verification/repro/`。

| # | 缺陷 | 实测证据 | 结论 |
|---|------|---------|------|
| D1 | rename 拆软链 | 软链 `.claude/settings.json` → `real/settings.json`；写入前 `lstat.isSymbolicLink()=true`，写入后 `=false`，且**真实文件内容仍是 `{"origin":"dotfiles"}`（未收到更新）** | ✅ 确认 |
| D2 | mode 未保全 | 目标 0600 → 写入后 `644` | ✅ 确认 |
| D3 | tmp 固定名并发互截 | 两进程各 40 轮写同一目标，共 3 次 `WRITE-ERR ENOENT`（对方把共享 tmp rename 走了）；且胜出方 rename 的可能是对方 payload = 静默丢更新 | ✅ 确认 |
| D4 | 失败不清理 | 代码路径无 try/catch，D3 的 ENOENT 抛出后 tmp 无清理动作（同路径已被对方消费故本例无残留，但异常分支结构性缺失） | ✅ 确认（结构性） |
| D5 | chmod 放宽脚本 | 用户自设 `spectra-context.sh` 0700 → `installClaudeHook` 后 `755` | ✅ 确认（走 dist 真实产物） |
| D6 | `.bak` 被顶掉 | 预置 `.bak` 内容 `{"precious":"earlier-backup"}` → 安装后变成 `{"mine":"important"}`，**更早的备份永久丢失** | ✅ 确认 |
| D7 | doctor-io `.find` 首匹配 | 受控 A/B：同一份合法段 `[plugins."spec-driver@cc-plugin-market"]`，仅在其**之前**多加一个无 `@market` 的畸形段 → probe 从 `found`(+`activeInstallPath`) 翻转成 `absent`(+`null`) | ✅ 确认 |

补充实测（D5 同批）：`removeClaudeHook` 后 `.bak` 不存在 → 卸载路径零备份；且 settings mode 仍是被 D2 放宽后的 644。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 dotfiles 用户收不到 hook 更新 / 0600 配置被放宽？ | `renameSync(tmp, target)` 替换的是**整个 inode**：软链被替换成普通文件、权限元数据随新 inode 走 |
| Why 2 | 为何 rename 会替换 inode 元数据？ | 这是 `rename(2)` 的正确语义。缺的是调用方在 rename **之前**把"目标的身份与元数据"迁移到 tmp 上（realpath 跟随 + mode 快照/还原） |
| Why 3 | 为何调用方没做这件事？ | 该函数的设计边界写在文件头注释里：「从 `checkpoint.ts` 的 `saveCheckpoint()` 提取通用原子写入逻辑」——它的**出生场景是写我方产物**（checkpoint），我方产物没有"别人的身份和权限意图"需要保全 |
| Why 4 | 为何用在了"别人的文件"上？ | `hook-installer.ts` 后来复用它写用户的 `.claude/settings.json`。复用时只匹配了"需要原子性"这一条，没有重新审视"目标是不是别人的文件"这一维度差异；抽象的适用边界从未被显式表达（注释只说"防止写入中断导致数据损坏"） |
| Why 5 | 为何未被现有机制捕获？ | `tests/unit/atomic-write.test.ts` 4 个用例全是**内容维度**断言（内容正确 / 目录自建 / 2 空格缩进 / tmp 残留被覆盖），**零** inode 维度断言（软链、mode、并发）。测试把"写对了字节"当成"写对了"——恰好复刻了 Why 3 的那个盲区 |

**Root Cause**：`writeAtomicJson` 是按"写我方产物"的边界设计的（只保证内容原子性），却被复用到"写别人的文件"（用户的 `.claude/settings.json`）上；rename 的 inode 替换语义会丢弃**目标身份**（软链）与**权限意图**（mode），而这两个维度从未进入该函数的合同，也从未进入它的测试。

**Root Cause Chain**：dotfiles 用户收不到更新 / 0600 被放宽 → rename 换 inode → 调用方未迁移身份与元数据 → 函数出生于"写我方产物"场景且边界未显式化 → 被复用到"写别人的文件"时无人重审维度 → 测试只覆盖内容维度，结构性看不见 inode 维度。

> D7（doctor-io `.find`）是**独立漏诊**，不共享上述根因，其根因是：`.find` 的谓词只表达了"是不是我要找的那一条"，没有表达"这一条是否**可用**"，而下游 `if (!entry.marketplace) return absent` 才做可用性判定——判定被拆成两半且中间隔了一个提前终止的搜索。本卡按卡面一并收口。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/utils/atomic-write.ts` | L17-30 | rename 换 inode 未迁移身份/元数据 | 软链 realpath 跟随 + mode 快照还原 + 随机 tmp 名 + 失败清理 |
| `src/hooks/hook-installer.ts` | L148 | 无条件 chmod 0755 | 已存在文件保全其 mode；仅新建时给默认 |
| `src/hooks/hook-installer.ts` | L127 | `copyFileSync` 无 EXCL | 加 `COPYFILE_EXCL`，保留最早一份（与 codex 侧语义一致） |
| `src/hooks/hook-installer.ts` | L193 | remove 路径零备份 | 与 install 路径对称加备份 |
| `plugins/…/codex-runtime-doctor-io.mjs` | L416 | `.find` 首匹配非首可用 | 谓词收进"可用"判定 |
| `plugins/…/codex-runtime-doctor-io.mjs` | L516 | 同一模式（版本不可解析的条目屏蔽后面合法条目） | 同上（同文件同类，对称收口） |

### 5 个生产消费方逐一评估（卡面硬约束）

| 消费方 | 调用点 | 目标文件归属 | 软链跟随影响 | mode 保全影响 | 随机 tmp 名影响 | 裁决 |
|--------|--------|-------------|-------------|--------------|----------------|------|
| `manifest-manager.flush` | `manifest-manager.ts:167` | 我方产物 `_cache-manifest.json` | 无（不会被软链管理）；若被软链则行为更正确 | 已存在文件保全现状 mode（今天是 0644 → 仍 0644）；**新建**从 0644→0600 | 修复并发互截，无回归 | 改，行为变化仅限新建 mode |
| `graph-builder.writeGraphJson` | `graph-builder.ts:703` | 我方产物 `specs/_meta/graph.json` | 同上 | 同上；**注意** graph.json 可能被 CI/他人读 | 同上 | 改；新建 mode 变化在下方「已知边界」显式登记 |
| `extraction-cache` | `extraction-cache.ts:146` | 我方产物 `.spectra/…` 缓存 | 同上 | 同上 | **收益最大**：批量抽取高并发同目录写 | 改 |
| `hook-installer.installClaudeHook` | `hook-installer.ts:140` | **别人的文件** `.claude/settings.json` | **核心收益**：dotfiles 用户终于收到更新 | **核心收益**：0600 不再被放宽 | 修复并发互截 | 改，本卡主目标 |
| `hook-installer.removeClaudeHook` | `hook-installer.ts:193` | **别人的文件** 同上 | 同上 | 同上 | 同上 | 改，同上 |

**序列化面不动**（关键裁决）：codex 侧 `writeJsonAtomic` 写 `${JSON.stringify(d,null,2)}\n`（带尾换行），本卡**不引入**尾换行。理由：(a) 尾换行不属于本卡 4 条缺陷中的任何一条；(b) 它会改变 3 个消费方的产物字节，`tests/unit/atomic-write.test.ts` 的 `content === JSON.stringify(data,null,2)` 与 graph.json 的 byte-stable 护栏语义都建立在当前序列化上；(c) 「不要自行添加未要求的优化」。parity 参照的是**保全语义**，不是逐字节同构——`codex-hooks-installer.mjs` 头部注释已明确"共享的是保证而非实现"。

### 4 处写我方产物的 tmp+rename（评估后不改，理由如下）

| 站点 | 事实 | 不改理由 |
|------|------|---------|
| `src/knowledge-graph/persistence.ts:156` | `await fsp.rename(tmpPath, targetPath)`，tmp 名固定 | 写 `.spectra/` 下我方图产物；无用户权限意图可保全，无软链管理场景。**但 tmp 固定名的并发面客观存在** → 登记 dogfooding ledger，不在本卡扩面（改它要动 async 路径与其错误语义，超本卡"缺陷群"边界） |
| `src/batch/checkpoint.ts:60` | 同形态 | 同上；checkpoint 是单 batch 进程独占写，并发面在设计上不存在 |
| `src/scaffold-kb/kb-writer.ts:35-53` | 已有 `.bak` + 回滚逻辑（比 atomic-write 更完整） | 写 KB 产物；已自带备份/回滚（C-3 缺口修复过），语义完整度高于本卡基线，动它是净风险 |
| `plugins/…/graph-bootstrap-status.mjs` | tmp+rename 写 bootstrap 状态 | 我方状态文件，进程内单写者；且属 plugin 侧（零构建分发），与本卡 TS 侧包边界不同 |

共同判据：这 4 处写的都是**我方产物**——不存在"用户设过的 mode"和"用户用软链托管"这两个本卡要保全的对象；F262 已作出同一裁决（「已评估→不适用」），本卡复核后维持。

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/hooks/git-hook-installer.ts` | — | 同目录 hook 安装器 | **不碰**（卡面硬约束：P0-C 的写入路径） |
| `src/knowledge-graph/module-derivation.ts` | — | — | **不碰**（P0-C） |
| `plugins/…/codex-runtime-doctor-core.mjs` | — | — | **不碰**（G0 的写入路径；本卡只碰 doctor-io） |

### 同步更新清单

- 调用方：5 个生产消费方均通过 `writeAtomicJson` 签名不变的方式受益，**无调用方改签**
- 测试：`tests/unit/atomic-write.test.ts` 新增 inode 维度断言组（软链 / mode / 并发 / 失败清理）——**红先行**；`tests/unit/hook-installer*.test.ts` 新增 chmod 保全 / `.bak` 保留最早一份 / remove 备份断言；`tests/unit/codex-runtime-doctor*.test.ts` 新增畸形段屏蔽 fixture
- 文档：`writeAtomicJson` 与 `hook-installer` 的模块注释需写明"保全≠加固"边界与 TOCTOU 承认
- Spec：`specs/products/spectra/current-spec.md` 若记载 hook 安装行为细节需同步；否则无需更新（由 implement 阶段核实）

### 已知边界（登记不修，制品中显式宣告）

- **TOCTOU**：stat 与 rename 之间目标 mode 被并发修改 → 保全的是写入开始时的快照，非最终值。显式承认，不加伪补偿（与 F262 同一裁决）
- **悬空 symlink**：`realpathSync` 失败回落字面路径 → 仍会拆链。边缘形态，卡面未点名
- **硬链接**被 rename 断开（inode 替换的固有语义）
- **新建产物 mode 从 0644 → 0600**：影响 `graph.json` / `_cache-manifest.json` / extraction cache 的**首次创建**。同 UID 无影响；多 UID 共享构建机上他人读取会被拒。卡面硬约束「首创默认与 codex 侧一致」故采用 0600，此处显式登记该行为变化
- **`.bak` 保留最早一份而非最新**：与 codex 侧一致（轮换会让"最初那份"在第二次安装即永久消失）
- **`.claude/` 目录权限未加固**（implement 阶段新登记，纠正 plan §2.5 理由 (b)）：`hook-installer.ts` 的 `mkdirSync(claudeDir, { recursive: true })` 按默认 mode 建目录，umask 000 下即 0777 世界可写。plan §2.5 曾以「Claude 侧『目录里随便塞文件即命令注入』的攻击面不成立」为由之一支持不加固——**该理由不成立**：`settings.json` 的 `hooks[].command` 同样会被 Claude Code **当命令执行**，同机其他本地用户可以在世界可写的 `.claude/` 里 unlink 掉 settings.json 再放一份自己的进来，注入模型与 codex 侧 `hooks.json` 同构（codex 侧为此把 `$CODEX_HOME` 建成 0700）。
  - **仍不修的真实理由是范围与落点，不是风险不存在**：(1) 本卡点名的是 chmod 保全 / `.bak` 保留最早一份 / remove 对称备份三项，目录加固不在其中；(2) `.claude/` 目录由 `hook-installer.ts` 自己 `mkdirSync`，**不经过** `writeAtomicJson`——给 `writeAtomicJson` 的 mkdir 加 `mode: 0o700` 修不到这条路径，只会把 3 个我方产物消费方（cache manifest / graph.json / extraction cache）的目录一并无谓收紧；(3) 收紧一个用户既有目录会改变其可访问性，其消费方不止我们（编辑器插件、其它工具也读 `.claude/`），需独立评估。
  - 结论：**如实登记 > 悄悄加固 > 假装不存在**。代码侧同址留有对应注释（`src/hooks/hook-installer.ts` 的 `mkdirSync(claudeDir, …)` 处），建议另立卡收口。
- **D1/D2/D3 复现脚本是冻结的缺陷演示器，不是修复验证器**（implement 阶段发现）：`verification/repro/d1-d2-symlink-mode.mjs` 与 `d3-concurrent-tmp.mjs` 内联了一份旧 `writeAtomicJson` 的副本（"复刻当前实现"），故无论源码改成什么样，重跑它们都只会重现旧行为——tasks.md T024 写的"重跑这两个脚本应翻转"这条判据不可满足。冻结副本作为**基线证据**有价值（不随源码漂移），故原样保留，另加 `verify-fixed-d1-d3.mjs` 对真实构建产物 `dist/utils/atomic-write.js` 跑同一组场景做翻转验证。`d5-d6-hook-installer.mjs` 与 `d7-doctor-find.mjs` 本就 import 真实代码，可直接重跑翻转。

## 修复策略

### 方案 A（推荐 · parity 对齐 F262 W3）

`writeAtomicJson(filePath, data)` 签名不变，内部：
1. `resolveWriteTarget`：`lstatSync().isSymbolicLink()` → `realpathSync()` 跟随；失败回落字面路径（收 D1）
2. `readTargetMode`：`statSync().mode & 0o7777`（保全 setuid/setgid/sticky 高位）；读不到 → `DEFAULT_TARGET_MODE = 0o600`（收 D2）
3. tmp 名 `${target}.tmp.${pid}.${random}`，`flag:'wx'`（O_EXCL）+ `mode:0o600` 创建（收 D3，并防 tmp 路径被预置成软链）
4. `chmodSync(tmp, targetMode)` 精确还原；失败**不阻断**（无权限位 FS 上该风险面不存在）
5. `renameSync`；任一环节失败 `rmSync(tmp,{force:true})` 后重抛原始错误（收 D4）

`hook-installer.ts`：
- 脚本 chmod 改为"已存在则保全其 mode，仅新建时给 0o755"（收 D5；保全≠加固——用户设的 0700 与 0777 都如实保全）
- `.bak` 加 `COPYFILE_EXCL`，EEXIST 时提示而非顶掉（收 D6）
- `removeClaudeHook` 与 install 路径对称加备份

`codex-runtime-doctor-io.mjs`：两处 `.find` 谓词收进可用性判定（收 D7）。

### 方案 B（备选，未采纳）

在 `hook-installer.ts` 内单独实现一份"安全写"，不动 `writeAtomicJson`。
**不采纳**：会在同一仓库同一包内制造第二份原子写实现（codex 侧那份重复是**包边界强制产生**的，本侧没有这个理由），且 manifest/graph/cache 三个消费方的并发面与失败残留不会被修。

## Spec 影响

- 需要更新的 spec：待 implement 阶段核实 `specs/products/spectra/current-spec.md` 是否记载 hook 安装的权限/备份行为；当前扫描未见行为细节记载 → 倾向**无需更新**

---

## 异构对抗审查结论（Codex 配额耗尽，异构档位；≥2 切入角）

档位说明见 `CLAUDE.local.md` 顶部暂停节。本卡属 security-adjacent，走**独立子代理异构对抗**，
两个切入角各自独立跑复现，**不给它们我的实现思路，只给"证伪这段代码"的任务**。

> ⚠️ **诚实登记：Codex 审查暂停，异构档位缺席。** F229 实证过"同构子代理全绿而 Codex 抓到
> CRITICAL"，故本节的结论**不构成安全证据**，只构成"已尽异构对抗之力"。配额恢复后可回补。

### 角度一：权限 / 软链破坏面 — 3 CRITICAL / 5 WARNING / 4 INFO（已全部处置）

**它推翻了我的实现**。最重要的一条是：**修复本身引入了一个修复前不存在的破坏面**。

| 编号 | 结论 | 处置 |
|------|------|------|
| **C1** | 软链跟随把「拆链」升级成「**写穿当前用户可写的任意路径**」。git 原生存储软链（mode 120000），**克隆即落盘**——第三方仓库自带 `specs/_meta/graph.json -> ../../../../.ssh/authorized_keys`，跑一次 `spectra batch` 即写穿。受控 A/B + 真实 `git clone` 实证 | **已修**：软链跟随改为 **opt-in**，默认 false；只有 `hook-installer` 写 `.claude/settings.json` 时显式传 `followSymlinks: true`。3 个我方产物消费方回到"不跟随"（= 修复前的安全语义），攻击面归零 |
| **C2** | `removeClaudeHook` 新增的备份把**卸载**变成可被阻断的操作。真实 2MB 磁盘映像实证：备份需 126KB 失败 → 只需写 1KB 的卸载被彻底拦死，用户被锁在撤销不掉的状态 | **已修**：卸载路径备份改 best-effort（warn + 继续）；安装路径保持严格 |
| **C3** | 软链指向只读目录（Nix home-manager / nix-darwin 把配置软链进 `/nix/store`）时安装硬失败，且裸抛的 EACCES 指向随机 tmp 名，用户无法自助定位。**砸的正好是 D1 的目标用户** | **已修**：EACCES/EROFS/EPERM 换成指名道姓的错误（说清是软链、真实文件在哪、为什么写不了） |
| W1 | `.bak` 的 EEXIST 被当成"备份存在且可用"。悬空软链 / 目录 / 空文件三形态都打印"保留最早备份"然后照常改写用户文件——正是它自己注释说不能发生的状态 | **已修**：EEXIST 后补可用性检查（普通文件且非空），不可用则如实告警"**没有**可回滚的备份" |
| W2 | hook 脚本 mode：① 0200 被保全 → 安装报成功而 hook 恒 exit 126；② 修复前的 `chmod 0755` 会收窄 0777，修复后不再收窄 = 撤掉了一道已有防护，而该文件会被当命令执行 | **已修（用户裁决）**：如实保全用户设的每一位 + 并入 `0o500` 保证 owner 可执行（不报假成功）+ 组/他人可写时告警（风险可见、决定权归用户） |
| W3 | 合同措辞把"mode 位保全"写成了"**权限**保全"，但 rename 换 inode 同时换 owner/group（`0660 root:admin` → `0660 <当前用户>:<目录组>`）。非本次引入，但新写的措辞会误导 | **已修**：措辞改为「mode 位保全」并显式登记 owner/group 不在保全范围 |
| W4 | 项目 settings 软链到全局 `~/.claude/settings.json` 时，写入的是**相对路径** hook 命令 → 污染全局配置，在每个项目触发 | **登记不修**（见下方边界清单） |
| W5 | 孤儿 tmp 从"恒为 1 个且被覆盖"变成"唯一名、永不回收、无限累积" | **登记不修**（见下方边界清单） |
| I1 | `Math.random().toString(36).slice(2,10)` 在极小值上退化出**空串/单字符**后缀（已实算：`Math.random()===0` → 空串） | **已修**：改用 `crypto.randomBytes(6).toString('hex')`（定长 12 位十六进制） |
| I3 | 我写的 `.claude/` 边界注释里「这条路径根本不经过 `writeAtomicJson`」**是错的**——`writeAtomicJson` 自己会 mkdir `.claude`。结论仍成立但成立原因是**调用顺序** | **已修**：注释改写为顺序论证，并标注更正 |
| I4 | 目标是目录时 `readTargetMode` 读到的是**目录**的 mode（0755），拿去 chmod 一个即将变普通文件的 tmp 是张冠李戴 | **已修**：只对普通文件取快照，非普通文件回落 0600 |
| I2 | tmp 名比目标名长 ~20 字节，basename 逼近 NAME_MAX 时比旧实现更早 ENAMETOOLONG。当前 5 个消费方够不到 | **登记不修** |

**它明确报告"未发现问题"的项**（说明实际试过什么，不是没测）：10 种 mode 形态无一变宽、
setuid/setgid/sticky 高位精确保全；跨设备 EXDEV 用真实磁盘映像验证无问题（tmp 与落点同目录，
rename 永远同设备）；`COPYFILE_EXCL` 自身的软链安全性正确；多级/相对软链跟随正确。
**未能构造复现**的项如实标注：`Math.random()` 预测型 DoS、目标属于其他用户的形态、TOCTOU 竞态。

### 角度二：并发与失败原子性 — 部分完成（两次子代理中途死亡）

该子代理**两次**在长 transcript 上死亡（第一次 API 断连，第二次 watchdog 停滞 600s），
未产出完整报告。但它**已完成的实验**给出三条确证结论，已全部处置：

| 结论 | 证据 | 处置 |
|------|------|------|
| `realpathSync` 失败（EACCES 中间目录不可穿越 / ELOOP 软链环）时**静默回落字面路径 = 照样拆链**，告警 0 条。这正是 D1 要修的失败模式，仍在这些形态下静默发生 | 两形态各自实跑，`告警条数: 0` | **已修**：解析失败必打印告警，说清"本次将替换该链接本身；链接指向的文件不会收到更新" |
| `expect(result.status).toBe(0)` 是**空断言**：`bash -c '<cmd> & <cmd> & wait'` 子进程非零退出时仍返回 0 | `bash -c 'node -e "process.exit(3)" & ... & wait'; echo $?` → `0` | **已修**：删除该断言并注释说明为何删 |
| `expect(result.stderr).toBe('')` 是 **flaky 制造机**：worker 被 SIGKILL 时 bash 自己往 stderr 写 `Killed: 9`（85 字节）；`--experimental-loader` 写 360 字节 | 两形态实测字节数 | **已修**：改为断言 stderr 不含 worker 自身异常特征，噪声行不再致红 |

它还实测了并发负载下该集成测试 6/6 稳定通过，以及 TOCTOU 在人为高频换链下窗口很宽
（15628 轮中 14091 轮结束时链被拆）——后者需要对抗性并发改写者，属已登记的 TOCTOU 边界。

> **登记缺口**：角度二未完成完整证伪（大 payload 交错、消费方新增抛出路径的逐个评估等未覆盖）。
> 不把"它没跑完"记成"那些面没问题"。

## 已知边界（本次新增登记）

- **`.claude/settings.json` 仍可被仓库自带软链写穿**：hook 路径是 opt-in 跟随的唯一消费方，
  故 C1 的攻击面在这条路径上**未完全关闭**——受害目标须是可解析 JSON（`~/.claude.json`、
  别的项目的 `tsconfig.json` 等）。彻底收口需要"归属边界校验"或"仓库自带软链识别"，
  超出本卡点名范围，**转 dogfooding ledger 作为后续卡候选**
- **W4 全局配置污染**：项目 settings 软链到 `~/.claude/settings.json` 时写入相对路径 hook 命令，
  会在每个项目触发；且 `.bak` 落在项目侧而改的是全局文件，"保留最早一份"对被改文件不成立
- **W5 孤儿 tmp 累积**：崩溃残留的唯一名 tmp 不再被后续写入覆盖，也不被清理（清理只碰本次
  自己创建的那一个）。`extraction-cache` 高频批量写入处累积最快
- **W3 owner/group 不在保全范围**：`rename` 换 inode 同时换 owner/group，mode 位精确保全但
  可访问人群可能变化
- **I2 NAME_MAX**：tmp 名长 ~20 字节，basename 在 240–250 区间时比旧实现更早报 ENAMETOOLONG
