# 代码质量审查报告 — Feature 245 hooks payload 嵌套取值缺陷修复

审查对象：`plugins/spec-driver/hooks/pre-tool-use-guard.sh`（重写）、
`plugins/spec-driver/hooks/post-tool-use-format.sh`（重写）、
`plugins/spec-driver/tests/pre-tool-use-guard.test.mjs`（新增）、
`plugins/spec-driver/tests/post-tool-use-format.test.mjs`（新增）、
`contracts/release-contract.yaml`（version bump 4.4.0→4.4.1）。

审查方式：静读代码 + 对抗性心智测试 + 实际 shell 运行验证（非纸面推断），
所有下述发现均已在本机 `/tmp` 沙箱临时仓库中实测复现或证伪。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 三层修复（取值/判定收窄/安全默认）与 plan.md 设计一致；fail-open 哲学与 stop-fix-compliance-check.sh 一致；未引入新依赖或跨层耦合 |
| 设计模式合理性 | GOOD | jq 优先 + grep 降级双分支职责清晰；grep 降级分支加 tool_name 门槛的思路合理，但存在字段顺序假设（见问题清单） |
| 安全性 | NEEDS_IMPROVEMENT | 无硬编码密钥/SQL注入/反序列化风险；发现 1 个 grep 降级路径下的漏判分歧（fail-open 方向，非阻断绕过）+ 1 个理论参数注入面 |
| 性能 | GOOD | 纯文本处理，无 N+1/内存泄漏；活跃判定从全仓 scan 收窄为单文件检查，是性能与语义双重改进 |
| 可读性 | GOOD | 注释充分说明 why（活跃判定收窄理由、warn-only 理由、prettier 门槛理由）；控制流线性、无深嵌套 |
| 可维护性 | GOOD | 两脚本高度对称（取值逻辑几乎复制），函数级封装缺失但脚本量级（63/65 行）不足以强制拆分；测试覆盖首次纳入 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 安全性/grep降级等价性 | pre-tool-use-guard.sh:30、post-tool-use-format.sh:26 | **实测复现**：当 payload 同时含顶层 `file_path` 与嵌套 `tool_input.file_path`（如 `{"tool_name":"Edit","file_path":"docs/x.md","tool_input":{"file_path":"src/real.ts"}}`）时，jq 分支正确按 `.tool_input.file_path // .file_path` 优先级取到 `src/real.ts`（触发 WARN）；grep 降级分支的 `grep -o ... | head -1` 无结构优先级，纯按文本出现顺序取到先出现的顶层 `docs/x.md`，判定非 src/ 路径而**静默放行**（无 WARN、无 BLOCKED）。方向是 fail-open（漏判不会导致误阻断），但意味着无 jq 环境下，若某网桥/自定义集成同时回填两处 file_path，pre-guard 门禁会对真实 src/ 编辑失效、post-format 会格式化错误文件或漏格式化。20 个新增用例未覆盖"两处 file_path 同时存在"场景。 | 若要收紧，可让 grep 降级分支优先匹配 `tool_input` 块内的 `file_path`（如先按 `"tool_input"\s*:\s*{.*"file_path"` 提取子串再二次 grep），或在注释中显式声明"grep 降级分支不保证嵌套优先级，仅结构化 jq 分支保证"，并补一条测试用例固化该已知限制，避免被误当新回归 |
| WARNING | 安全性/参数注入面 | post-tool-use-format.sh:62 | `npx prettier --write "$FILE_PATH"` 未使用 `--` 分隔符。**实测复现**：`file_path="-e.ts"`（无目录前缀，根目录文件）时，脚本对文件系统检查 `[ -f "$FILE_PATH" ]` 因单参数场景侥幸未误判，但传给 `npx prettier --write -e.ts` 后该值以 "-" 开头会被 npx/prettier 的 Commander 参数解析器当作候选 flag 而非纯文件名（本次未命中已知 flag 因而降级为普通参数，但换成 `--config`、`--parser` 等真实 prettier flag 同形字符串即会劫持行为）。触发前提是 file_path 恰好等于/开头为某个真实 npx 或 prettier flag 且该文件确实存在于磁盘并通过扩展名过滤，威胁面很窄（需要 harness/模型自身生成这种文件名），但属于可用简单加固消除的已知反模式 | 改为 `npx prettier --write -- "$FILE_PATH"`，`--` 后所有参数强制视为位置参数，一行改动即可消除该类 |
| WARNING | 一致性/文本编码 | post-tool-use-format.sh:17 vs :26 | **实测复现**：file_path 含 JSON `\uXXXX` 转义（如中文文件名 `中文.ts`）时，jq 分支正确解码为真实 Unicode 字符（`中文.ts`），grep 降级分支保留字面转义序列 `中文.ts`。post-format 场景下，grep 降级路径提取的字符串不会匹配磁盘上的真实文件，导致 `[ -f "$FILE_PATH" ]` 恒假、prettier 静默不执行——功能性回归（对无 jq 环境下的非 ASCII 文件名，格式化恒失效），非阻断安全问题，但会员产品体验上"格式化在部分环境下对中文文件名不生效"且无任何提示信号，与本次修复"补测试堵盲区"的初衷部分冲突（此分歧未被 20 个用例覆盖） | 可接受为已知限制并在脚本注释补一句"grep 降级分支不做 JSON 转义反解码"，或后续 Feature 评估是否值得引入 `printf '%b'` 之类反转义手段（成本收益需评估，不建议本次顺带改） |
| WARNING | 可维护性/文本顺序假设 | pre-tool-use-guard.sh:25、post-tool-use-format.sh:21 | grep 降级分支的 tool_name 门槛依赖"payload 中 `tool_name` 键的文本序位早于 `tool_input.command` 内任何嵌入文本"这一未强制校验的假设——JSON 对象字段本身无序，仅因当前 harness 序列化习惯把 `tool_name` 放在 `tool_input` 之前而成立。若未来任一 harness/桥接层调整字段顺序（如把 `tool_input` 放在 `tool_name` 之前），该门槛会失效，退化为 F245 修复前的误抓风险（虽然 fail-open，最坏情形只是误判非编辑类工具为编辑类从而多做一次判定，不会导致误阻断，因为 case 分支只是决定"是否继续往下抓 file_path"，抓错也只影响后续 src/ 匹配是否命中）。fix-report 与 plan.md 均未记录此假设为"已知残余风险" | 建议在脚本注释追加一句显式声明该假设的边界（"本降级分支假定 tool_name 键先于 tool_input 出现于原始 JSON 文本"），便于未来排障时快速定位，无需改变现有逻辑 |
| INFO | 可维护性 | pre-tool-use-guard.sh / post-tool-use-format.sh 全文 | 两脚本取值逻辑（jq/grep 双分支 + tool_name 门槛）几乎逐字重复（约 15 行），未来若两脚本任一取值逻辑再修，容易漏改另一处（本次 fix-report 已明确点名"同步修复两分支"作为过程纪律，但代码层面无强制） | 可评估抽取共享 `lib/extract-file-path.sh`（source 引入），但需权衡 hooks 独立可执行（无外部 source 依赖）的部署简单性；不建议本次顺带重构，留作后续观察项 |
| INFO | 测试质量 | pre-tool-use-guard.test.mjs / post-tool-use-format.test.mjs | 两测试文件命名为 `.test.mjs`（node:test），与仓库 `.claude/rules/tests.md` 声明的 "`.test.ts`/`.spec.ts` + vitest" 规范不完全一致；但这是延续 hooks 目录既有约定（`ensure-gitignore.test.mjs` 等），bash 脚本无法被 vitest 直接驱动，`test:plugins` 合同本就是独立的 `node --test` 通道，非本次引入的新偏离 | 记录为可接受的既有架构决策（bash hook 测试通道独立于 TS 单测通道），无需改动 |

