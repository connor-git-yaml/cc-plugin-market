# 修复规划：hooks payload 嵌套取值缺陷（方案 A）

**Feature**: 245-fix-hook-payload-path
**模式**: fix（问题修复，非新功能）
**依据**: `specs/245-fix-hook-payload-path/fix-report.md`（5-Why 诊断 + 方案 A 已确认）

## 摘要

`pre-tool-use-guard.sh` / `post-tool-use-format.sh` 从顶层 `.file_path` 取值，真实 harness payload 把 `file_path` 嵌套在 `tool_input` 下，导致两 hook 长期恒放行/恒不生效。方案 A 三层修复：① jq/grep 双分支取值改为 `tool_input.file_path // file_path` 兼容取值 + grep 分支加 `tool_name` 门槛防误抓；② pre-guard 活跃判定从"全仓任一 tasks.md 有未完成任务"收窄为"当前 git 分支对应的 spec 目录有未完成任务"；③ pre-guard 默认 warn-only（仅 `SPEC_DRIVER_SRC_GUARD=block` 时才 exit 2），post-format 增加"项目存在 prettier 配置才格式化"门槛。全部失败路径保持 fail-open。新增两份 node:test 测试文件补齐 hooks 零测试盲区，纳入 `test:plugins`。

---

## 变更清单（逐文件逐点）

### 1. `plugins/spec-driver/hooks/pre-tool-use-guard.sh`（重写，43 行 → ~50 行左右）

| # | 位置（原行号） | 改动 |
|---|---------------|------|
| 1a | L12-13（jq 分支取值） | `.file_path // empty` → `.tool_input.file_path // .file_path // empty`（优先嵌套形状，保留扁平兼容） |
| 1b | L14-15（grep 降级分支） | 拆两步：先用同一 grep+sed 手法抓 `"tool_name"` 值，`case` 判定 `Edit\|Write\|MultiEdit` 才继续；非编辑类工具直接 `exit 0`。判定通过后再抓 `"file_path"`（正则与原逻辑一致，不改） |
| 2 | L27-35（活跃判定循环） | 删除 `for tasks_file in specs/*/tasks.md` 全仓扫描；改为：`CURRENT_BRANCH=$(git branch --show-current 2>/dev/null \|\| echo "")` → 空则 `exit 0`；`TASKS_FILE="specs/${CURRENT_BRANCH}/tasks.md"` → 不存在则 `exit 0`；`grep -q '^\- \[ \]' "$TASKS_FILE"` 沿用原 if 结构（不用 `&&` 链式，避免 `set -e` 误触发） |
| 3 | L37-40（阻断分支） | 判定命中未完成任务时：先 `echo "[PreToolUse WARN] ..." >&2`（始终输出，作为可观测信号）；再判 `[ "${SPEC_DRIVER_SRC_GUARD:-}" = "block" ]`，命中才追加 `[PreToolUse BLOCKED]` stderr 并 `exit 2`；否则跌落到脚本末尾 `exit 0` |
| 4 | 全文 | 变量引用统一加双引号；`echo "$INPUT" \|` 改 `printf '%s' "$INPUT" \|`（防 payload 内容含 `-e`/反斜杠被 echo 转义误吃，行为更贴近字面透传） |

### 2. `plugins/spec-driver/hooks/post-tool-use-format.sh`（重写，29 行 → ~40 行左右）

| # | 位置（原行号） | 改动 |
|---|---------------|------|
| 1 | L11-15（取值） | 与 pre-guard 1a/1b 同一模式：jq 分支加 `.tool_input.file_path //`；grep 降级分支先判 `tool_name` |
| 2 | L20-26（扩展名分支后） | 新增门槛：`case` 匹配到 JS/TS/JSON 扩展名后，先探测项目是否有 prettier 配置——`.prettierrc*`（含 `.prettierrc`、`.prettierrc.json/.yaml/.yml/.js/.cjs/.mjs` 等 glob）或 `prettier.config.{js,cjs,mjs}` 任一存在，或 `package.json` 内 `grep -q '"prettier"'` 命中 → 视为"有配置"；用 `if [ -f ... ]; then FOUND=true; fi` 逐项判断（不用 `&&` 链式）；无配置则 `exit 0`，跳过 `npx prettier` |
| 3 | 全文 | 同 pre-guard：`printf '%s' "$INPUT"` 替换 `echo "$INPUT"`；变量引用加双引号 |

两脚本均保留 `set -euo pipefail`、shebang、755 可执行位不变；不改函数签名之外的注释头（更新用途说明中"活跃判定"与"格式化前置条件"两句）。

### 3. `plugins/spec-driver/tests/pre-tool-use-guard.test.mjs`（新增）

node:test + `spawnSync('bash', [SCRIPT_PATH], { input: JSON.stringify(payload), cwd: fixtureRepo })`。测试 fixture：`fs.mkdtempSync` 建临时目录 → `git init -q` → 可选 `git checkout -b <branch>` → 按需写 `specs/<branch>/tasks.md`。

覆盖矩阵见下方「验证方案」。

