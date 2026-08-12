# 问题修复报告 — F262 Codex hooks installer 权限位静默放宽 + doctor 三处误报收口

> 修订版：Phase 1 初稿经两路异构对抗审查（权限/合并破坏面 3C/7W/10I；诊断误报面 3C/5W/7I）
> 后由主线程裁决收口。初稿的方案 A-2（W1 投影剔空键）与三处影响面事实错误已撤回修正，
> 全部裁决理由见文末「对抗审查裁决记录」。

## 问题描述

F240（Codex A3/A4）大批次审查确认的四条 warning，全部位于 Codex hooks 安装/诊断链：

- **W3**（security-class）：`codex-hooks-installer.mjs` 原子写丢失目标文件权限位（用户 0600 被静默放宽 0644）
- **W1**：`projectForeignOnly` 空数组形态在投影两侧不对称，致第三方保全判据误报
- **W2**：`codex-runtime-doctor-io.mjs` config.toml 段头词法扫描漏 `[[array-of-tables]]` 与行尾注释两种形态，致 doctor 误报
- **W4**：`.bak` 在二次安装时非本次写入前状态（代码注释明示故意，允许裁决"按设计+补文档"）

## 逐项核实结论（dd59ebbd 基线，全部实证复现）

任务卡要求开工逐项核实（F248 先例）。四条均在 scratchpad 隔离实验室复现/核实，未碰主 worktree：

| 条目 | 核实结论 | 复现证据 |
|------|---------|---------|
| W3 | ✅ 确认，行号准确（installer.mjs:127-128） | 预置 0600 目标 → `installCodexHooks` → 实测 `before=0600 after=0644`；首次创建落 0644（umask 022）、umask 000 下落 **0666 世界可写**（hooks.json 内容会被 Codex 当命令执行 = 本地注入面）。全文件无 chmod/mode/stat-权限处理 |
| W1 | ✅ 确认，两条触发形态 | **W1a（任务卡点名）**：baseline `{"hooks":{"Stop":[]}}`（用户预存空数组事件）→ 安装写入 Stop → `validate --baseline` exit=1 `foreign-entries-mutated` 而 `lostCommands=[]`（零数据丢失）。**W1b（对抗审查新发现，纳入范围）**：插件升版（pluginRoot 路径变化）→ 旧路径命令被摘除重写 → `--desired` 的自然取值（生成器产物）只含新命令 → `foreign-command-lost` 误报，频率=每次升版 |
| W2 | ✅ 确认，形态与严重度经对抗审查修正 | **行尾注释（高概率主形态，fail 级）**：`[plugins."B@m"] # 注释` 使 B 段不可见 → B 的 `enabled = true` 泄漏归属给前一产品 A 段 → **A 被诬告版本漂移（fail + reinstall 指引）且 B 判不出（indeterminate）**，实测双产品同时误报。**Form A（[[array]] 泄漏，fail 级但需两前提）**：`[[profiles.batch]]` 后随 `enabled = true` 泄漏给前面未启用的 plugin 段 → 磁盘残留 9.9.9 旧快照被报为漂移；前提①codex CLI 不可执行（`codex-cli-help` 探针优先级更高，健康时压制本形态）②plugin 段自身无 `enabled = true`（[推断]：`codex plugin disable` 后的残留形态，grounding 仅实测过含 enabled 的段）。**多行字符串（对抗审查新发现）**：`"""…"""` 内的 `enabled = true`（FORM-D 值泄漏）或整段贴入的 `[plugins."x@m"]`（FORM-E 幻影条目）→ fail 级漂移误报，逐行词法扫描结构性失明 |
| W4 | ✅ 确认为故意设计（installer.mjs:241-244 注释明示"备份的价值恰恰在于最早那一份"） | CLI 面实测：`install-codex-hooks.mjs:196` 把 `backup-already-exists`（info 级）静默吞掉（text 模式 grep 命中 0）；text 模式从不打印真实 `backupPath`（symlink 场景 `.bak` 实际落在 realpath 目录，文案占位符 `<目标>.bak` 指错位置）；升版路径会刷 5 条 `owned-entry-removed` 劝按 `.bak` 回滚，与"`.bak`=首装前状态"叠加成误导 |