## 逐维度补充说明

### bash 健壮性（问题 1）
- 逐行确认：所有 `$(...)` 命令替换均有 `|| echo ""` 或结构性保护（`if cmd; then` 而非裸 `&&` 链式），`set -euo pipefail` 语境下未发现可导致非 0/2 退出码的路径。
- 实测：空 stdin、超长 file_path（50 万字符）、file_path 含转义引号/反斜杠/`-e` 前缀/unicode `\u` 转义、payload 同时含顶层与嵌套 `file_path`、`tool_name` 字段完全缺失——均以 exit 0（PostToolUse 恒 0；PreToolUse 未设 `SPEC_DRIVER_SRC_GUARD=block` 时恒 0，设置后对命中场景 exit 2）收尾，未观察到进程崩溃或非 0/2 退出码。
- `npx prettier --write "$FILE_PATH"` 缺 `--` 分隔符（见问题清单 WARNING 2）。

### 门禁语义正确性（问题 2）
- `SPEC_DRIVER_SRC_GUARD` 值为 `1`/`true`/`BLOCK`（大写）等非精确字面量 `"block"` 时，`[ "${SPEC_DRIVER_SRC_GUARD:-}" = "block" ]` 判假，行为等价于未设置（仅 WARN，不 BLOCK）——符合"显式 opt-in 精确匹配"设计意图，非缺陷，行为可预期。
- 分支名含 `/`（如 `feature/x`）已实测：`specs/feature/x/tasks.md` 路径拼接与真实目录结构一致（create-new-feature.sh 约定分支名与目录名同构，含 `/` 时子目录天然对应），未发现路径穿越或误判。
- 分支名 `..` 等特殊字符：已实测 git 自身拒绝创建 `../evil` 等非法 ref 名（`git checkout -B '../evil'` 报错），该注入面在 git 层已被拦截，不构成本 hook 的攻击面。

