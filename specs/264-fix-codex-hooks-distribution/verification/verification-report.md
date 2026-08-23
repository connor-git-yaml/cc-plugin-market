# 验证报告 — Codex hooks 分发纠偏（卡面 F265 / 仓内编号 264）

**验证代理**：verify（Phase 4，从头重跑，上一轮因宿主机休眠 API 断连未完成）
**验证时间**：2026-08-24
**说明**：4a spec-review / 4b quality-review 两个子代理同样死于宿主机休眠，未产出报告；本报告的
[Spec 合规] 与 [代码质量] 两节按 verify 单代理口径自行覆盖，不代表独立三方复核。

---

## 1. 验收矩阵

| # | 验收项 | 命令 | 真实输出关键行 | 结论 |
|---|---|---|---|---|
| 1 | 全量单元/集成测试 | `npx vitest run` | `Test Files 531 passed \| 4 skipped (535)` / `Tests 7554 passed \| 18 skipped \| 21 todo (7593)` / `EXIT:0` | ✅ PASS |
| 2 | 构建 | `npm run build` | `tsc` 零输出（零错误）；`postbuild:stamp` 正常盖章 | ✅ PASS |
| 3 | 仓库一致性门禁 | `npm run repo:check` | 全部 check `pass`，唯一 `warn` 为已知基线噪声 `graph-quality:freshness`（图产物 stale，非本次改动引入） | ✅ PASS |
| 4 | 发布合同校验 | `npm run release:check` | `Release contract valid (contracts/release-contract.yaml)` | ✅ PASS |
| 5 | 新增单测 `codex-plugin-registration.test.ts` | 全量 vitest 输出 | `✓ tests/unit/codex-plugin-registration.test.ts (36 tests) 141ms` | ✅ PASS |
| 6 | handler 级判据回归 `codex-hooks-event-gate.test.ts` | 全量 vitest 输出 | `✓ tests/unit/codex-hooks-event-gate.test.ts (23 tests) 11ms` | ✅ PASS |
| 7 | 安装流程集成测试 | 全量 vitest 输出 | `✓ tests/integration/codex-hooks-install-flow.test.ts (57 tests) 11736ms` | ✅ PASS |
| 8 | wrapper sha256 快照 | 全量 vitest 输出 | `✓ tests/unit/spec-driver/wrapper-sha256.test.ts (9 tests) 3838ms` | ✅ PASS |
| 9 | 新增窄门禁 `codex-wrapper-runtime-namespace`（plan.md 里叫 `codex-wrapper-mcp-neutral`，实现落地时改名，见下方[Spec 合规]） | `npm run repo:check` 输出 | `spec-driver-wrappers:codex-wrapper-runtime-namespace: pass` | ✅ PASS |
| 10 | 原生安装 → hooks/list 恒 5 条 | 隔离 `$SCRATCH/codexV`，`codex plugin marketplace add` + `codex plugin add` + `codex app-server` stdio 探针 | `TOTAL: 5`，全部 `source=plugin`，`pluginId=spec-driver@cc-plugin-market` | ✅ PASS |
| 11 | 叠装合并器 → 守卫命中、hooks.json 未创建 | `bash codex-skills.sh install --global` | stderr：`[codex-hooks] 已检测到 Codex 原生插件注册（marketplace=cc-plugin-market），跳过合并写入…`；`ls $CODEX_HOME/hooks.json` → No such file；退出码 0；skills 9 个正常装 | ✅ PASS |
| 12 | 叠装后 hooks/list 仍 5 条 | 同探针 | `TOTAL: 5` 全部 `source=plugin` | ✅ PASS |
| 13 | 幂等：再叠装一次 | 同上重跑一次 | 仍 `TOTAL: 5`，退出码 0 | ✅ PASS |
| 14 | E2：`enabled=false` → 合并器正常安装 | 改 config.toml + 重探 + 装 | 改后 `hooks/list` 先验 `TOTAL: 0`；随后 `codex-skills.sh install --global` 写入成功（`[codex-hooks] 已写入…我方条目 5 个`）；再探 `TOTAL: 5` 全部 `source=user` | ✅ PASS |
| 15 | E3：`enabled` 键缺失 → 仍拦截 | 删 `enabled` 行 + 重探 + 装 | `hooks/list` 先验仍 `TOTAL: 5`（source=plugin，证明 Codex 运行时确实照常注册）；`install --global` 命中守卫，未写 hooks.json | ✅ PASS |
| 16 | `--force-hooks` 逃生口 | E3 场景下追加 `--force-hooks` | stderr 打印代价说明 `⚠️ 若 Codex 确已原生注册本插件，本次强制写入将导致同一 hook 被注册两次`；`hooks/list` → `TOTAL: 10`（5 source=user + 5 source=plugin） | ✅ PASS |
| 17 | 清理路径：历史条目 + 插件注册 → 10 条且警告点名 | 恢复 `enabled=true`，hooks.json 仍有历史 5 条 user 条目，再装 | stderr：`⚠️ 但 …/hooks.json 里仍有 5 条历史合并器条目 —— 它们与插件注册叠加，此刻就是双注册状态`；探针确认 `TOTAL: 10` | ✅ PASS |
| 18 | 清理指引生效：`remove --global` 后恒 5 | 跑 `codex-skills.sh remove --global` | stdout 逐条打印 `owned-entry-removed`（5 条）；探针确认 `TOTAL: 5` 全部 `source=plugin` | ✅ PASS |
| 19 | E1：`codex plugin remove` 后 → 合并器接管 | `codex plugin remove spec-driver@cc-plugin-market`（需带 `@marketplace`，裸插件名会报错，非本卡缺陷，Codex CLI 自身要求） | cache 与 config.toml 表同时消失（`find plugins/cache` 只剩空 `cc-plugin-market` 目录，config.toml 无 `[plugins...]` 段）；随后 `install --global` 成功写入；探针确认 `TOTAL: 5` 全部 `source=user` | ✅ PASS |

