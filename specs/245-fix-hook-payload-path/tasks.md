# 修复任务清单：hooks payload 嵌套取值缺陷（方案 A）

**Feature**: 245-fix-hook-payload-path
**模式**: fix
**依据**: `specs/245-fix-hook-payload-path/fix-report.md`、`specs/245-fix-hook-payload-path/plan.md`

---

- [x] T001 重写 `plugins/spec-driver/hooks/pre-tool-use-guard.sh`
  - 目标文件：`plugins/spec-driver/hooks/pre-tool-use-guard.sh`
  - 变更内容（对应 plan.md 变更清单第 1 项）：
    - jq 分支取值改为 `.tool_input.file_path // .file_path // empty`
    - grep 降级分支先抓 `tool_name`，`case` 判定非 `Edit|Write|MultiEdit` 直接 `exit 0`
    - 活跃判定从全仓 `specs/*/tasks.md` 扫描收窄为 `specs/$(git branch --show-current)/tasks.md`；分支为空或目录/文件不存在 → `exit 0`
    - 阻断分支：命中未完成任务时始终 `echo "[PreToolUse WARN] ..." >&2`；仅 `SPEC_DRIVER_SRC_GUARD=block` 时追加 `[PreToolUse BLOCKED]` 并 `exit 2`，否则跌落 `exit 0`
    - 全文变量引用加双引号；`echo "$INPUT"` 改 `printf '%s' "$INPUT"`
    - 保留 `set -euo pipefail`、shebang、755 可执行位；`if cmd; then ...; fi` 结构替代 `&&` 链式判断
  - 验收判据：`bash -n plugins/spec-driver/hooks/pre-tool-use-guard.sh` 语法自检通过；人工核对脚本内不再存在顶层 `.file_path` 单独取值路径

- [x] T002 重写 `plugins/spec-driver/hooks/post-tool-use-format.sh`
  - 目标文件：`plugins/spec-driver/hooks/post-tool-use-format.sh`
  - 变更内容（对应 plan.md 变更清单第 2 项）：
    - 取值修复同 T001（jq `.tool_input.file_path //` + grep 分支先判 `tool_name`）
    - JS/TS/JSON 扩展名分支后新增 prettier 配置探测门槛：`.prettierrc*`、`prettier.config.{js,cjs,mjs}`、`package.json` 内 `"prettier"` 字段任一命中才继续，否则 `exit 0` 跳过 `npx prettier`
    - 全文 `printf '%s' "$INPUT"` 替换 `echo`，变量引用加双引号
    - 保留 `set -euo pipefail`、shebang、755 可执行位、既有 `[ -f "$FILE_PATH" ]` 判断
  - 验收判据：`bash -n plugins/spec-driver/hooks/post-tool-use-format.sh` 语法自检通过；人工核对无 prettier 配置时脚本在探测分支后必 `exit 0`

- [x] T003 [P] 新增 `plugins/spec-driver/tests/pre-tool-use-guard.test.mjs`
  - 依赖：T001（脚本行为已定型）
  - 目标文件：`plugins/spec-driver/tests/pre-tool-use-guard.test.mjs`
  - 覆盖 plan.md 测试矩阵 pre-tool-use-guard 全部 12 例（用例编号 #1-#12）：
    - #1 嵌套+src/+当前分支有未完成任务（默认）→ exit 0 + stderr 含 `WARN`
    - #2 同 #1 + `SPEC_DRIVER_SRC_GUARD=block` → exit 2 + stderr 含 `BLOCKED`
    - #3 嵌套+非 src/ 路径 → exit 0，无 stderr
    - #4 扁平兼容（顶层 file_path）→ exit 0 + WARN
    - #5 无 file_path（如 Bash/NotebookEdit payload）→ exit 0
    - #6 畸形 JSON → exit 0（fail-open）
    - #7 无 jq 降级 + Edit 工具嵌套 file_path → exit 0 + WARN（与 jq 分支等价）
    - #8 无 jq 降级 + tool_name=Bash 且 command 字符串含 `"file_path"` 文本 → exit 0（不误抓）
    - #9 当前分支无对应 spec 目录 → exit 0（fail-open）
    - #10 分支对应目录存在但 tasks.md 全部 `- [x]` → exit 0，无 WARN
    - #11 非 git 仓库/无 `.git` → exit 0（fail-open）
    - #12 detached HEAD → exit 0
  - 实现方式：node:test + `spawnSync('bash', [SCRIPT_PATH], { input, cwd: fixtureRepo })`；fixture 用 `fs.mkdtempSync` + `git init -q` + 按需 `git checkout -b <branch>` + 按需写 `specs/<branch>/tasks.md`
  - 验收判据：`node --test plugins/spec-driver/tests/pre-tool-use-guard.test.mjs` 12 例全部通过

