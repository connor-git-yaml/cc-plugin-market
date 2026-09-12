# F283 · Codex hooks 归属表派生化 + generator 抓「加」+ DELEGATION_TOOL_NAMES 单源 + parseRenameOperands 变异钉住矩阵

> 模式：spec-driver-fix（主线程实施 + 异构对抗复审 ≥2 切入角 + verify 子代理）。**门禁类改动**（hooks 分发门禁 / 判定器闭包）：
> Codex 配额暂停期走异构对抗档位，commit 标注「Codex 审查暂停，异构档位缺席」。来源：M10 §12.2 W-2 / R1、§12.3 W-3。

## 1. 问题与证据

| 组 | 现状（改动前，行号按 9f08e128） | 证据 |
|---|---|---|
| (a) 归属表两份 + 守卫抓删不抓加 | `codex-hooks-schema.mjs` 的 `OWNED_HOOK_SCRIPT_SUFFIXES`（:100）与 `OWNED_HOOK_EXPECTED_EVENT`（:132）各手写一份；validator 只有 `product-handler-unregistered`（owned 但没登记期望事件 = 「删」方向）。`codex-hooks-generator.mjs` 第二循环（:147-176）只拒 Claude-only handler：canonical 新增一条**未登记**脚本会静默展开、穿过两层门禁装进用户 `$CODEX_HOME/hooks.json`；装完 `isOwnedEntry=false` ⇒ `--remove` 不回收、`validate --baseline` 把它当第三方数据保全 | M10 §12.2 W-2 主线程复核成立；本卡 A/B：改动前跑「Stop 下挂 brand-new-hook.sh」用例 → generator 不抛（红先行 §3） |
| (b) `DELEGATION_TOOL_NAMES` ×3 | core:380 / ledger-writer:47 / ledger-reader:63 各一份 `new Set(['Agent','Task'])`，core↔reader 无守卫（只有 hooks.json matcher ↔ reader 的派生守卫） | M10 §12.2 R1；对抗 E W-1 |
| (c) `parseRenameOperands` 判据零钉住 | `operands.length !== 2 → null`（core:297）改成 `< 2` 后 829 用例零红——多操作数会"取前两个"跟随改名（方向：跟随保真度） | M10 §12.3 W-3（21 组变异实验之一） |

**根因**：三处都是「事实源落在消费层、守卫只盯一个方向」——表复制一份就多一个漂移面，判据没有对应的反向用例就只能靠人眼。

## 2. 修复

1. **(a) 派生化**：`OWNED_HOOK_SCRIPT_SUFFIXES = Object.freeze(Object.keys(OWNED_HOOK_EXPECTED_EVENT).map(k => Object.freeze(k.split('/'))))`——登记点唯一（`<父目录>/<脚本名>` → 期望事件），派生表与原手写表逐项、逐序相同（实跑对照）；原 F270 P5 关于 ledger matcher 收窄的登记注释随表迁移。generator 第二循环在 Claude-only 判定之后追加 `!isOwnedEntry(handler.command, {allowPlaceholderRoot:true}) → throw`，错误文案指向唯一登记点。
2. **(b) 单源**：新增 `scripts/lib/delegation-tool-names.mjs`（`Object.freeze(new Set(['Agent','Task']))`）；core / ledger-writer import，ledger-reader 转发导出（`export { DELEGATION_TOOL_NAMES }`，hooks.json matcher 守卫的 import 面不变）。为什么独立模块：core 是零 I/O 层不得反向 import writer；reader 已 import writer，writer 再 import reader 成环。模块进 `JUDGE_FILE_SET`（10→11）；三处钉数量的测试改为从 `JUDGE_FILE_SET.length` 派生（S4/S7/S8 的「9 unchanged」硬字符串是 F287 当天刚踩过的脆弱面）。
3. **(c) 单元合同矩阵**：23 行输入 × 期望（1/3 操作数 → null、`--` / `-fv` / 带参 option / 引号剥除三形态 / 单字符 `-` / tab 分隔 / option 数 8 与 9 的上界两侧 / 空串）。**如实口径（对抗复审 W-3 校正首稿）**：矩阵 23 行里只有 4 行在生产入口可达——`resolveFeatureDirCandidate` 之前的 `scanRenameCommandEvents`（F231 光杆单命令判据 + option 白名单 `^-[fv]+$` + 路径 token 正则）已把其余形态先拒；13 条 `parseRenameOperands` 变异对既有 604 条 core 用例零红是**判据被 scanner 遮蔽**，不是覆盖缺口，M10 §12.3 W-3「`!== 2` 改 `< 2` 零红」的方向钉实际在 `scanRenameCommandEvents:1345`（同型变异打在 scanner → 19 红）。本矩阵是 `parseRenameOperands` 的单元合同（回归钉），**不是**改名跟随方向的门禁证据；`parseRenameOperands` 相对 scanner 的冗余判据登记为 M11 清淤候选。