## 2. [Spec 合规]

**结论：PASS，含 2 项 WARNING（任务遗漏，非功能缺陷）。**

- 根因链、复现步骤、E1~E4 四条实测事实均在隔离 `$SCRATCH/codexV`（本机 codex-cli 0.144.6）**独立复验通过**，与 fix-report.md 描述的事实一致，未发现 over-claim。
- D1~D7 全部设计决策逐条对照代码实现：
  - D1/D2（三态 `enabled` + cache 存在性判据）：`codex-plugin-registration.mjs` 落地，且**已把安全方向从对称 AND 翻转为非对称"cache 主信号 + 唯一显式 false 豁免"**（对抗审查第一轮修订后的终态），与 fix-report 描述一致，E2E 复验（本次验证第 10-19 项）全部吻合。
  - D3/D4（退出码 4 + `--force-hooks`）：`install-codex-hooks.mjs` 与 `codex-skills.sh` 的分流逻辑与本次 E2E 观测行为完全一致。
  - D5（handler 级判据）：本次做了独立的内存变异测试（不依赖新增单测），对 canonical `hooks/hooks.json` 做两组变异：
    1. 摘掉 `stop-fix-compliance-check.sh` handler，保留 `Stop` 事件 → `ownedEvents` 仍含 `Stop`（证明事件级判据确实是盲区）+ `product-handler-missing` 命中；
    2. 把 `pre-tool-use-guard.sh` 挂到 `PostToolUse` → `product-handler-misplaced` 命中，同时联动触发 `product-event-missing`（`PreToolUse` 变空）；
    未变异的 canonical → product 层零 finding。
    三组结果与 D5 设计描述完全吻合。
  - D6（`SessionEnd` 补入 schema 全集，不入产品集）：`grep` 确认命中 `CODEX_EVENT_SCHEMA_SET`，未命中 `CODEX_EVENT_PRODUCT_SET` 定义处，注释含版本出处说明。
  - D7（`mcp__` 命名空间纠偏 + 窄门禁）：`grep -rl 'mcp__' .codex/skills plugins/spec-driver/skills-codex` 无匹配；`git diff --stat` 确认恰好 10 个文件（5+5）变化，`constitution/resume/sync/doc` 4 组零 diff；`repo:check` 含新窄门禁且 pass。
