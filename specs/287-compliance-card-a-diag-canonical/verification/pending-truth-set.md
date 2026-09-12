# F287 卡 A · G3 人工真值集：verification-report「未回填 PENDING 节」判据的 precision / recall 双报

> F276 第 3 轮裁决 #5：用**人工真值集 + precision/recall 双报**取代「27 份语料零翻转」的恒真判据（判据本就不改判，零翻转恒成立）。
> 重算器：`pending-truth-recompute.mjs`（用 core 的 `PENDING_MARK_REGEX` / `countPendingSections` 扫全仓 187 份真实报告；`--alt` 扫召回面候选）。
> 语料：`specs/**/verification/verification-report.md` 共 **196** 份（递归扫描；首稿 187 份只扫 `specs/<数字>-*/`，漏掉 `170a~170e-*` 与嵌套 `*/impl-supplement/`——verify 子代理复核后重算，2026-09-13）。

## 1. 定义（两种口径，逐节标注）

计数单位 = **节**（markdown ATX 标题分隔块，前言算一节）。一节判「真 PENDING」的定义：

- **严格口径 S**：该节记录了一条**验证 / 验收项**在报告写就时点被显式留待日后回填（DEFERRED、MANUAL-PENDING、PENDING-user、WAIT、待补、留待裁定等），无论是否阻断。**不计**：流程闸门（等待用户授权 rebase / push / commit）、历史转移叙述（`⏸ deferred → ✅`）、实现缺陷发现（"T017 未完成"是审查结论不是延期项）、明示"非门禁要求故未执行"、子代理自述"未执行 git 写操作"。
- **宽口径 B**：S ∪ 任何**等用户 / 后续动作才能闭合**的条目（含 push 授权闸门、清理决定）。

判据（`PENDING_MARK_REGEX`）：`\bPENDING\b | (?<!等)待用户 | 待回填 | \bDEFERRED\b | ⏸(️)?`——命中 **19 份 / 42 节**（`countPendingSections` 逐份求和 = 42，与节命中数一致；首稿 15 / 34）。

## 2. 命中面逐节标注（precision）