## 5-Why 根因追溯（主线 W3）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 用户 0600 的 hooks.json 为何安装后变 0644？ | `renameSync(tmpPath, filePath)` 用 tmp 文件的 inode 整体替换目标，权限位随新 inode 走 |
| Why 2 | tmp 文件为何是 0644？ | `writeFileSync(tmpPath, …)` 未传 mode，按进程 umask（典型 022）落默认 0644 |
| Why 3 | 实现时为何没保全 mode？ | `writeJsonAtomic` 只从"内容原子性"单一维度设计（防半截文件/并发截断），把 rename 当纯内容替换，忽略 rename 替换的是完整 inode（权限元数据一并替换） |
| Why 4 | 该假设为何不成立？ | 目标是"别人的文件"（用户家目录私密配置）；模块第一不变量"除我方条目外一个字节都不动"只覆盖了 JSON 字节面，未把文件系统元数据（mode）纳入"别人的数据"范畴 |
| Why 5 | 为何未被现有机制捕获？ | `codex-hooks-installer.test.ts` 全部用例只断言 JSON 内容与 diagnostics，无一 stat 权限位；`hook-installer-semantics-parity.test.ts` 的七语义合同表也无权限保全语义行 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: 原子写实现把"目标文件"理解为纯内容载体，rename 替换 inode 时静默丢弃权限元数据，且测试合同从未覆盖权限维度。
**Root Cause Chain**: 0600→0644 放宽 → rename 换 inode → tmp 按 umask 落 0644 → 单维度原子写设计 → "别人的数据"边界未含 fs 元数据 → 测试无权限断言。

### W1 根因链（简）

**W1a**：投影对"我方摘空的事件键"删除（`emptiedEvents`），对"用户预存空数组事件键"保留 → 同一安装动作在两侧产生不同规范化 → 字节比较不等 → 误报。根因：比较语义缺少"用户空事件键在 after 侧物理存活即非破坏"的判别。
**W1b**：`--desired` 合同语义是"本轮写入器声明**写入/移除**的条目"，但 installer 的 install 路径只把移除记进 diagnostics（`owned-entry-removed`），返回值 `writtenCommands` 仅含写入——"声明移除"在数据面无一等出口 → 升版时旧命令消失无从声明 → 判据 2 误报。

### W2 根因链（简）

段头判据 `^\[([^\]]+)\]$` 只认裸单括号规范形态：`[[…]]` 与带行尾注释的段头整行不匹配 → **不重置 `current`** → 后续键泄漏归属到前一 plugin 段（错归属，比漏识别更糟）；逐行扫描对多行字符串结构性失明 → 串内容被当配置行。根因与 F259 教训同构：把"规范形态"当"全部合法形态"的枚举式判据，每多一种真实形态漏一次——且本修复自身的方案设计也在同一教训上被对抗审查抓到两次（`\"` 转义、多行字符串），足证该类判据必须以"形态清单+显式不支持宣告"方式冻结在制品里。

### W4 根因链（简）

`.bak` 语义（首次安装前原始状态）与用户直觉（最近一次写入前状态）不一致，且唯一能澄清语义的信号 `backup-already-exists` 被 CLI 按 info 级静默过滤——设计正确、可观测性缺席。追加：`.bak` 的**来历**本进程不可证实（EEXIST 只证明"文件已在"，可能是用户自带备份或删后重建的第二次备份），任何"这份 .bak 是 X"的指认式文案都是潜在假陈述。

## 影响范围扫描

### 本卡修复面

| 文件 | 位置 | 动作 |
|------|------|------|
| plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs | writeJsonAtomic L123-137 | W3 mode 保全 |
| plugins/spec-driver/scripts/validate-codex-hooks.mjs | checkForeignPreservation L169-193 | W1a 比较语义豁免 |
| plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs + validate-codex-hooks.mjs | installCodexHooks 返回值 / --desired 读取形态 | W1b 移除清单一等化（plan 定细节） |
| plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs | parsePluginRegistry L224-247 / hasHooksStateSection L250-257 | W2 行规范化 + 段头判据 + 多行字符串状态位 + hooks.state 收窄 |
| plugins/spec-driver/scripts/install-codex-hooks.mjs | renderDiagnostic/main L144-203 | W4 可观测性（明示文案 + backupPath 打印 + path 字段 + I10 死分支收口） |
| tests/unit/codex-hooks-installer.test.ts, tests/unit/codex-runtime-doctor.test.ts 等 | — | 红先行测试（见验收） |

### 同源但分流（不在本卡，登记 dogfooding ledger 候选）

