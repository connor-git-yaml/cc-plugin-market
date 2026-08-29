---
description: "Task list for F267 — Claude 侧 atomic-write 缺陷群修复"
---

# Tasks: F267 Claude 侧 atomic-write 缺陷群

**Input**: `specs/267-fix-atomic-write-defects/plan.md`（技术计划）、`specs/267-fix-atomic-write-defects/fix-report.md`（诊断报告，D1-D7 实测证据）
**Mode**: fix（无 User Story 分层；按缺陷编号 D1-D7 组织，严格 TDD 红先行）

## 格式说明

`[ID] [P?] 描述 + 文件路径`

- **[P]**：可并行（不同文件、无依赖）
- 每个 red 任务与对应 green 任务分离成两个独立 task
- red 任务验收判据必须是"运行后确实失败，且失败原因是被测缺陷本身"

## 不碰清单（本卡禁止修改，写入合同校验点）

- `src/hooks/git-hook-installer.ts`（P0-C 独占）
- `src/knowledge-graph/module-derivation.ts`（P0-C 独占）
- `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（G0 独占）
- `src/knowledge-graph/persistence.ts`、`src/batch/checkpoint.ts`、`src/scaffold-kb/kb-writer.ts`、`plugins/…/graph-bootstrap-status.mjs`（fix-report 已评估维持不改）

---

## Phase 0: 开工核实（阻塞性前置）

**目的**：核实 plan §6 三条开放项 + 建立"改动前真红"基线，避免后续测试是空转。

- [x] T001 核实 §6 开放项 1——`codex-runtime-doctor.test.ts` 覆盖范围
  - 动作：`Grep -n 'probeCodexPluginManifest|probeCodexCliInventory' tests/unit/codex-runtime-doctor.test.ts tests/unit/codex-runtime-doctor-cli.test.ts tests/unit/codex-runtime-doctor-redaction.test.ts`
  - 判据：确认这两个探针函数是否已在现有文件被测试覆盖；根据结果**决定**后续 T010/T011 是并入现有 `codex-runtime-doctor.test.ts` 还是新建 `tests/unit/codex-runtime-doctor-io.test.ts`——把决定写进 commit message
  - 依赖：无
  - [P] 可与 T002 并行

- [x] T002 核实 §6 开放项 2——`backupSettingsIfAbsent` 文案是否需要区分语境 [P]
  - 动作：Read `src/hooks/hook-installer.ts`，确认 install/remove 两处现有 `console.log`/`console.error` 提示文案措辞，判断是否已经存在语境相关文案（不涉及"是安装还是卸载"）
  - 判据：书面记录判定结论（倾向不区分，若发现需要区分则记录理由），供 T014 实现时采用
  - 依赖：无

- [x] T003 核实 §6 开放项 3——是否纳入子进程并发集成测试（选项 B）
  - 动作：确认本机环境是否具备稳定跑 `child_process.fork` 集成测试的条件（无需实际跑，只判断"若引入是否有明显不可控 flaky 风险"，如共享 CI runner 场景）
  - 判据：书面记录"纳入 + 放 tests/integration/"或"暂缓，只做选项 A"结论
  - 依赖：无

- [x] T004 建立改动前基线：跑 D1-D7 复现脚本确认全部复现（真红）
  - 动作：按 `specs/267-fix-atomic-write-defects/verification/repro/README.md` 步骤，在**当前未修复代码**上依次跑 `d1-d2-symlink-mode.mjs`（symlink + mode 两种参数）、`d3-concurrent-tmp.mjs`（双进程并发）、`d5-d6-hook-installer.mjs`（需先 `npm run build`）、`d7-doctor-find.mjs`（A/B 两种 config.toml）
  - 判据：D1 软链拆链复现（`isSymlink=false` 且真实文件未更新）；D2 mode 600→644；D3 出现 `WRITE-ERR ENOENT`；D5 script mode 700→755、settings 600→644；D6 `.bak` 的 `precious` 内容被顶掉、remove 后无 `.bak`；D7 config A 返回 `absent`、config B 返回 `found`（两者不一致，证明缺陷存在）
  - 依赖：无，可在 T001-T003 之前/同时跑
  - [P] 可与 T001-T003 并行

**Checkpoint**：三项开放项已定，基线复现已记录，方可进入红先行测试编写。

---

## Phase 1: 红先行测试（D1-D4，`atomic-write.ts` 维度）

**目的**：`tests/unit/atomic-write.test.ts` 补齐 inode 维度用例，改动前确认全红。

- [x] T005 删除失效用例 + 替换为 2 条新用例（不默默删除）
  - 文件：`tests/unit/atomic-write.test.ts`
  - 动作：删除现有 `.tmp 残留场景：已存在的 .tmp 文件被覆盖` 用例（固定名 tmp 假设在新实现下不成立，见 plan §4.2）；替换为：
    1. `随机 tmp 命名：同一目标连续两次写入产生不同 tmp 路径`
    2. `旧格式残留 .tmp（无 pid/random 后缀）不影响新写入`——断言目标文件内容正确 **且** 旧残留 `${filePath}.tmp` 依然存在
  - 判据：在 T006-T009 的实现改动**之前**运行这两条新用例，新用例 1 在当前实现下应为**假绿**（当前 tmp 名本就固定，"连续两次不同"这条会失败——即天然是红）；新用例 2 在当前实现下应为**假绿风险**（当前实现固定名会命中并覆盖旧残留，故断言"旧残留仍存在"会失败——红）。commit message 中需显式写明"删除失效用例，替换为 2 条语义准确的新用例"，不允许无痕迹删除
  - 依赖：T001-T004 完成

- [x] T006 [P] 红先行：D1 软链跟随用例
  - 文件：`tests/unit/atomic-write.test.ts`
  - 动作：新增用例 `软链目标：写入后软链仍是软链，且真实文件收到更新`——预置 `real.json` + `link.json → real.json` 软链，`writeAtomicJson(linkPath, data)`，断言 `fs.lstatSync(linkPath).isSymbolicLink() === true` 且 `fs.realpathSync(linkPath) === realPath` 且真实文件内容 `=== data`
  - 判据：在当前（未修复）`src/utils/atomic-write.ts` 上运行该用例，确认失败——失败原因是 `isSymbolicLink()` 变为 `false`（软链被 rename 替换），不是语法/import 错误
  - 依赖：T004（基线已建立）；可与 T007/T008/T009 并行（同文件但不同 `it` 块，逻辑独立）

- [x] T007 [P] 红先行：D2 mode 保全用例（两条）
  - 文件：`tests/unit/atomic-write.test.ts`
  - 动作：新增 `已存在文件 mode 0600：写入后仍是 0600`（卡面硬约束点名用例）与 `新建文件默认 mode 0600`
  - 判据：当前实现上运行，前者失败原因是 `mode & 0o777 === 0o644`（被放宽，非 0600）；后者若当前实现已恰好产出非 0600（如系统 umask 导致的 0644），同样应失败于 mode 值不匹配，非语法错误
  - 依赖：T004；与 T006/T008/T009 并行

- [x] T008 [P] 红先行：D3 并发互截用例
  - 文件：`tests/unit/atomic-write.test.ts`
  - 动作：按 plan §4.3 选项 A 实现——mock/spy `Math.random()` 或直接正则断言连续两次调用产生的 tmp 文件名匹配 `\.tmp\.\d+\.[a-z0-9]{8}$` 且互不相同，并断言两次写入均产出正确最终内容
  - 判据：当前实现（固定 tmp 名 `${filePath}.tmp`）上运行，断言"tmp 路径互不相同"失败（当前实现两次产生同一路径），失败原因是路径值相等而非断言语法错误
  - 依赖：T004；与 T006/T007/T009 并行

- [x] T009 [P] 红先行：D4 失败不清理用例
  - 文件：`tests/unit/atomic-write.test.ts`
  - 动作：新增 `tmp 创建失败时不留残留文件`——制造真实失败（如目标所在目录设为只读，或 mock `renameSync` 抛错），断言异常抛出后 `glob(dir + '/*.tmp.*')` 为空
  - 判据：当前实现（无 try/catch 清理逻辑）上运行，确认异常抛出后仍能找到残留 tmp 文件（或该断言路径因当前实现缺少清理分支而失败），失败原因是残留文件确实存在，非测试代码本身报错
  - 依赖：T004；与 T006/T007/T008 并行

**Checkpoint**：T005-T009 全部红先行用例在当前代码上跑过一遍并记录为真红，方可动 `atomic-write.ts` 源码。

---

## Phase 2: 实现（D1-D4，`atomic-write.ts`）

- [x] T010 实现 `writeAtomicJson` 合同扩展（收 D1-D4）
  - 文件：`src/utils/atomic-write.ts`
  - 动作：按 plan §1.1 实现 `resolveWriteTarget`（软链跟随）、`readTargetMode`（mode 快照，含 setuid/setgid/sticky）、随机 tmp 命名 + `wx` flag、`chmodSync` 精确还原（失败 `console.warn` 降级，不阻断）、失败路径 `rmSync(tmp,{force:true})` 后重抛。签名维持 `writeAtomicJson(filePath: string, data: unknown): void` 不变，**不引入 diagnostics 参数**（plan §2.2 裁决），**不加尾换行**（fix-report 序列化面裁决），**不给 `mkdirSync` 加 `mode: 0o700`**（plan §2.5 裁决）
  - 判据：`npx vitest run tests/unit/atomic-write.test.ts` 全绿，含 T005-T009 新增的全部用例（D1 软链跟随 / D2 mode 保全×2 / D3 并发互截 / D4 失败清理 / 替换后的 2 条 tmp 命名用例）
  - 依赖：T005-T009（红先行用例已确认真红）

- [x] T011 [P] 选项 B 并发集成测试（若 T003 结论为"纳入"）
  - 文件：`tests/integration/atomic-write-concurrent.test.ts`（新建，具体文件名可视 T003 结论调整）
  - 动作：仅当 T003 裁决为"纳入"时执行——用 `child_process.fork` 起两个真实子进程各写同一目标 N 轮，断言最终文件是两次 payload 之一的**完整**内容（不能断言具体是哪一方获胜，只能断言不出现混合/截断/ENOENT）
  - 判据：跑通且无 ENOENT / 内容截断；若观察到不可控 flaky（CI 环境子进程调度差异），按 plan §4.3 退回选项 A only，删除本测试文件并在 commit message 注明退回理由
  - 依赖：T010（实现已完成，用于验证真实并发场景）；若 T003 结论为"暂缓"，本任务标记为跳过（skip，非失败）

---

## Phase 3: 红先行测试（D5-D6，`hook-installer.ts`）

- [x] T012 [P] 红先行：D5 脚本 chmod 保全用例
  - 文件：`tests/unit/hook-installer.test.ts`
  - 动作：新增 `重复安装：已存在脚本的自定义 mode 0700 被保全，不被放宽为 0755`——先 `installClaudeHook`，`chmodSync(scriptPath, 0o700)`，触发第二次脚本重写路径（重复安装或先卸载再装），断言 mode 仍 `0700`
  - 判据：当前实现（L148 无条件 `chmodSync(scriptPath, 0o755)`）上运行，确认失败于 mode 值变为 0755，非测试代码语法错误
  - 依赖：T004；与 T013 并行（同文件不同 `it` 块）

- [x] T013 [P] 红先行：D6 `.bak` 保留最早 + remove 对称备份（两条用例）
  - 文件：`tests/unit/hook-installer.test.ts`
  - 动作：新增 `.bak 已存在时不覆盖，保留最早内容`（预置 `.bak` 内容 A，触发 `installClaudeHook` 写入新 settings B，断言 `.bak` 内容仍是 A）与 `removeClaudeHook 卸载路径也创建 .bak`（安装后卸载，断言 `.bak` 存在）
  - 判据：当前实现上运行，前者失败于 `.bak` 内容变成 B（被顶掉）；后者失败于卸载后 `.bak` 不存在（`removeClaudeHook` 当前零备份）
  - 依赖：T004；与 T012 并行

**Checkpoint**：T012-T013 红先行确认真红后方可动 `hook-installer.ts` 源码。

---

## Phase 4: 实现（D5-D6，`hook-installer.ts`）

- [x] T014 实现 `hook-installer.ts` 三处改动（收 D5、D6）
  - 文件：`src/hooks/hook-installer.ts`
  - 动作：
    1. 脚本 chmod 改为"写入前 `existsSync` 判定已存在性 → 保全原 mode；仅新建给默认 0o755"（plan §1.2 改动 A）
    2. `.bak` 加 `copyFileSync(..., fs.constants.COPYFILE_EXCL)`，`EEXIST` 视为正常路径（`console.log` 提示保留最早备份），非 `EEXIST` 照常抛出（plan §1.2 改动 B）
    3. `removeClaudeHook` 对称加备份逻辑，提取共享私有函数 `backupSettingsIfAbsent(settingsPath: string): void`（install/remove 两处调用），文案是否区分语境按 T002 结论执行（plan §1.2 改动 C + §4.4）
  - 判据：`npx vitest run tests/unit/hook-installer.test.ts` 全绿，含 T012-T013 新增用例及既有的"chmod +x""幂等安装"等用例
  - 依赖：T012-T013（红先行已确认真红）、T002（文案裁决已定）

---

## Phase 5: 红先行测试（D7，`codex-runtime-doctor-io.mjs`）

- [x] T015 [P] 红先行：D7-a plugin-manifest 畸形段屏蔽用例
  - 文件：按 T001 裁决结果，写入 `tests/unit/codex-runtime-doctor.test.ts` 或新建 `tests/unit/codex-runtime-doctor-io.test.ts`
  - 动作：新增 `畸形段（无 marketplace）在合法段之前时，探针仍返回 found`——构造 `config.toml`：先放一个无 `@market` 的同名段（`enabled=true`），后放合法 `[plugins."spec-driver@cc-plugin-market"]`（`enabled=true`），断言 `probeCodexPluginManifest` 返回 `outcome: 'found'` 且 `activeInstallPath` 非空
  - 判据：当前实现（L416 `.find` 首匹配）上运行，确认失败于返回 `outcome: 'absent'`（畸形段命中后提前终止搜索），非语法错误。可参考 `verification/repro/d7-doctor-find.mjs` 的构造手法
  - 依赖：T001（已确认覆盖现状及文件归属）、T004；与 T016 并行

- [x] T016 [P] 红先行：D7-b cli-inventory 对称用例
  - 文件：同 T015
  - 动作：新增 `版本不可解析的条目在合法条目之前时，探针仍返回 found`——构造 `codex plugin list --json` 输出：先放同名条目但 `version` 不可解析，后放同名条目 `version` 合法，断言 `probeCodexCliInventory` 返回 `found` 且 `semver` 正确
  - 判据：当前实现（L516 同模式 `.find`）上运行，确认失败于返回 `absent`，非语法错误。此用例是卡面硬约束点名的"两处是否对称处理"测试证据，即使 L416/L516 实现形态不对称（plan §1.3 已裁决），测试断言目标必须对称覆盖
  - 依赖：T001、T004；与 T015 并行

**Checkpoint**：T015-T016 红先行确认真红后方可动 `codex-runtime-doctor-io.mjs`。

---

## Phase 6: 实现（D7，`codex-runtime-doctor-io.mjs`）

- [x] T017 实现两处 `.find` 谓词收口（收 D7）
  - 文件：`plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`
  - 动作：
    - L416 `probeCodexPluginManifest`：可用性判据（`marketplace` 非空）折进 `.find` 谓词本身（`item.name === product && item.enabled && item.marketplace`），`if (!entry) return absent` 收窄
    - L516 `probeCodexCliInventory`：改用 `filter().map().find()` 链——先 `filter` 出名称+enabled 匹配的候选，`map` 计算一次 `normalizeVersion`，再 `find` 出 `semver !== null` 的第一条，避免对每个候选重复求值（plan §1.3 明确此处与 L416 实现形态不对称是刻意的，非遗漏）
  - 判据：`npx vitest run tests/unit/codex-runtime-doctor*.test.ts`（覆盖 T015/T016 新增用例，及原有 `codex-runtime-doctor-cli.test.ts`/`codex-runtime-doctor-redaction.test.ts` 全套）全绿；且 `.mjs` 改动后跑 `npm run repo:check` 插件同步链路零错误
  - 依赖：T015-T016（红先行已确认真红）
  - **不碰**：`plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（G0 独占，本任务只碰 `-io.mjs`）