### 4. `plugins/spec-driver/tests/post-tool-use-format.test.mjs`（新增）

同样 spawn 模式；fixture 额外覆盖"待格式化文件是否存在""是否有 prettier 配置"两个维度；不真正联网跑 `npx prettier`（用 `command -v npx` 天然存在但配置探测门槛已在 `npx` 调用之前拦截多数用例；唯一会触发真实 `npx prettier` 的用例改为断言"配置存在时脚本仍以 exit 0 收尾"，不断言文件内容被重排，避免测试依赖网络/prettier 版本）。

### 5. `contracts/release-contract.yaml`

`products.spec-driver.version: "4.4.0"` → `"4.4.1"`；`productMappingDescription` 前置追加一句 F245 摘要（沿用现有"vX.Y.Z（FeatureNNN）— ..."拼接惯例）。改后执行 `npm run release:sync` 同步 `plugin.json` / `marketplace.json` / `package-lock.json` / README 受控行，不手改这些文件。

### 不改动项（明确排除）

- `hooks.json` matcher（`Edit|Write`）—— 不动，MultiEdit 仍不在 harness 触发面内，脚本内 `case` 加 MultiEdit 仅为防御性穷举，不改变实际触发条件
- `stop-*.sh` 两个 Stop hook —— 已在 fix-report 影响面扫描中判定 [安全]，不涉及
- `.codex-plugin/**` —— 全仓 grep 确认两脚本无镜像副本，无需同步

---

## 回归风险评估

| 风险来源 | 场景 | 缓解措施 | 对应被激活缺陷 |
|---------|------|---------|---------------|
| 取值修复后判定从"恒 false"变"可能 true" | 全仓 65/215 个 tasks.md 有历史残留未完成任务 | 活跃判定收窄为"当前分支对应目录"，历史残留在其他分支目录下不再触发；master/无对应目录/detached HEAD 全部 fail-open | 缺陷 1（阻断从"恒放行"翻转"恒阻断"） |
| pre-guard 命中活跃工作流时的默认动作 | implement 子代理对同一 src/ 文件的 Edit 若默认 `exit 2` 会自我死锁 | 默认 warn-only（stderr 提示 + exit 0），仅显式 `SPEC_DRIVER_SRC_GUARD=block` 时才真正阻断；本仓库/默认安装不设该变量 → 不阻断，无死锁 | 缺陷 2（implement 子代理无差别命中） |
| post-format 取值修复后从"从不执行"变"每次 Edit/Write 执行" | 本仓库无 prettier 配置也无依赖，`npx prettier --write` 会临时安装并按默认规则重排整个文件，产生大规模意外 diff + 网络开销 | 新增 prettier 配置存在性门槛，无配置直接 `exit 0`；本仓库当前无配置 → 修复后行为与修复前一致（仍不格式化），不引入意外 diff | 缺陷 3（post-format 激活=意外格式化面） |
| `set -e` + `&&` 链式判断在管道/测试命令失败时误触发脚本提前退出 | `grep -q` / `[ -f ]` 无匹配返回非零，若写成 `cmd1 && cmd2` 独立语句可能被 `errexit` 判定为脚本失败 | 全部改用 `if cmd; then ...; fi` 结构（与原脚本 L31 既有安全写法一致），不引入新的 `&&` 链式独立语句 | — |
| grep 降级分支加 `tool_name` 门槛后，若某上游 harness payload 缺 `tool_name` 字段 | 门槛判定为空字符串，`case` 落入 `*)` 默认分支 → `exit 0` | 与"无 jq 环境 + 畸形/字段缺失 payload"场景一致，均 fail-open，不新增阻断面；仅在能明确识别 `tool_name` 为 Edit/Write/MultiEdit 时才继续，符合"宁可漏判也不误判"的门禁默认取向 | Why 4（观察盲区）关联：新增测试补足信号 |
| `printf '%s' "$INPUT"` 替换 `echo "$INPUT"` 改变管道输入字面值 | payload 含反斜杠转义序列时 `echo`（在部分 shell/选项下）可能误解释而 `printf` 不会 | 仅收紧为更贴近字面透传，对 jq/grep 后续解析更安全；新增测试用含特殊字符 file_path 的用例间接验证无回归 | — |
| 版本 bump 影响面 | `release:sync` 联动改写 `plugin.json`/`marketplace.json`/`package-lock.json`/README | 仅走 contract → sync 标准链路，不手改生成产物；`npm run release:check` 纳入提交前命令清单核验一致性 | — |

**未覆盖/明确接受的残余风险**：hook 的"当前分支对应 spec 目录"判定依赖 harness 调用 hook 时的 cwd 等于项目根（与原脚本 L29 `specs/*/tasks.md` 相对路径假设一致，非本次新增假设）；若某 harness 以非项目根 cwd 调用 hook，判定退化为"无对应目录"从而 fail-open，不会产生误阻断，仅可能漏判（可接受，符合安全默认原则）。

---

## 验证方案

### 测试矩阵

#### `pre-tool-use-guard.test.mjs`