## 3. 红先行 / A/B（origin/master 9f08e128 临时 worktree）

- vitest `codex-hooks-ownership-derivation.test.ts`：改动前 **4 红 / 4 绿**（未登记脚本不抛 / 第三方形态不抛 / 源码层无派生表 / 源码层无新守卫；两表键集相等与六条 owned 判定在改动前本就成立——派生只收编事实源、不改语义），改动后 16/16 绿（含对抗复审后新增用例；初稿 8/8，verify 子代理复核更正）。
- node:test `f283-delegation-single-source.test.mjs`：改动前 **import 失败即红**（`delegation-tool-names.mjs` 不存在），改动后 5/5 绿。
- 既有守卫：hooks 7 套件 245/245、ledger-writer/reader 49/49、`test:plugins` 1843/0；派生表与手写表实跑逐项相同（§2.1）。

## 4. 影响范围与边界

- 分发链行为：canonical `hooks.json` 六条 owned handler 展开结果逐字不变；**新增**的差异只有一条——canonical 里出现未登记脚本时 generator 现在 fail-loud（此前静默装入），install 因此 fail-loud（退出码走既有异常路径），这是 W-2 要的方向。
- validator：`product-handler-unregistered` 在派生化后结构性不可达（owned ⇒ 必登记）——保留判据不删（第三方 / 手改快照仍可能触发它的输入形态），登记为"派生后恒不触发"。
- `DELEGATION_TOOL_NAMES` 内容不变（`{Agent, Task}`；`SendMessage` 仍刻意不并入，core 既有用例钉住）。
- 不做：`parseRenameOperands` 的双 tokenizer 收敛（§12.2 R3，非本卡）；改 hooks 事件集 / matcher；`product-handler-*` 码族重构。

## 5. 审查档位

门禁类：主线程自审 + **异构对抗复审 ≥2 切入角**（分发链绕过 / 误伤第三方条目 + 闭包与判据方向）+ verify 子代理；Codex 配额暂停期，commit 标注「Codex 审查暂停，异构档位缺席」。结论见 §7 与 `verification/`。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——改动面是 `.mjs` 插件脚本（图不覆盖 plugins/ 调用链），依赖面靠 `rg` + JUDGE_FILE_SET 闭包守卫。
- Spec Driver：主线程按 fix 骨架推进（用户要求本 session 内直接执行），未调用编排器 SKILL。无实质工具反馈，不落账。

## 7. 异构对抗复审处置（2026-09-13，两路：分发链绕过 / 判据方向）

