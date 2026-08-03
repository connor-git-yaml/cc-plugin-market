# Spec 合规审查报告（245-fix-hook-payload-path，fix 模式）

> 审查主体：spec-review 子代理（agentId a55cf8d8be872b172）。该子代理工具集无 Write 权限，本文件由编排器按其返回内容逐字代为落盘（内容零改写）。

## 1. 修复与根因一致性（方案 A 三层逐层核对）

| 层 | fix-report/plan 要求 | 代码实证 | 判定 |
|---|---|---|---|
| 取值修复-jq | `.tool_input.file_path // .file_path // empty` | `pre-tool-use-guard.sh:21`、`post-tool-use-format.sh:17` 完全一致 | PASS |
| 取值修复-grep 降级 + tool_name 门槛 | 先抓 `tool_name`，非 `Edit\|Write\|MultiEdit` 直接 `exit 0` | `pre-tool-use-guard.sh:25-29`、`post-tool-use-format.sh:21-25` 一致 | PASS |
| 活跃判定收窄 | 全仓扫描 → `specs/$(git branch --show-current)/tasks.md` | `pre-tool-use-guard.sh:45-53`：`CURRENT_BRANCH` 为空/文件不存在均 `exit 0`，无全仓 `for` 循环残留 | PASS |
| 安全默认-warn/block | 默认 stderr WARN + `exit 0`；仅 `SPEC_DRIVER_SRC_GUARD=block` 时 `exit 2` | `pre-tool-use-guard.sh:55-61` 精确实现，`if` 结构未用 `&&` 链式（与 plan 第 3 点写法一致） | PASS |
| 安全默认-prettier 门槛 | `.prettierrc*`/`prettier.config.{js,cjs,mjs}`/`package.json` `"prettier"` 字段任一命中才格式化 | `post-tool-use-format.sh:43-59` 逐项判断，`for` 循环 + 独立 `if [ -f package.json ]` 分支，无配置 `exit 0` | PASS |

结论：三层修复与 fix-report「方案 A」描述及 plan.md 变更清单**逐点吻合**，未发现实现漂移。

## 2. 行为矩阵合同核对

**pre-guard 矩阵（fix-report.md，6 行 × 2 列）**：

| 行 | 默认档 | block 档 | 代码路径 | 测试覆盖 |
|---|---|---|---|---|
| 嵌套+src/+当前分支有未完成任务 | WARN+exit0 | WARN+BLOCKED+exit2 | L55-61 | `#1`、`#2` |
| 嵌套+src/+无对应分支或已清 | exit0 | exit0 | L46-53（无对应目录）/ L55 `grep -q` 不命中（已清） | `#9`、`#10` |
| 嵌套+非 src/ | exit0 | exit0 | L39-42 | `#3` |
| 无 file_path | exit0 | exit0 | L34-36 | `#5` |
| 畸形 JSON/取不到值 | exit0 fail-open | exit0 | jq 分支 `|| echo ""` 兜底（L21）+ FILE_PATH 空判定 L34 | `#6` |
| 无 jq+tool_name 非编辑类 | exit0 | exit0 | L26-29 | `#8`（+ `#7` 覆盖无 jq 正例） |

6 行全部有对应实现代码路径与至少 1 个测试用例，另有 `#4`(扁平兼容对照)、`#11`(非 git)、`#12`(detached HEAD) 属于矩阵未显式列出但 plan.md 测试矩阵已定义的补充场景——**属于加固覆盖，非越界**（plan.md 本身即定义了 12 例，多于 fix-report 矩阵行数是设计内的）。

**post-format 矩阵**：「有配置+JS/TS/JSON → npx prettier；无配置 → 静默放行；其余同前 fail-open」，对应 `post-tool-use-format.sh:37-59`，测试 `#1/#3/#8`(有配置走 npx)、`#2/#5`(无配置/非目标扩展名不走 npx)、`#4/#6/#7`(fail-open 各分支) 全覆盖。

判定：两张矩阵**全部被实现与测试覆盖**。

## 3. 越界改动检测

- `hooks/hooks.json`：matcher 仍为 `Edit|Write`，与「不改动项」声明一致，未发现改动（Read 全文核对）。
- `stop-*.sh`：未发现被触及的证据，与 fix-report「[安全] 不涉及」一致。
- `.codex-plugin/**`：`plugins/spec-driver/.codex-plugin/plugin.json` 仅 `version` 字段随 release:sync 同步为 `4.4.1`，属受控 release 行；无其他镜像 hook 副本被改动。
- release:sync 生成产物核对：`contracts/release-contract.yaml`（4.4.0→4.4.1 + productMappingDescription 追加摘要）、`.claude-plugin/marketplace.json`、`plugins/spec-driver/.claude-plugin/plugin.json`、`plugins/spec-driver/.codex-plugin/plugin.json`、`plugins/spec-driver/README.md`（`> 当前发布版本: v4.4.1`）——**均为受控 release 行的版本号/摘要变化**，未发现手工改写生成产物的痕迹。
  - ~~`package-lock.json`（spec-driver 块 4.4.1）~~ **编排器勘误（第二轮 Codex 审查发现）**：此句原为失实表述——`git diff HEAD -- package-lock.json` 为空，lock 文件本次未被触及（release contract 无 packageLockPath，不在同步面内，这是预期行为）；原引用的 L2988 `4.4.1` 实为无关包 `formdata-node` 的版本号，系张冠李戴。
- `.claude/**` 未见改动痕迹。

判定：**未发现越界改动**，改动面与 fix-report/plan 声明的文件清单一致。

## 4. plan 偏离项合规性

- **偏离 1（post-format 测试用 npx 桩替代真跑）**：`post-tool-use-format.test.mjs:93-98` 用 shell 脚本记录调用参数到 marker 文件，断言 `npxCalls` 命中内容，而非真实调用远程 prettier。只影响测试执行方式，生产脚本对 `npx prettier --write` 的真实调用逻辑未变。合规。
- **偏离 2（无 jq 降级 PATH 用 Node 侧定位真实可执行文件）**：`locateCommand` 遍历 `process.env.PATH` 找真实二进制再软链进受控目录，纯测试 fixture 构造手法，不涉及生产脚本。合规。

两处偏离**仅影响测试实现细节，未触及 plan 定义的产品行为合同**。

## 5. spec 同步义务

- 全仓检索 `pre-tool-use-guard|post-tool-use-format`：命中仅为本次新增测试文件 + specs/245 制品；README/docs 无描述这两个 hook 行为的段落需要同步。fix-report 判断与实测检索一致。
- README 新增的 productMappingDescription 摘要准确描述新行为（tool_input 嵌套取值、判定收窄、warn-only 默认、prettier 配置门槛），无矛盾。
- F084 历史制品未被回改，与声明一致。

判定：**未发现遗漏的 spec/文档同步义务**。

---

## 问题分级汇总

- **CRITICAL**: 0 个
- **WARNING**: 0 个
- **INFO**: 0 个

## 结论

实现与 fix-report.md「方案 A」三层修复、plan.md 变更清单及两张行为矩阵**逐条吻合**，改动面严格限定在声明文件清单内，2 处已披露的测试工艺偏离不影响产品行为合同，未发现遗漏的 spec/文档同步义务——**Spec 合规审查全部通过（PASS）**。