- [x] T004 [P] 新增 `plugins/spec-driver/tests/post-tool-use-format.test.mjs`
  - 依赖：T002（脚本行为已定型）
  - 目标文件：`plugins/spec-driver/tests/post-tool-use-format.test.mjs`
  - 覆盖 plan.md 测试矩阵 post-tool-use-format 全部 8 例（用例编号 #1-#8）：
    - #1 嵌套 file_path，目标为 `.ts`，项目有 `.prettierrc` → exit 0（不断言文件内容重排）
    - #2 嵌套 file_path，无任何 prettier 配置/依赖 → exit 0，且不触发 `npx`
    - #3 扁平兼容 file_path → exit 0
    - #4 目标文件不存在于磁盘 → exit 0
    - #5 非 JS/TS/JSON 扩展名 → exit 0，跳过配置探测分支
    - #6 无 file_path / 畸形 JSON → exit 0
    - #7 无 jq 降级 + tool_name 非 Edit/Write → exit 0（门槛拦截）
    - #8 prettier 配置以 `package.json` 内 `"prettier"` 字段形式存在 → 判定为"有配置"（不断言实际 prettier 调用结果）
  - 实现方式：同 T003 的 spawn 模式；fixture 额外覆盖"待格式化文件是否存在""是否有 prettier 配置"两个维度
  - 验收判据：`node --test plugins/spec-driver/tests/post-tool-use-format.test.mjs` 8 例全部通过

- [x] T005 `contracts/release-contract.yaml` 版本 bump + sync
  - 依赖：T001、T002（修复内容确定后再定版本描述）
  - 目标文件：`contracts/release-contract.yaml`（编辑）；`plugin.json` / `marketplace.json` / `package-lock.json` / README 受控行（由 sync 脚本生成，不手改）
  - 变更内容：
    - `products.spec-driver.version: "4.4.0"` → `"4.4.1"`
    - `productMappingDescription` 前置追加一句 F245 摘要（沿用现有"vX.Y.Z（FeatureNNN）— ..."拼接惯例）
  - 执行 `npm run release:sync` 同步生成产物
  - 验收判据：`npm run release:check` 零失败；`git diff` 中 `plugin.json`/`marketplace.json`/`package-lock.json`/README 的版本行均已同步为 4.4.1，且未被手工编辑（全部来自 sync 脚本输出）

- [x] T006 提交前验证（按序执行，任一失败即停止）
  - 依赖：T001-T005 全部完成
  - 命令清单（对应 plan.md「提交前命令清单」8 步）：
    1. `bash -n plugins/spec-driver/hooks/pre-tool-use-guard.sh` && `bash -n plugins/spec-driver/hooks/post-tool-use-format.sh`（语法自检）
    2. `node --test plugins/spec-driver/tests/pre-tool-use-guard.test.mjs plugins/spec-driver/tests/post-tool-use-format.test.mjs`（新增测试单独跑）
    3. `npm run test:plugins`（确认新测试文件被自动枚举纳入，全量 `*.test.mjs` 零失败）
    4. `npx vitest run`（零失败）
    5. `npm run build`（类型检查零错误）
    6. `npm run lint`
    7. `npm run release:sync` → `npm run release:check`
    8. `npm run repo:check`
  - 验收判据：以上 8 步全部零失败退出；20 个新增用例（T003 的 12 + T004 的 8）全部通过；本仓库当前分支 `SPEC_DRIVER_SRC_GUARD` 未设置时 pre-guard 默认不阻断，post-format 因本仓库无 prettier 配置默认不触发格式化（与修复前行为一致，不产生意外 diff）

---

## FR 覆盖映射（对应 plan.md 变更清单 5 项）

| plan.md 变更项 | Task |
|---|---|
| 1. pre-tool-use-guard.sh 重写 | T001 |
| 2. post-tool-use-format.sh 重写 | T002 |
| 3. pre-tool-use-guard.test.mjs 新增（12 例） | T003 |
| 4. post-tool-use-format.test.mjs 新增（8 例） | T004 |
| 5. release-contract.yaml 版本 bump + sync | T005 |
| 提交前 8 步验证命令清单 | T006 |

## 依赖关系

T001 → T003；T002 → T004；T001+T002 → T005；T001-T005 → T006。T003 与 T004 可并行（[P]，不同文件、互不依赖）。