| 对象 | 事实 | 分流理由 |
|------|------|---------|
| src/utils/atomic-write.ts（writeAtomicJson） | tmp+rename 无 mode 保全 + **无软链跟随**（rename 拆软链、dotfiles 真实文件收不到更新，实测）+ tmp 名固定无 pid/随机（并发互相截断）+ 失败不清理 | 与 W3 **非同构**（缺软链跟随是另一 bug，只加 mode 保全会掩盖拆链症状）；5 个生产消费方（manifest-manager/graph-builder/extraction-cache/hook-installer×2），仓库级行为变更，超 fix 模式范围 |
| src/hooks/hook-installer.ts | L140/L193 经 writeAtomicJson 写**项目级** `.claude/settings.json`（同丢 mode；remove 路径不备份）；L148 `chmodSync(scriptPath, 0o755)` 无条件放宽用户收紧的 0700；`.bak` 无 COPYFILE_EXCL 会被顶掉（与 codex 侧"保最早一份"语义不一致，parity (e3) 在该侧因 alreadyInstalled 短路而空转绿） | 同上，Claude 侧问题群整体一张卡。两路审查对 L147-148 结论相反（机制判断正确 vs chmod 0755 本身即放宽），仲裁：均属实、维度不同；对象是我方生成脚本非用户私密配置，severity 低于 W3 |
| src/knowledge-graph/persistence.ts / src/batch/checkpoint.ts / src/scaffold-kb/kb-writer.ts / plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs | 其余 4 处 tmp+rename | 已评估→**不适用**：写的是我方产物而非"别人的文件"，无用户权限意图可保全 |
| plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs:273 | `.find` 取首个匹配非首个可用（无 marketplace 的畸形段屏蔽后面合法段 → absent） | 独立漏诊，非 W2 点名范围 |

### 已知边界（登记不修，注释/制品中显式宣告）

- **TOCTOU**：stat 与 rename 之间目标 mode 被并发修改 → 按写入开始时快照保全（非原子）；注释承认，不加伪补偿
- **悬空 symlink**：`resolveWriteTarget` 回落字面路径 → rename 拆链且无 .bak（ENOENT 无内容可备）；边缘形态，任务卡未点名
- **投影判据对 `stripOwnedFromHooks`/`emptiedEvents` 共享轴的结构性失明**（变异 M2 实测全绿）：与 `isOwnedEntry` 轴同类的固有边界，模块头部文档补登记；本卡 W1a 修法（比较语义豁免）不扩大该盲区（变异 M1"安装器删用户空键"仍检出）
- **W2 显式不支持形态清单**：段头内侧空白 `[ plugins."x@y" ]`、literal string 键 `[plugins.'x@y']`、点分键 `plugins."x@y".enabled`、无 `@marketplace` 段、名含多 `@`——全部落 absent→indeterminate（方向安全），制品注释显式宣告
- 硬链接被 rename 断开；`.bak` 落 realpath 目录（symlink 场景）——W4 文案打印真实 backupPath 后者已缓解
- `.bak` 自身权限：darwin `copyFileSync` 完整保全源 mode（实测），无需处理

### 同步更新清单

- 测试: `tests/unit/codex-hooks-installer.test.ts`（W3 权限断言 + W1a 三连断言）、`tests/unit/codex-runtime-doctor.test.ts`（W2 形态 fixture 组）、validate CLI 测试（W1a FP 消除 + W1b 升版路径）、`tests/unit/codex-hooks-event-gate.test.ts` 波及确认
- CLI 输出: `install-codex-hooks.mjs`（W4 全部改动）
- 文档: `.bak` 语义与 W2 不支持清单落点由 plan 确认（模块注释为主；README/SKILL 若有相应章节则同步）
- Spec: `specs/products/spec-driver/current-spec.md` 仅目录结构图提及 hooks.json，无行为细节记载 → **无需更新**

## 修复策略

### 方案 A（对抗审查后定稿）

1. **W3**: `writeJsonAtomic` 改造：
   - 读目标 mode：`statSync(filePath).mode & 0o7777`（**0o7777** 保全 setuid/setgid/sticky；`& 0o777` 会静默丢高位——初稿错误已修正）；ENOENT/失败 → 保守默认 **0o600**（实证：本机 Codex 对 `auth.json`/`config.toml` 均 0600；hooks.json 内容被当命令执行，umask 000 下默认创建是 0666 世界可写=注入面）
   - 写 tmp **创建即带 `mode: 0o600`**（umask 只会更严不会更松 → 恒不宽于 0600，消除"chmod 前内容以 0644 暴露"的窗口）
   - `chmodSync(tmpPath, targetMode)` 精确化（chmod 不受 umask 影响），放 try 内（失败清理 tmp 不留残渣，守住 parity"零 tmp 残留"合同）；chmod 失败的容忍策略（硬失败 vs 降级继续+diagnostic）由 plan 裁决——倾向降级继续（exFAT/SMB 等无权限位 FS 上放宽面本不存在，不应让保全动作反而阻断安装）
   - rename。TOCTOU 非原子性在注释显式承认
