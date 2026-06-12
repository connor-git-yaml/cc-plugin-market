# 验证报告 — F185 spec-driver 委派契约收口

## 验收对照（任务卡 4 项）

| 验收项 | 结果 | 证据 |
|--------|------|------|
| resume 双层 opus + 5 SKILL 委派硬约束一致（sync 注入 + check 守护）| ✅ | `repo:check` 中 `orchestrator-model-resume: pass`（plugins + .codex 双层）；`delegation-contract:skill-block-sync: pass` + `codex-wrapper-block-sync: pass` |
| orchestration.yaml fix/story 段与 SKILL 一致 + contract caveat 落档 | ✅ | fix 3→4 阶段、story 6→5 阶段；`effective-orchestration fix/story` diagnostics 无 error；contract `runtime_consumption_caveat` 已落档 |
| 故意篡改：改任一编排器 model / 删任一硬约束块 → repo:check fail | ✅ | model=sonnet → exit 1；block 漂移 → exit 1；stale .codex → exit 1；恢复后全 exit 0 |
| Codex 阶段性对抗审查 critical 全修 | ✅ | 设计阶段 Critical-1/2 + Warning-1~4 全采纳并落地（见下）；实现阶段审查见末节 |

## 回归护栏

| 护栏 | 结果 | 证据 |
|------|------|------|
| 5 SKILL 既有 phase 语义零变化 | ✅ | 仅加约束块/改 model/删 fix 旧散文/对齐 yaml 文档；流程逻辑未动 |
| repo:check 既有项全 pass + 新增断言生效 | ✅ | `status=pass`，49 → 57 项（+8：skill-block-sync / codex-wrapper-block-sync / 5×model / task-coverage）|
| .codex wrapper 再生后 spec-driver-wrappers:* 全绿 | ✅ | repo:sync 中 delegation-contract step 在 codex-wrappers 之前；wrappers 校验 pass |
| vitest + build 全绿 | ✅ | vitest 4240 passed（baseline 4237，无回归）；build EXIT 0；release:check valid |
| 单测覆盖新逻辑 | ✅ | delegation-contract.test.mjs 15 tests pass（node --test）：lib 纯函数 + 双层漂移 + stale .codex + model 断言 + task-coverage 漏网 |

## Codex 对抗审查处置

### 设计阶段（spec/plan review）
- **Critical-1（resume 锚点无法定位）**：已用显式 per-SKILL 锚点 map（resume=`## 恢复后执行流程`）+ 锚点缺失 fail-loud throw。
- **Critical-2（泛化措辞丢失 5 SKILL 阶段语义）**：已修——模板异常子句改为**defer 到各 SKILL 正文静态 inline 标注**（覆盖 implement Phase 6 Closure、story Constitution/独立验证等），并明确"运行时不得新增 inline 豁免"。
- **Warning-1（yaml「对齐」不等价）**：contract caveat `scope` 改述为"文档性摘要，无法表达复合/条件委派"。
- **Warning-2（caveat 与改 yaml 矛盾）**：caveat 明示本次仅文档展示，runtime 仅 feature 消费。
- **Warning-3（5-allowlist 漏 refactor）**：validate-orchestrator-models 加 `orchestrator-task-coverage` 守护——任何含 Task 的 SKILL 必须分类（allowlist 或 DOCUMENTED_EXCEPTIONS=refactor，注明理由），否则 fail-loud。
- **Warning-4（.codex 块校验不足）**：validateDelegationContract 加 `codex-wrapper-block-sync`，独立校验 5 个 .codex wrapper 含最新块（stale → fail）。

### 实现阶段（pre-commit review）
- 见 commit message 与本节追加（待 codex 实现审查返回后补录）。
- 主编排器已自验：fix/story diagnostics 无 error；story GATE_DESIGN 双侧列法与 runtime feature 模式 GATE_RESEARCH 双侧约定一致（非双触发 bug）；sync 双写幂等（check exit 0）。

## 工具使用反馈（dogfooding，本 feature = 用 spec-driver 修 spec-driver 的套娃）

见交付报告「工具使用反馈」节。