### grep 降级分支等价性（问题 3）
- 见问题清单 WARNING 1、3——两处已实测确认的分歧点，均沿 fail-open 方向（漏判/功能不生效，而非误阻断/误格式化到无关文件的破坏性后果）。
- tool_name 与 file_path 键顺序颠倒：未构造出能让 grep 分支产生"误阻断"或"误格式化"后果的具体 payload（仅确认了"漏判"方向的分歧），符合 fix-report"宁可漏判也不误判"的门禁默认取向。

### 测试质量（问题 4）
- 实测确认两测试文件在 `/tmp` 独立临时目录 + `fs.mkdtempSync` + 独立 `git init` 下运行，未依赖本仓库真实 `specs/`/`.git` 状态；`node --test` 全部 20 用例本地实测通过（2.97s）。
- FAKEBIN 软链工艺：测试自带 `locateCommand()` 通过遍历 `PATH` 目录调用 `fs.accessSync`/`fs.statSync` 定位真实二进制，不依赖 shell alias/function（本次审查过程中笔者在临时手工复现脚本时因用 `which`/`command -v` 误把 shell 别名当命令路径而产生假阳性分歧，恰好印证测试文件这一设计选择的必要性——若两测试文件也踩了同类坑，会产生假绿；实测确认测试文件的 `locateCommand()` 实现正确避开了此陷阱）。
- 未发现"脚本提前 fail-open 时测试仍会假绿"的区分度问题：post-format 用例 #1/#3/#8 均以 `assert.deepEqual(res.npxCalls, [...])` 断言精确触发到 npx 调用（而非仅断言 exit 0），能有效区分"配置门槛正确放行到 npx"与"提前 fail-open 未到达 npx"两种情形。
- npx 桩 marker 文件：`marker = path.join(cwd, '.npx-invocations-${Math.random()...}.log')` 每次调用生成随机文件名，测试用例间无共享路径，无并发写入冲突风险（且 node:test 默认单文件内串行执行 it 块）。

### 一致性与遗留（问题 5）
- 与 `stop-fix-compliance-check.sh` 的 fail-open 哲学一致：异常/字段缺失/命令不可用一律放行，仅显式信号（`SPEC_DRIVER_SRC_GUARD=block`、CLI exit 2）才阻断。
- 未发现调试残留（`set -x`、`echo DEBUG`、注释掉的代码块、`TODO`/`FIXME`）。
- 两脚本权限确认 `755`（`-rwxr-xr-x`），shebang `#!/usr/bin/env bash` 保留。
- `release-contract.yaml` version bump `4.4.0 → 4.4.1` 符合 SemVer patch 语义（fix 无 breaking change、无新 feature）；`npm run release:check` 实测通过；`plugin.json`/`.codex-plugin/plugin.json`/`marketplace.json` 已通过 `release:sync` 同步（`git diff --stat` 确认三处各 1 行变更，非手改）。

## 总体质量评级

**GOOD**

评级依据：零 CRITICAL，WARNING 4 个（均为 fail-open 方向的边缘分歧/防御性加固建议，非阻断级安全漏洞或数据丢失风险），INFO 2 个。核心修复（嵌套取值、判定收窄、安全默认、prettier 门槛）逻辑正确且已通过 20 个新增单测 + 本次独立对抗性实测双重验证；发现的分歧均限定在"jq 缺失的降级环境 + 罕见 payload 形状"交叉场景，不影响本仓库及绝大多数标准 harness 的实际运行路径。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 4 个
- INFO: 2 个