| # | 报告 | 节 | 命中形态 | S | B |
|---|---|---|---|---|---|
| 1 | 132-reading-ux | (前言) verdict WITH DEFERRED E2E | DEFERRED | TP | TP |
| 2 | 132 | 摘要 | DEFERRED | TP | TP |
| 3 | 132 | 3. FR 24 条证据链 | DEFERRED | TP | TP |
| 4 | 132 | 4. 7 条 SC 验证状态 | DEFERRED | TP | TP |
| 5 | 132 | 5. Risk R1-R7 | DEFERRED | TP | TP |
| 6 | 132 | 6. DEFERRED 清单 | DEFERRED | TP | TP |
| 7 | 132 | 8. 未修复项盘点 | DEFERRED | TP | TP |
| 8 | 132 | 10. 最终结论 | DEFERRED | TP | TP |
| 9 | 132 | 待用户授权操作（DEFERRED 项是否本 PR 内跑实测） | DEFERRED | **FP**（裁决请求，同 #20；复审改判） | TP |
| 10 | 133-fix-postmortem-phase2 | 4. 端到端验证场景（待用户本地确认） | 待用户 | TP | TP |
| 11 | 133 | 7. 交付前 checklist（待用户授权后执行 rebase / push） | 待用户 | **FP**（流程闸门） | TP |
| 12 | 143-large-project-e2e-baseline | 7. Push 守卫（⏸ 等待用户授权再 push） | ⏸ | **FP** | TP |
| 13 | 147-competitor-evaluation-platform | 7. Push 守卫 | ⏸ | **FP** | TP |
| 14 | 158-swe-bench-lite-grounding-eval | 10. Residual Work（⏸️ 未 push，等用户决策） | ⏸️ | **FP** | TP |
| 15 | 159-feat151-baseline-snapshot | SC-5（`⏸ deferred` → `✅ verified` 转移叙述） | ⏸ | **FP**（历史叙述） | **FP** |
| 16 | 162-codex-driver-glm-judge-eval | Layer 1（[DEFERRED-TO-API-KEY-AVAILABLE]） | DEFERRED | TP | TP |
| 17 | 162 | 总体结果 | DEFERRED | TP | TP |
| 18 | 162 | 进入 Phase C 前置 | DEFERRED | TP | TP |
| 19 | 214-graph-topology-canonical-id | 遗留事项清单（GATE_VERIFY 待用户裁定项） | 待用户 | TP | TP |
| 20 | 227-fix-compliance-candidate-disk-filter | 结论（是否清理留待用户决定） | 待用户 | **FP**（清理决定非验证项） | TP |
| 21 | 237-v008-retest-gstack | SC-005（判定：⏳ 待用户） | 待用户 | **FP**（push 授权闸门，同 #11；复审改判） | TP |
| 22 | 237 | 总裁定（SC-005 如实标注"待用户"） | 待用户 | **FP**（同 #21；复审改判） | TP |
| 23 | 239-worktree-local-state | 手工验证项（MANUAL-PENDING ×2） | PENDING | TP | TP |
| 24 | 239 | 已知残留与 follow-up | PENDING | TP | TP |
| 25 | 239 | 总体结果 | PENDING | TP | TP |
| 26 | 241-graph-keepalive-kb-grounding | 1. 执行摘要 | PENDING | TP | TP |
| 27 | 241 | 2. SC 逐条判定 | PENDING | TP | TP |
| 28 | 241 | 5.1 B4 刷图决策矩阵 | PENDING | TP | TP |
| 29 | 241 | 7. MANUAL-PENDING / UNVERIFIABLE 清单 | PENDING | TP | TP |
| 30 | 241 | 9. 结论 | PENDING | TP | TP |
| 31 | 265-ship-cli-release-gate0 | 5. 最终结论（口径拍板 2 项待用户裁决） | 待用户 | **FP**（裁决请求，同 #20；复审改判） | TP |
| 32 | 274-fix-global-setup-cross-worktree-freshness | 总体结果（commit / push 待用户确认） | 待用户 | **FP**（流程闸门） | TP |
| 33 | 275-fix-codex-doctor-hook-trust | 5. SC-013 复测状态（PENDING-user） | PENDING | TP | TP |
| 34 | 275 | 7. 结论 | PENDING | TP | TP |
| 35 | 170b-fix-npm-publish-gate | npm publish 状态（待用户在 host shell 执行 npm login） | 待用户 | **FP**（发布动作待用户 = 流程闸门） | TP |
| 36 | 170c-mcp-tool-description-response | Overview（Verify host shell 部分 ⏸️ DEFERRED） | DEFERRED | TP | TP |
| 37 | 170c | SC-004 Secondary ⏸️ DEFERRED (host shell) | DEFERRED | TP | TP |
| 38 | 170c | SC-005 (e) 需 host shell 重跑 | ⏸️ | TP | TP |
| 39 | 170c | STATUS（SC-004 Secondary ⏸️ DEFERRED） | DEFERRED | TP | TP |
| 40 | 170d-driver-preference-shaping | SC 逐项结果（SC-004 ⏸️ deferred） | ⏸️ | TP | TP |

**precision**：S = 28/42 = **0.667**（42 命中 − 14 FP）；B = 39/42 = **0.929**。递归扫描补进的 6 节（#35–#40）里 5 节 S-TP、1 节流程闸门。首稿 S 写 27/34 = 0.794：误伤面复审指出 #9/#21/#22/#31 按 S 自己的排除规则（流程闸门 / 裁决请求不计）应判 FP，已改判。S 口径的 11 个 FP 中 10 个是「等用户授权 push / 裁决请求 / 清理决定」类流程闸门（对抗复审 R2-13 点名的"交付散文"在 `(?<!等)` 之外的另一形态——它们用的是 `⏸` 与「待用户授权」而非「等待用户」）；1 个是历史转移叙述。

## 3. 召回面（recall，上界估计）

召回面用替代词启发式（`未回填|未执行|需人工|待办|待补|尚未|未完成|留待|待定|待验证|待复测|未闭合|人工验证|MANUAL|WAIT`）在**无任何 PENDING 标记**的 172 份报告里筛出 42 份 / 76 节候选，逐节人工判读；未被替代词筛到的漏检不可见，故下面的 recall 是**上界**。