两路均 **0 CRITICAL**（A：0C/4W/7I；B：0C/4W/6I）。派生本身对全局 hooks.json 的安装 / 幂等 / 卸载 / 校验行为与 HEAD 逐字节一致（A 角 11 种伪我方形态 + 7 种第三方形态全部保全、六条可回收）。处置：

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| A-W1 / B-W1 | WARNING | 准入闸复用 `isOwnedEntry`（命令里任一 token 命中 = 回收闸口径）：包装器 + 参数提及（`bash …/with-timeout.sh …/stop-task-check.sh`）、注释 / env 提及、引号 / 转义拼出的占位符（`"$"{CLAUDE_PLUGIN_ROOT}`）都穿过并装入；且包装器形态让 product 层「6 条一条不缺」静默放行 | **修**：新增 `isOwnedExecutableEntry`——剥前导 `NAME=value`、跳过解释器 / flag 后，**第一个被执行的脚本路径**必须是登记脚本；准入闸改判在 `expand` 之后的产物上（判据与装进去的字面量同一）；非字符串 command 的类型错误先于守卫（A-I1）。测试：四种提及形态 + 三种引号占位符形态 → 抛；env 前缀 / `-e` / 尾随参数的合法写法不误拒 |
| A-W2 | WARNING | 派生对键形状零校验：三段键把目录名派生成脚本锚点（第三方目录被认领 → 误删方向），一段键派生 `[name, undefined]` | **修**：`deriveOwnedSuffixes` 断言两段非空，模块加载即抛；单测钉三种畸形键 |
| A-W3 | WARNING | 两表耦合后无「退役脚本」路径：删键即让历史条目永久失去归属（升版不替换、`--remove` 不回收、validate 归第三方） | **登记**：`OWNED_HOOK_EXPECTED_EVENT` JSDoc 明写禁止直接删键、退役须新增「参与归属、不参与期望」的退役表机制（M11） |
| A-W4 / B-W4 | WARNING | `Object.freeze(new Set())` 不阻止 `add / delete / clear`，"冻结"是装饰性保证；reader 消费点对 `Task` 零测试覆盖 | **修**：`DELEGATION_TOOL_NAMES` 覆盖三个变更方法为抛错后冻结（单测 `assert.throws`）；`ledger-reader.test` 补 `tool_name: 'Task'` 用例 |
| B-W2 | WARNING | 行为测试只在 `Stop[0].hooks` 末位插 handler，「按位置收窄」的守卫退化零红 | **修**：`withExtraStopHandler` 参数化首位 / 末位 / 新 group |
| B-W3 | WARNING | (c) 矩阵 23 行中 18 行生产不可达（5 行可达：verify 子代理用 scanRenameCommandEvents 逐行实测，初稿写 4 行漏计单字符 `-` 操作数行）；13 条变异对既有用例零红是判据被 scanner 遮蔽 | **改口**（§2.3）+ 补 tab 行 + 修 I-3 无意义表达式 |
| A-I2 | INFO | `validate --canonical-source` 不含新守卫（canonical 里未登记脚本当第三方放行） | **修**：产品事件下的未登记 handler 判 `canonical-unregistered-script` fail（非产品事件沿用 F264「第三方不参与 handler 级判据」契约） |
| A-I3 | INFO | `product-handler-unregistered` 在合法键下结构性不可达、注释失真 | 注释改口（畸形键已被派生断言拒绝，分支只作防御兜底） |
| A-I5 | INFO | 既有：`--remove` 无条件删用户预存的空事件键（install 侧有守卫、remove 侧无） | 登记 → 另立小卡（非本卡引入） |
| B-I1 | INFO | 「两表键集相等」在派生下恒真；源码形态断言可被改名副本绕过 | 如实登记：真守卫是派生本身 + generator 行为用例；源码断言只防"重新手写第二张表且内容分歧" |
| B-I2 | INFO | 红先行：vitest 4 红中 2 条是源码文本红；node:test 是 ERR_MODULE_NOT_FOUND 平凡红；矩阵在 master 上全绿 | §3 改口 |
| A-I6 / B-I6 | INFO | 基于 9f08e128，master 已前移 | 交付前 rebase 重验 |