---

## Phase 7: 5 个生产消费方回归验证

- [x] T018 回归：`atomic-write.ts` 的 3 个我方产物消费方测试套件
  - 涉及文件（只跑不改）：`tests/panoramic/cache/manifest-manager.test.ts`、`tests/panoramic/cache/integration.test.ts`、`tests/panoramic/cache/cache-manager.test.ts`、`tests/extraction/extraction-cache.test.ts`、`tests/extraction/extraction-pipeline.test.ts`、`tests/unit/graph-builder.test.ts`
  - 动作：`npx vitest run tests/panoramic/cache/manifest-manager.test.ts tests/panoramic/cache/integration.test.ts tests/panoramic/cache/cache-manager.test.ts tests/extraction/extraction-cache.test.ts tests/extraction/extraction-pipeline.test.ts tests/unit/graph-builder.test.ts`
  - 判据：全部零失败零新增 flaky；这些测试只断言内容正确不断言 mode，理论上不受"新建 mode 0644→0600"变化影响，需实跑确认无隐藏 mode 相关断言（plan §4.1 登记的已知行为变化）
  - 依赖：T010（`atomic-write.ts` 改动已完成）
  - [P] 可与 T019 并行

- [x] T019 [P] 回归：`hook-installer.ts` 的 2 个"别人的文件"消费方测试套件
  - 涉及文件（只跑不改）：`tests/unit/hook-installer.test.ts` 全套
  - 动作：`npx vitest run tests/unit/hook-installer.test.ts`
  - 判据：全部零失败，含既有"chmod +x""幂等安装"等用例及 T012-T013 新增用例
  - 依赖：T014