| 报告 | 节 | 内容 | S | B |
|---|---|---|---|---|
| 050 | 需要跟踪的非阻塞项 | FR-014 explanation 增强尚未接入 | TP | TP |
| 128 | Success Criteria | SC-006 工具就绪、CI 配置未接入 | TP | TP |
| 129 ×2 | Layer 1.5 / 风险与遗留 | 版本号 bump 留待独立 release PR | FP（范围外移交） | TP |
| 131 | AC 验证矩阵 | 10 PASS / 2 WAIT（交付后人工验证） | TP | TP |
| 201 ×2 | SC 诚实评估 / 结论 | 真实自治闭环 e2e 后验证待补 | TP | TP |
| 216 ×2 | SC 逐条 / READY-FOR-GATE | SC-003b 手工 smoke 环境恢复后补跑 | TP | TP |
| 242 ×2 | 三报告合并结论 / 总体结果 | T017 Codex 对抗审查未执行，待补后方可 READY | TP | TP |
| 252 ×3 | Task 完成度 / 覆盖率摘要 / 待办 | T015 提交前对抗审查尚未执行 | TP | TP |
| 262 ×2 | tasks 完成度 / 综合结论 | T013 commit 尚未创建（待办） | TP | TP |
| 264 | 6. 结论 | READY 附带 2 项 WARNING 待办 | TP | TP |
| 232 | 未验证项 | 未推送触发真实 CI 复核（链 D/E 明言必须真实 CI）——复审补扫「遗留 / 未验证」类标题节所得 | TP | TP |
| 259 | 未验证项 | 同上形态（复审补扫所得） | TP | TP |
| 268 | 真 CI 待证项（**pending**，小写） | 小写 `pending` 不命中 `\bPENDING\b`（大小写敏感，已知 FN 形态） | TP | TP |
| 128 | SC-004 `[E2E_DEFERRED]` | `_` 属 `\w`，`\bDEFERRED\b` 不命中（已知 FN 形态） | TP | TP |
| 232 | 本报告验证覆盖到五链为止，尚未覆盖后续追加内容 | 范围声明（等后续动作） | FP | TP |
| 其余 59 节 | — | 缺陷发现（"T017 未完成"）、非门禁未执行、历史叙述、hook 输出文本、模板说明 | FP | FP |

**recall（上界）**：S = 28/(28+19) = **0.596**（命中 TP 28 + 已找到 FN 15+4）；B = 39/(39+22) = **0.639**（FN 17+5）。首稿 0.643 / 0.660 系 #9/#21/#22/#31 改判前、且未计复审补扫所得 5 条。

**召回扫描的已知盲区（如实）**：(1) 替代词启发式没有扫「遗留 / 未验证 / 残余 / 待证」类**标题节**——未标记报告里此类节 116 个 / 正文非空 85 个，复审只抽读了 4 份即得上表 4 条 FN，FN_true 大概率更高、上界更松；(2) 已知不命中形态：`[E2E_DEFERRED]`（`_` 是 `\w`）、小写 `pending`、`MANUAL_PENDING` / `PENDING_USER`（下划线）、全角字母；(3) `pending-truth-recompute.mjs --alt` 的分节不做 fence mask（与 core 不同源），且整体跳过任何含标记的文件——命中文件内的未标记节永不可见；今天两者数字一致只因语料 0 份未闭合围栏、0 行围栏内标记。

## 4. 结论（如实）

- 判据是**纯可观测量**（不改判，T3-E3 钉住），误判成本仅为诊断噪声；本卡不为提升 P/R 扩词表（FR-031 已裁剪、R2-13 已证词表越宽超计越多）。
- 召回缺口的主体是**未打标记的延期项**（WAIT / 待补 / 尚未 / 待办）——这正是 G3(a) 把「未完项标 `PENDING` 并写明回填触发条件」写进 SKILL 的原因：约定落地后新报告的召回率应向 1 收敛，旧报告不回改。
- precision 的主要损失是 push 授权闸门被 `⏸` / 「待用户授权」命中：按严格口径是 FP，按宽口径是 TP。审计消费方读 `pendingSectionCount` 时应按 B 口径理解（"有事等人"），不要读成"验证项未回填数"。