2. **W1a**: `projectForeignOnly` **不动**（初稿"投影剔空键"已撤回：会击穿 RAW_HOOKS_KEY 红线且让"安装器误删用户空键"变异全绿）。改 `checkForeignPreservation` 比较语义：对 baseline 投影中值为空数组的事件键，**当且仅当该键在 after 原始文档 `hooks` 对象中物理存在**时，从两侧比较中豁免该键差异（RAW_DOCUMENT_KEY/RAW_HOOKS_KEY 显式排除在豁免之外）。已验证：W1a FP 消除；M1 变异（键被真删→after 无键→不豁免）仍检出；RAW 槽（投影人造键在真实文档不存在）仍检出；版本迁移场景不受扰
3. **W1b**: installer 的 install 路径把"本轮真正消失的命令"一等化（对齐 remove 路径的 `removedCommands` 返回形状），validate 的 `--desired` 支持直接消费 `install --json` 输出（写入+移除都进减数）。**绝不**自动用 `isOwnedEntry` 豁免 baseline 命令（那会关掉判据 2 检出"归属误认误删"的存在意义）
4. **W2**: 保持词法扫描边界，行规范化步骤冻结为判据（`parsePluginRegistry` 与 `hasHooksStateSection` 共用）：
   - 剥行尾注释：字符扫描，双引号/单引号互斥跟踪 + **双引号内 `\` 转义感知**（两者都是承重判据：仓内 `simple-yaml.mjs` 模板恰好"有互斥无转义"，照抄即在 `[mcp_servers."a\"b"] # note` 形态还原 fail 级错归属）
   - 段头同时识别 `[x]` 与 `[[x]]`：两者都重置/切换段边界；`[[plugins."x@m"]]` 不作注册条目（[推断]：TOML 语义为数组表，Codex 侧预期反序列化失败，absent 与事实同向；grounding 未实测该形态）；`hasHooksStateSection` 对 `[[x]]` 同样取段名
   - **多行字符串状态位**：`"""`/`'''` 跨行开关（行内成对视为已闭合），串内行不参与任何段头/键值判定（FORM-D 值泄漏 / FORM-E 幻影条目两形态收口）
   - `hasHooksStateSection` 判据收窄：`^hooks(\.|$)` → `hooks.state` 前缀（`[hooks]` 是 Codex 产品特性段（PR #18893），现判据会把正常声明段误判为信任记录段，把可执行的 `grant-hook-trust` 指引降级成 manual-investigate；T062 信任记录位置未确证的前提在注释记录）
   - 不支持形态清单显式写入模块注释
5. **W4**: **裁决为不改行为**（理由：注释明示的设计意图成立且经实测确认——用户两次安装之间的手工新增条目保全在 hooks.json、不在 .bak；若轮换 .bak，"最初那份"在第二次安装即永久消失，与归属误认叠加成不可逆丢失；带时间戳轮换在用户家目录制造无界文件增长）。补偿可观测性（文案全部限定在本进程可证实范围，与 install-codex-hooks.mjs:179-182 既立措辞原则一致）：
   - `backup-already-exists` 不再静默：打印"`<真实路径>` 已存在，本次未覆盖；本工具仅在 .bak 不存在时创建备份（保留最早一份），不随每次写入刷新"——**不指认**这份 .bak 的来历（EEXIST 只证明文件已在，可能是用户自带或删后重建，指认式文案在两个实测场景下是假陈述）
   - 发生备份/EEXIST 时打印 `result.backupPath` 真实路径（symlink 场景 `.bak` 落 realpath 目录，占位符 `<目标>.bak` 指错）
   - `renderDiagnostic` suffix 模板补 `path` 字段（该诊断携带 path，现模板只拼 event/command 会丢）
   - 收掉 L196 死分支（`owned-entry-removed` 恒为 warning，`code !== 'owned-entry-removed'` 例外永不生效）
   - `owned-entry-removed` 回滚指引微调：提示回滚前核对 .bak 内容（升版路径刷 5 条该诊断 + .bak 可能早于用户近期改动，照指引整份回滚会丢改动）

### 已否决方案（理由留档）