---

## Phase 8: 回归护栏专项复核（卡面硬约束 4）

- [x] T020 [P] `hook-installer-semantics-parity.test.ts` 波及确认
  - 文件：`tests/unit/hook-installer-semantics-parity.test.ts`（只跑，不改）
  - 动作：`npx vitest run tests/unit/hook-installer-semantics-parity.test.ts`；若有断言状态变化（如原先"Claude 侧无 mode 保全"这类合同断言因本卡改动而反转），需**逐条核对**变化是本卡预期引入的行为变化（D5 chmod 保全、D6 `.bak` EXCL 语义等），而非回归
  - 判据：全绿；若存在断言更新，commit message 需列出具体断言差异及"预期变化"理由（该文件对 Claude/Codex 两侧 installer 跑同一张语义合同表，Codex 侧行为不应受影响，仅 Claude 侧对应行应从"不保全"翻转为"保全"）
  - 依赖：T010、T014

- [x] T021 [P] F207 init gitignore 自举护栏
  - 动作：`Grep -rn 'init.*gitignore|gitignore.*self' tests/` 定位相关测试文件，跑对应测试套件
  - 判据：确认本次改动未触及（本卡不动 `.gitignore` 相关逻辑，预期零影响），实跑零失败
  - 依赖：T010、T014、T017