- **命名偏差（非缺陷，仅记录）**：plan.md D7 与 tasks.md T018 把新窄门禁命名为 `codex-wrapper-mcp-neutral`，实现落地时实际 check id 是 `spec-driver-wrappers:codex-wrapper-runtime-namespace`；导出的映射表实际名为 `OWNED_HOOK_EXPECTED_EVENT`（plan.md D5 写的是 `OWNED_HOOK_SCRIPT_EXPECTED_EVENT`）。两处均为纯命名差异，行为与验收标准完全达成，不构成合规问题。
- **⚠️ WARNING-1（T011 未落地）**：plan.md §3 与 tasks.md T011 均要求在 `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` 模块头补一句"全局文件仍唯一，但不是唯一注册源"的更正注释。`git diff plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` **为空**——该文件完全未被本次改动触及，仍保留"`$CODEX_HOME/hooks.json` 是 Codex 的全局唯一共享声明文件"的原始表述，未附加 F264 的作用域限定。不影响功能，但与 tasks.md 的显式验收命令（`git diff` 仅注释行变化）矛盾——该文件根本没有 diff。
- **⚠️ WARNING-2（T025 未落地）**：tasks.md T025 要求在 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-B 标注"已交付"并链接 `specs/264-fix-codex-hooks-distribution/`。`grep -n "264-fix-codex-hooks-distribution"` 在该文档**无匹配**；P0-B 小节仍是派发时的原始描述，未见任何"已交付"字样或反链。milestone 卡面因此仍会被读作"未开始"，与本次实际交付状态不符。
- **残余观察（非 WARNING，仅记录以备核实）**：`specs/213-codex-plugin-distribution/spec.md` 新增注记称"隔离 CODEX_HOME 实测（codex-cli 0.144.6 与 0.149.0）"，但该 0.149.0 口径转引自 milestone 卡面 P0-B 小节的既有事实陈述（非本次 fix-report 会话自己的实测——fix-report.md E4 明确写"本机无 0.149.0 无法复测"）。转引本身未标注来源版本差异，读者可能误以为本次修复会话验证过 0.149.0。建议后续在该注记补一句"0.149.0 口径转引自卡面既有事实，本次修复会话仅实测 0.144.6"。

## 3. [代码质量]

**结论：PASS。**

- `codex-plugin-registration.mjs`：新模块头注释详尽记录了对抗审查修订前后的判据方向变化（对称 AND→非对称主信号+唯一豁免），并诚实登记 exotic TOML 写法的已知误拒代价；`isDirectoryFollowingLinks` 的注释准确描述了它必须走 `statSync`（跟随软链）而非 `Dirent.isDirectory()`（lstat 语义）的原因，代码实现与注释描述一致（已核实函数体确用 `fs.statSync`）。
- 空 `catch {}` 审计（改动文件范围内共 2 处）：
  - `codex-plugin-registration.mjs:75`（`isDirectoryFollowingLinks`）→ 兜底返回 `false`（"无证据"），与模块头声明的"cache 侧判不出 ⇒ 没有证据 ⇒ 放行"方向一致；
  - `install-codex-hooks.mjs:146`（`countStaleMergedEntries`）→ 兜底返回 `0`，函数头注释明确声明"纯只读、绝不抛，不参与任何判定"，与实际用途（仅供提示文案计数）一致。
  两处均无"注释声称一个方向、代码实际做另一个方向"的误导。
- 新增测试非恒真断言抽样复核（3 条，逐条实跑变体核实）：
  1. `codex-plugin-registration.test.ts` 的 C1 symlink 用例：构造真实 `fs.symlinkSync` 指向真目录，断言 `registered:true`——若把 `isDirectoryFollowingLinks` 改回 `Dirent.isDirectory()`（lstat 语义）会导致该断言失败（已通过阅读实现逻辑推演验证，未在改动仓内做变异因硬约束禁止改仓内文件，改用独立内存变异验证 D5 判据代替）；
  2. `codex-hooks-event-gate.test.ts` 的 `product-handler-missing` / `product-handler-misplaced` 断言与本次独立内存变异测试（第 2 节 D5 段）结果完全吻合，非恒真；
  3. E2/E3 相关用例的期望值方向（豁免仅认显式 `false`）与本次真实 Codex 运行时复验（验收矩阵第 14/15 项）一致。
- `normalizeTomlLines` 由私有改导出：`grep` 确认函数体未变，仅新增 `export` 关键字；全仓消费方唯二（`codex-runtime-doctor-io.mjs` 自身既有两处调用 + 新增 `codex-plugin-registration.mjs`），未发现对 `codex-runtime-doctor-io.mjs` 既有 4 个消费点的行为改动；`codex-runtime-doctor*.test.ts` 全绿（71+24+14 共 109 个断言）。
- 新增 `spec-drift-repo-check-regression.test.ts` 的改动是**加固**（把新增 check id 精确钉入既有联合清单断言），非放宽既有判据。

## 4. 回归护栏逐条结论