- W3-tmp 直接 `writeFileSync(mode)` 单用：open(2) mode 受 umask 掩蔽，放宽方向失真（umask 077 时 0644 目标落 0600）——但**收紧方向恒可靠**，故定稿采用"0o600 创建 + chmod 精确化"叠加（初稿全盘否决 mode 参数是过宽结论，经对抗审查修正）
- W1a-投影剔空键（初稿方案 A-2）：击穿 `RAW_HOOKS_KEY` 红线（`doc.hooks=[]` 形态两侧坍缩同一空壳，假 pass）+ 把"安装器误删用户空事件键"（M1 变异）从唯一检出面移除，净削弱承重判据
- W1a-投影不删 `emptiedEvents`：版本迁移场景（旧事件键合法消失）引入新误报
- W2-升级通用 TOML parser：违反"词法扫描不升级为通用 TOML parser"的原设计边界
- W2-含多行字符串即整体降级 indeterminate：多行串常出现在无关段（如 mcp 描述文本），一刀切制造大量"判不了"噪声

## Spec 影响

- 需要更新的 spec: 无需更新（current-spec.md 无 hooks 安装行为细节记载；F240 历史 spec 按 fix 模式不回改，本报告对账即可）

## 回归护栏（继承任务卡 + 对抗审查加固）

- 非破坏性合并语义不回退；"无语义变更一个字节都不写"（保原始缩进 + 最初 .bak）不回退
- codex:doctor / codex:inventory 四方一致性、"判不了就大声报"不回退
- W3 权限断言测试红先行（0600 保全 + 0o7777 高位保全 + 首次创建 0600 + tmp 无 0644 窗口）
- W1a 三连断言红先行：FP 消除 + M1 变异检出保持 + RAW 槽检出保持
- W1b 升版路径断言：install --json 输出直接作 --desired → 零误报；不传 desired 仍最严格口径
- W2 fixture 组：行尾注释跨产品错归属（主锚点）/ `\"` 转义 / `[[array]]` 泄漏 / FORM-D/E 多行字符串 / `[hooks]` 产品段不再误判
- 全量 vitest + test:plugins + build + repo:check + release:check 零失败

## F240 审查原始记载对账（验收要求逐条标注）

| 审查条目 | 裁决 |
|---------|------|
| W3 权限位静默放宽 | **确认并修复**（修法经对抗审查加固：0o7777 掩码 / tmp 0600 创建 / 首创建 0600 实证依据） |
| W1 projectForeignOnly 空数组不对称 | **确认并修复**（修法从投影侧改为比较语义侧；另纳入对抗审查新发现的升版路径误报 W1b） |
| W2 段头词法扫描漏形态 | **确认并修复**（严重度修正：行尾注释为高概率 fail 级主形态；修法扩至转义感知 + 多行字符串状态位 + hooks.state 判据收窄） |
| W4 .bak 非本次写入前状态 | **确认但裁决不改行为**（设计意图经实测确认成立；补偿面重设计为全部可证实文案 + 真实路径打印 + 死分支收口） |

## 对抗审查裁决记录（Codex 配额耗尽期 · 异构档位）

两路独立子代理（不注入我方推演，仅给证伪任务）：
- 路 1「权限/合并破坏面」：3 CRITICAL / 7 WARNING / 10 INFO（全部附隔离实验室实测）
- 路 2「诊断误报面」：3 CRITICAL / 5 WARNING / 7 INFO（全部附隔离实验室实测）

主线程裁决摘要：
- **接受并改设计**：路1-C1/C2（W1 修法撤换）、路1-C3+Wg（src/ 分流+事实错误修正）、路2-C1（转义感知入判据）、路2-C2（多行字符串状态位）、路2-C3（W2 严重度修正）、路2-W-b（W1b 纳入）、路2-W-c（W4 文案重写）、路2-W-d（hooks.state 收窄）、两路同发现的 Wb/W-e（tmp 0600 创建）、路1-Wa（0o7777）
- **吸收为实现细节**：路1-Wd（chmod 位置/失败策略）、路2-I-2/I-3（path 字段/backupPath）、两路同发现 I10/I-1（死分支）、路2-I-4（回滚指引）、路2-I-6（不支持清单+[推断]标注）
- **登记边界/分流**：路1-Wc（TOCTOU）、路1-I4（悬空 symlink）、路1-I9（emptiedEvents 共享轴盲区）、路1-We/Wf+I7/I8（Claude 侧问题群候选卡）、路2-I-5（.find 首匹配漏诊候选卡）、路1-I1/I2/I5/I6（无需处理/已缓解）
- **矛盾仲裁**：hook-installer.ts:147-148 两路结论相反 → 均属实、维度不同（O_TRUNC 机制 vs chmod 0755 放宽），随 Claude 侧分流
- **未构造出反例而保留的原判**：W1a 比较语义修法不掩盖命令丢失；W3 现象与行号；W4 设计裁决本身；--json 通道可达性