- [x] T022 [P] F245 hook payload 护栏
  - 动作：`Grep -rn 'payload' tests/unit/*hook*.test.ts` 定位相关断言，跑对应测试套件（或包含在 T019 已跑的 `hook-installer.test.ts` 内一并确认）
  - 判据：payload 相关断言全绿
  - 依赖：T014

- [x] T023 [P] Claude 侧 SessionStart/PreToolUse 安装流护栏
  - 动作：`Grep -rn 'installClaudeHook' tests/` 找出所有端到端安装流程测试文件，全跑一遍
  - 判据：全绿
  - 依赖：T014

---

## Phase 9: D1-D7 复现脚本翻转验证

- [x] T024 复现脚本在修复后代码上重跑，确认全部翻转
  - 动作：按 `verification/repro/README.md` 步骤，在**修复后**代码上（若 D5/D6 依赖 dist 产物需先 `npm run build`）重跑 `d1-d2-symlink-mode.mjs`（symlink + mode）、`d3-concurrent-tmp.mjs`、`d5-d6-hook-installer.mjs`、`d7-doctor-find.mjs`（A/B 两种 config）
  - 判据：D1 软链保持 + 真实文件收到更新；D2 mode 保持 600；D3 无 `WRITE-ERR ENOENT`；D5 script/settings mode 均保全；D6 `.bak` 保留最早内容 + remove 后 `.bak` 存在；D7 config A 与 B 均返回 `found`（不再因畸形段位置而分歧）
  - 依赖：T010、T014、T017 全部完成