| 护栏 | 验证方式 | 结论 |
|---|---|---|
| F262 W3 权限位保全 + 幂等 | 独立 `$SCRATCH/codexW3`（无原生插件注册，纯合并器路径），`chmod 600` 后连续 3 次 `install --global` | 三次 `stat -f %Lp` 均为 `600`；owned handler 计数三次均为 5 | ✅ PASS |
| F240 四方一致性诊断不崩溃 | `codex-runtime-doctor.mjs --format json` 退出码 0，JSON 可解析；`check-codex-inventory.mjs --format json` 退出码 3（`status:"entry-missing"`），JSON 可解析，字段完整 | 两工具均产出结构化、可解析、非崩溃的输出 | ✅ PASS |
| `codex-plugin-consistency:*` 矩阵 | `repo:check` 输出 | 全部 pass | ✅ PASS |
| `spec-driver-wrappers:*` 门（含新 `codex-wrapper-runtime-namespace`） | `repo:check` 输出 | 全部 pass | ✅ PASS |
| `codex-runtime-doctor-io.mjs` 导出零副作用 | `normalizeTomlLines` 消费方核对 + 既有 doctor 测试全绿 | 无回归 | ✅ PASS |

## 5. 残余风险与未覆盖面（诚实登记）

1. **0.149.0 无法在本机复测**：本机 codex-cli 版本固定 0.144.6。fix-report E4 已诚实登记"`SessionEnd` 在 0.144.6 被静默丢弃"；`CODEX_EVENT_SCHEMA_SET` 里 `SessionEnd` 的补入依据的是 milestone 卡面转引的 0.149.0 口径，本次修复会话与本轮验证都**没有**在 0.149.0 环境上正向复验过它会被接受。这条只有反向证据（0.144.6 上不接受），没有正向证据。
2. **exotic TOML 写法的已知误拒代价**：inline table、点分键、literal string 键、`[ plugins."x@y" ]` 段头内侧空格等合法但词法扫描器认不出的写法，会让用户拿到一次误拒（需要 `--force-hooks` 覆盖）。已在模块头注释与本轮 10 种变体单测中显式承认，不是被掩盖的缺陷，但仍是真实存在的用户体验代价。
3. **`hooks/list` 只证明"注册"，不证明"信任授予后的真实执行"**：本次全部 E2E 验证走的是 `codex app-server` 的 `hooks/list` RPC，探测到的是**注册视图**；探针跑在未信任目录下（stderr 打印"Project-local config, hooks, and exec policies are disabled…until the project is trusted"），插件级 hooks 走的是全局注册路径不受此限制（已用 `source=plugin` 条目确认注册成功），但**没有**在本轮验证中实际触发一次 hook 执行（如真实跑一次 `Stop` 事件）来确认"注册"与"执行"两件事完全对等。T062/T063 人工验证（milestone §8，需 Codex ≥0.149）仍是唯一能补这块空白的验证方式，本卡不在其验收范围内（tasks.md §8 已声明）。
4. **T011 / T025 两项任务遗漏**（见第 2 节 WARNING-1/2）：功能与测试层面均未受影响，但若严格按 tasks.md 的验收命令逐条核对，这两条会各自判 FAIL。建议提交前补齐（工作量各自 <5 分钟）。
5. **`codex plugin remove` 需要 `@marketplace` 后缀**：验证过程中裸插件名 `codex plugin remove spec-driver` 报错（`Error: plugin requires --marketplace unless passed as <plugin>@<marketplace>`），这是 Codex CLI 自身的既有行为，与本卡无关，仅记录以便后续文档/用户指引参考（README 与 fix-report 均未提及这个操作细节，不算本卡遗漏，但可作为后续小改进）。
6. **本轮验证未独立执行 4a spec-review / 4b quality-review 完整流程**（子代理已死于宿主机休眠），第 2/3 节内容为 verify 单代理口径产出，建议后续视资源情况另行补一轮独立复核。

## 6. 结论

**可以提交（READY FOR REVIEW，附带 2 项 WARNING 待办）。**

核心卡面验收（"原生安装 + 合并器叠装 → hook 恒 5 条不重复"）在真实 codex-cli 0.144.6、隔离 `CODEX_HOME` 环境下**完整逐条复验通过**，覆盖 E1/E2/E3 三态、`--force-hooks` 逃生口、幂等性、历史条目清理指引，以及 F262 W3 权限位/幂等护栏、F240 四方诊断不崩溃、handler 级判据（D5）的独立变异测试。全量测试 7554 个用例零失败、构建零错误、`repo:check`/`release:check` 全绿（唯一 warning 为已知基线噪声）。

建议提交前补齐 WARNING-1（`codex-hooks-installer.mjs` 模块头注释更正）与 WARNING-2（milestone 卡面标注已交付并反链本卡），二者均为文档/注释级遗漏，不阻塞提交但会让 tasks.md 的验收命令产生假红。