### Phase 4（实现轮）第二轮异构对抗与修复重验

实现完成后按同档位再审（4a spec-review 0C/0W/2I · 4b quality-review 0C/0W/3I · 异构对抗两路），对抗两路各抓出一条**实现引入的真 CRITICAL**，均已修复重验：

**CRITICAL-A（诊断面）**：W2 首版把多行串 tracker 跑在注释/引号归约之前 → 单行字符串/注释里的杂散 `"""` 偶数次出现造出"幻影多行串"吞掉中间段头 → `note = '写法是 """'` 这类零构造痕迹的合法 TOML 触发 fail 级错归属（净引入回归：HEAD 上该三形态解析正确；65 个新测试因镜像同构全绿）。**修复**：注释剥离与多行串跟踪合并为单遍逐字符扫描器（`createTomlScanner`，三连引号只在串外且非注释处才是定界符）；段边界与段名解析分离（任何 `[` 开头归约行都重置归属，能解析才建条目——同时收口 WARNING：段头含 `]` 失配泄漏）；补 6 组对抗矩阵测试锚定（红 4 → 绿 71）。

**CRITICAL-B（权限面）**：W1b 首版把谓词派生的 `removedCommands` 静默并入判据 2 减数 → "归属误认误删第三方条目"（与我方升版命令同形、无判别式）在推荐口径下 exit 0 假 pass——判据 2"不经过归属谓词"的存在意义被消解；测试全绿因新旧用例恰好各走一半 --desired 形态。**修复**（裁决方案 (b)+可见性，优于显式 flag 方案——自动链下后者会退化为无脑转喂且少 warning）：豁免保留但每条谓词派生豁免产出 `foreign-command-removed-by-declaration` warning finding（status pass→warning，exit 不变），报告面新增 `removedByDeclaration` 出口，注释如实降级独立性宣称为「减数来源 ↔ 是否经谓词 ↔ 误删表现」明细表。**语义变更**：正常升版路径 validate 结论从 pass 变为 warning（判据无法区分升版与误认，"需人工过目"是如实信号非误报）。

同轮一并修复：W1a 豁免内容盲（after 侧注入 `backdoor.sh`/类型销毁 null 被掩盖 → 豁免条件追加"after 投影须已无该键"，一行收窄零代价）；`--remove --json` 作 desired 静默塌空减数 + "三形态互斥"论断不成立（识别改为两字段任一存在 + 畸形 fail-loud exit 2 + 注释改判定优先级）；`mkdirSync` 无 mode（umask 000 下 0777 目录可 unlink 替换 0600 文件，文件位收紧而注入面未关 → `mode: 0o700` 仅影响新建路径分量）；tmp `flag:'wx'`（预置/软链穿透变报错）；diagnostics 必传；"保全≠加固"注释。

**第二轮登记不修项**：CLI 兜底渲染把未来 info 级 code 标"警告"（现状无活诊断中招，零收益改动不开轮）；`[hooks."state"]` 引号键等价形态（T062 信任记录位置未确证前不扩，双路审查同结论）；软链恶意预置的任意覆写是既有面（新增：mode 精确保全抹掉了"权限突变"这一旁证信号，如实登记）；多行数组续行 `[1, 2],` 被当段边界（absent 安全方向的过度近似，W2 修复代理自证伪其初版注释后改写）；单行串内容无法伪造段头（定界引号保留归约，实测证实）。

**操作事故记录**：W2 修复代理做受控 A/B 时用 `git stash push` 隔离单文件，把并行代理的未提交 W4 实现一并卷走——即刻 `git stash pop` 恢复并逐字节 diff 确认一致后改用"就地改一行→跑→从副本还原"完成 A/B。教训（进 dogfooding ledger）：多代理共享工作树的派发 prompt 须显式禁用 `git stash/checkout` 类隔离手段。

**回归护栏修订**（对应 CRITICAL-B 的语义变更）：W1b 断言由"升版路径零误报"修订为"升版路径零 **fail** 误报 + 每条声明豁免有 warning 可见 + 不传 --desired 仍最严格口径"。