---

## Phase 10: 全量验证与最终判据

- [x] T025 全量测试 + 构建 + repo 同步校验
  - 动作：依次执行 `npx vitest run`、`npm run build`、`npm run repo:check`
  - 判据：`npx vitest run` 零失败（不接受"新增 flaky 但整体通过"）；`npm run build` 零类型错误；`npm run repo:check` 零错误（`.mjs` 改动触发插件同步校验）
  - 依赖：T005-T024 全部完成

- [x] T026 红先行证据归档
  - 动作：整理 T005-T009、T012-T013、T015-T016 各条用例的 red→green 前后对照（transcript 或 commit message 附证据），连同 T024 的复现脚本翻转结果，一并写入最终 commit message 或 implement 阶段记录
  - 判据：10 条红先行用例（D1/D2×2/D3/D4/D5/D6×2/D7×2）+ 2 条替换用例（T005）均有"改动前红、改动后绿"的可核实记录
  - 依赖：T025

---

## FR / 缺陷覆盖映射表

| 缺陷 | 红先行 Task | 实现 Task | 回归验证 Task |
|------|-----------|----------|--------------|
| D1 软链被拆 | T006 | T010 | T018, T024 |
| D2 mode 未保全 | T007 | T010 | T018, T024 |
| D3 并发互截 | T008, T011(可选) | T010 | T018, T024 |
| D4 失败不清理 | T009 | T010 | T018, T024 |
| D5 chmod 放宽脚本 | T012 | T014 | T019, T020, T024 |
| D6 `.bak` 被顶掉 / remove 零备份 | T013 | T014 | T019, T020, T024 |
| D7 doctor-io `.find` 首匹配非首可用 | T015, T016 | T017 | T021, T024 |
| 失效用例处置（非缺陷，合同裁决） | T005 | T010 | — |