---

## 附：工具使用反馈（Dogfooding，Feature 264 T028 收尾要求）

**MCP 是否可用**：本轮验证任务性质是 Codex CLI 端到端 + 仓内测试链路验证，未涉及需要 Spectra MCP 工具（`impact`/`context`/`detect_changes`）的场景（改动面是脚本+schema+文档，非跨模块调用链分析），故本轮**未调用** Spectra MCP。

**返回信息是否够用**：不适用（未调用）。

**流程是否顺畅**：fix 模式下 verify 子代理承接 4a/4b 子代理因宿主机休眠死亡后的缺口，需要在同一份报告里额外覆盖 [Spec 合规]/[代码质量] 两节——任务本身通过 prompt 显式声明了这个降级路径（"改按下方「合并审查清单」自行覆盖"），指引清晰，未造成流程卡点。唯一的小摩擦：探针脚本 `hooks/list` 的返回结构（`result.data[].hooks[]`）与预设 `probe-hooks.mjs` pretty-print 输出格式不匹配，需要临时改成紧凑 JSON 输出并另写解析脚本——这是本轮验证工具链自身的问题，非 Spec Driver 流程问题。

**结果是否准确**：不适用（未涉及 impact/graph/fuzzy match 类工具）。

---

## 附录 · 本报告出具后的第二轮对抗修订与重新验证（主线程收口）

本报告生成时，异构对抗**第二轮（误拒面）**尚未回收。该轮抓到 2 CRITICAL + 5 WARNING，
守卫判据据此再次重写（详见 `fix-report.md`「对抗审查第二轮」节）。本附录记录修订后的重新验证。

### 判据变更摘要

从「cache 证据为主信号 + `enabled=false` 为唯一豁免」改为
「**config.toml 是注册台账（主信号）**，cache 提供"有没有东西可注册"的必要条件；
cache 目录名与 `@token` 精确匹配优先，对不上才退回聚合判断」。
根因：本机真实 `~/.codex` 实证 cache 目录名 ≠ config token（`openai-curated` vs
`openai-curated-remote`），且幽灵 cache 真实存在（5 个插件目录无对应 config 条目）。

### 两项 WARNING 已闭环

- **WARNING-1**（`codex-hooks-installer.mjs` 模块头未补前提更正）→ 已补：模块头新增
  「本文件是唯一的那一份全局文件，但**不是唯一的注册源**」一节，并说明本模块已降为
  skills-only fallback。
- **WARNING-2**（milestone 卡面未标注已交付）→ 已补：`docs/design/milestone-M10-...md`
  §4 P0-B 追加「状态（2026-08-24）：✅ 已交付 → `specs/264-fix-codex-hooks-distribution/`」，
  含验收 6 步与两条新增本机一手事实。

### 修订后重新验证（全部主线程亲自实跑）

| 验证项 | 结果 |
|---|---|
| 两轮合并的 26 条对抗构造 + 4 条 marketplace 匹配边界 | 逐条实跑**全部符合期望**（第一轮绕过面全 BLOCK，第二轮误拒面全 ALLOW） |
| 真实 codex-cli 0.144.6 隔离 CODEX_HOME 端到端（6 步） | 原生 5 条 → 叠装仍 5 条（打印判定依据路径）→ 幂等 5 条 → `enabled=false` 放行 → 历史条目叠加时点名 10 条 → **只清 hook 条目**后回 5 条且 skills 9 个保留 |
| `npx vitest run`（全量，无并发） | `Test Files 531 passed \| 4 skipped`，`Tests 7564 passed`，退出码 0 |
| `npm run build` | 零错误 |
| `npm run repo:check` | `status=warn`，唯一 warning 为既有基线噪声 `graph-quality:freshness` |
| `npm run release:check` | 通过 |

### 残余风险（在原报告基础上新增/更新）

- **行 3 判据的已知误拒代价**：用户用 exotic TOML 写法（inline table / 点分键 / literal string 键 /
  段头内侧空格）写的 `enabled = false`，或 config.toml 因别的原因提到 `spec-driver` 字样，
  会拿到一次误拒。这比第一轮的 fail-open 窄得多，且落在可见一侧（打印判定依据路径 + `--force-hooks`）。
- `product-handler-unregistered` 分支**结构性不可达**（两张表 5/5 对齐），是前瞻分支，
  **不得**算进"已验证的守护力"——已在源码注释显式标注。
- 其余（0.149.0 无法本机复测、`hooks/list` 只证注册不证 trust 授予后的执行）与原报告一致。