| # | 场景 | payload 形状 | fixture 状态 | 期望 |
|---|------|-------------|--------------|------|
| 1 | 嵌套 + src/ + 当前分支有对应未完成任务（默认） | `tool_input.file_path=src/x.ts` | `git checkout -b <branch>` + `specs/<branch>/tasks.md` 含 `- [ ]` | exit 0 + stderr 含 `WARN` |
| 2 | 同上 + `SPEC_DRIVER_SRC_GUARD=block` | 同上 | 同上 | exit 2 + stderr 含 `BLOCKED` |
| 3 | 嵌套 + 非 src/ 路径 | `tool_input.file_path=docs/x.md` | 同上 | exit 0，无 stderr |
| 4 | 扁平兼容（对照场景，向后兼容） | 顶层 `file_path=src/x.ts` | 同上 | exit 0 + WARN（或 block 变体） |
| 5 | 无 file_path（如 Bash/NotebookEdit payload） | `tool_input` 无 `file_path` 键 | 任意 | exit 0 |
| 6 | 畸形 JSON | 非法 JSON 字符串 | 任意 | exit 0（fail-open，不抛异常） |
| 7 | 无 jq 降级 + Edit 工具嵌套 file_path | 同 1，构造 PATH 仅含 bash/grep/sed/cat/head/git 软链（无 jq） | 同 1 | 行为与 jq 分支等价（exit 0 + WARN） |
| 8 | 无 jq 降级 + Bash 工具 command 字符串含 `"file_path"` 文本 | `tool_name=Bash`，`tool_input.command` 内含字面 `"file_path": "src/x.ts"` 文本 | 同 1 | exit 0（tool_name 门槛拦截，不误抓） |
| 9 | 活跃判定收窄：当前分支无对应 spec 目录 | 同 1 payload | 分支名不对应任何 `specs/*` 目录 | exit 0（fail-open） |
| 10 | 活跃判定收窄：分支对应目录存在但 tasks.md 全部已完成 | 同 1 | `tasks.md` 仅含 `- [x]` | exit 0，无 WARN |
| 11 | 非 git 仓库 / git 命令失败 | 同 1 | fixture 目录无 `.git` | exit 0（fail-open） |
| 12 | detached HEAD | 同 1 | `git checkout --detach` | exit 0（`--show-current` 返回空） |

#### `post-tool-use-format.test.mjs`

| # | 场景 | 期望 |
|---|------|------|
| 1 | 嵌套 file_path，目标为 `.ts`，项目有 `.prettierrc` | exit 0（不断言文件内容被重排，只断言不因 `npx` 调用而失败/挂起） |
| 2 | 同上但项目无任何 prettier 配置/依赖 | exit 0，且不触发 `npx`（可用不存在 `npx` 的受控 PATH 间接验证：即便无 `npx` 也不影响 exit 0） |
| 3 | 扁平兼容 file_path | exit 0 |
| 4 | 目标文件不存在于磁盘 | exit 0（既有 `[ -f "$FILE_PATH" ]` 逻辑不变） |
| 5 | 非 JS/TS/JSON 扩展名 | exit 0，跳过配置探测分支 |
| 6 | 无 file_path / 畸形 JSON | exit 0 |
| 7 | 无 jq 降级 + tool_name 非 Edit/Write | exit 0（门槛拦截） |
| 8 | prettier 配置以 `package.json` 内 `"prettier"` 字段形式存在（非独立配置文件） | 判定为"有配置"（不触发实际 prettier 调用断言，仅验证判定分支未提前 exit 0） |

### 提交前命令清单（按序执行，任一失败即停止）

1. `bash -n plugins/spec-driver/hooks/pre-tool-use-guard.sh` / `bash -n plugins/spec-driver/hooks/post-tool-use-format.sh`（语法自检）
2. `node --test plugins/spec-driver/tests/pre-tool-use-guard.test.mjs plugins/spec-driver/tests/post-tool-use-format.test.mjs`（新增测试单独跑，快速迭代）
3. `npm run test:plugins`（`node scripts/run-plugin-tests.mjs`，确认新测试文件被自动枚举纳入，且全量 `*.test.mjs` 零失败）
4. `npx vitest run`（零失败，确认未触及任何 TS 单测面）
5. `npm run build`（类型检查零错误）
6. `npm run lint`
7. `npm run release:sync` → `npm run release:check`（版本 bump 一致性）
8. `npm run repo:check`（含 release-contract 复核 + 插件同步校验）

### 验证收口标准

- 12 + 8 = 20 个新增用例全部通过，且能在临时 fixture 中稳定复现（无对本仓库真实 `specs/`/`.git` 状态的依赖）
- 修复前后对照：本仓库当前 `SPEC_DRIVER_SRC_GUARD` 未设置 → pre-guard 在本仓库任何分支上默认不阻断（即便命中活跃分支）；post-format 因本仓库无 prettier 配置 → 默认不触发格式化（与修复前行为一致，不产生意外 diff）
- fix-report 记录的 3 个"场景 A/B/C"复现实验用新测试的对应用例（#1/#4/post-format #1）覆盖，形成回归防护