100% 覆盖：fix-report 列出的 D1-D7 全部 7 条缺陷均有对应红先行 + 实现 + 回归验证任务。

---

## Dependencies & Execution Order

### Phase 依赖关系

- Phase 0（开工核实）无依赖，T001/T002/T003/T004 互相独立可并行
- Phase 1（D1-D4 红先行）依赖 Phase 0 全部完成
- Phase 2（D1-D4 实现）依赖 Phase 1 全部红先行任务（T005-T009）完成
- Phase 3（D5-D6 红先行）依赖 Phase 0（T004）完成，**不依赖** Phase 1/2（不同文件）
- Phase 4（D5-D6 实现）依赖 Phase 3（T012-T013）+ T002
- Phase 5（D7 红先行）依赖 T001 + T004，**不依赖** Phase 1-4（不同文件）
- Phase 6（D7 实现）依赖 Phase 5（T015-T016）
- Phase 7（消费方回归）依赖对应实现 Phase 完成（T018 依赖 T010；T019 依赖 T014）
- Phase 8（护栏专项）依赖对应实现完成
- Phase 9（复现脚本翻转）依赖全部三组实现（T010、T014、T017）完成
- Phase 10（全量验证）依赖全部前序 Phase 完成

### 缺陷组间并行机会

三组缺陷（D1-D4 / D5-D6 / D7）分别落在 3 个互不重叠的文件（`atomic-write.ts` / `hook-installer.ts` / `codex-runtime-doctor-io.mjs`），Phase 1+2、Phase 3+4、Phase 5+6 三条链路可完全并行推进（各自红先行→各自实现），只在 Phase 7 起因消费方测试与全量验证汇合。

### 推荐实现策略

**按缺陷组并行**：三条独立链路（D1-D4 原子写入合同 / D5-D6 hook 安装器 / D7 doctor 探针）分别走完"红先行→实现→局部验证"，三条都完成后统一进入 Phase 7-10 消费方回归 + 护栏 + 全量验证。这是 fix 模式下风险最低、可独立验证每组缺陷是否收口的路径；不建议把三组缺陷交叉推进（会让红先行确认工作互相干扰）。

---

## 完成状态（2026-08-25 收口）

全部任务已完成并验证。对抗审查在 T0xx 之外**追加**了一批任务（软链跟随改 opt-in、
realpath 失败告警、卸载备份 best-effort、只读落点指名错误、`.bak` 可用性检查、
脚本 mode 兜底可执行 + 告警、`crypto.randomBytes`、`readTargetMode` 非普通文件回落、
两处测试断言修正），这些不在原 26 条清单里，逐条处置见 `fix-report.md`「异构对抗审查结论」节。

验收证据：`npx vitest run` 全量 531 files / 7525 tests 全绿；`npm run build` 零错误；
`npm run repo:check` exit 0；D1-D7 复现脚本全部翻转（见 `verification/repro/`）；
独立 verify 子代理 5/5 变异测试被抓住。
