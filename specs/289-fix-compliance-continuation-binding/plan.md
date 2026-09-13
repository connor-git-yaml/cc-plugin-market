# F289 plan（Tier 2 续做合同）

## 架构落点（对应 spec §5）

| FR | 落点 | 要点 |
|---|---|---|
| FR-001 两级互斥 | `fix-compliance-judge.mjs` `evaluate`：`isFix === false` 分支内评估 `detectTier2Binding`，命中才继续；未命中走既有非 fix 早退（方言诊断不变） | `isFix` 判据不动；Tier 1 路径逐字不变（judge-cli / card-a / card-b 零翻转） |
| FR-002 (a) | `core.detectFixSkillExpansion` 同趟记 `latestResumeLineIndex / latestResumeTimestamp`；judge 以其为锚跑 `resolveFeatureDirCandidate` | 无提名 ⇒ 不绑定（feature / story 续做零判定） |
| FR-003 (b) | judge：`collectArtifactWriteWitnessDirs(entries, -1, projectRoot)`（会话起点） | 多目录取最晚见证；只认 Write / Edit / 带写指示符 Bash + 成功回执 |
| FR-004 (c) 检测 | `hooks/subagent-stop-fix-marker.sh`（薄壳，恒 exit 0 零输出）→ `scripts/lib/fix-compliance-sidechain-marker.mjs`（形状守卫 / 单趟 / 20MB / 标记 / selfdiag） | 与 `post-tool-use-ledger.sh` 同纪律；不做在途判定（T-2） |
| FR-005 (c) 执法 | `io.listSidechainMarkers` 只读本会话标记；`resetBlockState` 不删 | 标记键 = session + agent |
| FR-006 Tier 2 合同 | `core.judgeCompliance({ tier2 })` 只跳过 `delegation:implement` | `DEFERRABLE_MISSING_KEYS` 不动（T3-U3 钉） |
| FR-007 路由复用 | Tier 2 走同一 `routeBlockEnforcement`；**有效锚点**（Tier 2 = 绑定源锚点）喂给闸门三 / 反馈计数 / 提名 / 见证 / 委派 / 执行记录 / 在途 / 指纹分量 | 解决与 F288 放行佐证的接缝：`latestFixLineIndex` 为 null 时佐证恒 0 ⇒ 无界阻断 |
| FR-008 可观测性 | `JUDGE_DIAGNOSTICS` +3 码（不可见）；审计事件 `tier`；report 模式 `tier / tier2Source`；schema enum + `tier` 字段 | T0-U2/U3/U5 守卫兼容（可见面集合不变） |
| FR-009 分发 | `hooks.json` SubagentStop；脚本登记 `CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES`（不进 OWNED） | Codex generator 过滤；F283 归属测试按登记表剔除 |
| FR-010 诚实登记 | judge JSDoc + CLI 合同文档新节 | 残余：标记可 rm / 拆会话逃 implement / 截断清零 |
| FR-011 性能 | CLI 单趟（源码守卫 D2）；`MAX_TRANSCRIPT_BYTES` 上限 | 真实 sidechain 分位数由 verify 实测 |
| FR-012 Codex | 不分发；形状守卫静默 | — |

## 取舍

- **有效锚点而不是修改各消费函数**：把 `anchor` 替换成 `effective`（Tier 1 = fix 基线；Tier 2 = 绑定锚点）一处解决全部窗口，不给九个消费点各加分支。
- **标记不删**：合规后同会话再次 Stop 仍 Tier 2 评估（fail-closed）；删标记的正确时机是新会话（session_id 变）。
- **Claude 独有而非 owned**：Codex 无 `agent_transcript_path` 语义，分发过去只会静默空转。
- **共享 `readStdinSync`**：judge 的 EAGAIN 安全读取下沉到 io，SubagentStop CLI 复用（`cat | node` 同形态）。

## 回归护栏

- Tier 1：judge-cli 全量 + card-a 20 + card-b 22 零翻转；F240 基线五列逐字不变。
- 分发：codex-hooks 五套 vitest + F283 派生测试；`repo:check`。
- 新增 16 用例（单元 5 / (a) 3 / (b) 3 / (c) 3 / Tier 1 不变 + 源码守卫 2）。
