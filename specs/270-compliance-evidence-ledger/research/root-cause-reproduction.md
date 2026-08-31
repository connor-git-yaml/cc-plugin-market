# F270 病根的**可复现实证**（改动前基线行为）

> 卡面 §4 P0-A 列了病根 i–v，但多数只有代码行号推理，**没有可执行的复现**。本文件用判定器自带的 `--mode report`（恒 `exit 0`、零落盘、只输出 JSON）在**本机真实二进制上**把其中两条跑成可复现事实。
> 用途：① 给 spec/plan 一个实证锚点，避免"照卡面推理动手"；② 给 verify 阶段一个**改动后必须不再复现**的对照组。

采集环境：Claude Code 2.1.220 · Node v24.14.0 · HEAD `f7a65aa9` · 判定器为 worktree 源码（非已安装快照）。

---

## R-1 🔴 病根 iv：锚点翻转 —— **两行文本即整体跳过 fix 判定**（已复现）

### 复现步骤

构造两份最小 transcript（放 `/tmp` 副本，不入库）：

**A · 只有 fix 展开**
```jsonl
{"type":"user","message":{"role":"user","content":"Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"开始修复"}]}}
```

**B · fix 展开在前，尾部再追加一条 doc 展开**（仅比 A 多最后一行）
```jsonl
{"type":"user","message":{"role":"user","content":"Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"开始修复"}]}}
{"type":"user","message":{"role":"user","content":"Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-doc"}}
```

分别喂给判定器：
```bash
printf '{"session_id":"probe","transcript_path":"<上面某份>.jsonl"}' \
  | node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report --project-root .
```

### 实测输出

| 语料 | `mode` | `fixSession` | 含义 |
|---|---|---|---|
| A（只有 fix） | `fix` | **`true`** | 正常进入 fix 判定 |
| B（fix + 尾部 doc） | `doc` | **`false`** | **整个 fix 判定被跳过** |

### 为什么这条比卡面描述的更严重

卡面把它归为「绕过面」。实测表明它**不需要任何伪造**：

- 触发它的动作是**调用另一个 spec-driver skill**——一个完全合法、日常会发生的操作（例如 fix 收尾后顺手跑一次 `/spec-driver:spec-driver-doc` 或 `spec-driver-sync`）。
- 锚点文本出现在 **user 角色**条目里（skill 展开由 harness 注入），被判方无需构造任何内容。
- 结合 **R-2**，跳过时**零落盘**——事后没有任何痕迹表明"这个会话本该被判定"。

> **定级修正**：这不只是"蓄意者可用的绕过面"，而是**疏忽即可触发的静默失效**。按必答①的威胁模型定位（本门禁防的正是"疏忽不合规"），它落在**门禁最该覆盖的区间内**，而当前实现在此区间失效。
> **对 FR 的支持**：FR-022（取最晚一次 *fix* 展开）/ FR-023（后续非 fix 展开不得导致整体跳过）由此获得实证依据，而非仅凭代码阅读。

### 改动后的验收对照（verify 阶段必须跑）

同一份语料 B 重跑，期望 `fixSession === true`（fix 展开仍在会话中，尾部的 doc 展开不得翻转判定）。语料 A 期望不变。

---

## R-2 🔴 F257 遗留的审计黑洞：**非 fix 早退零落盘**（已复现）

### 复现

用**本会话自身**的真实 transcript（story 模式，321 行 / 952KB）喂判定器：

```
{"mode":"story","fixSession":false,"enforcement":"block","configDegraded":false,
 "transcriptDiagnostics":[],"inFlightDelegations":[],"assistantEntriesSinceEarliestFix":null}
```

同时检查落盘：`.specify/runs/.fix-compliance-state/` **为空目录**，`.specify/runs/*.jsonl` 无本会话审计事件。

### 事实

判定器判定「非 fix 会话」后**静默早退**，`appendAuditEvent` 在该路径**之前**就被跳过（与 `specs/257-*/fix-report.md:7,285-291` 记载一致）。因此：

- 从这条路径出去的会话**事后完全不可见**；
- 与 **R-1** 组合，形成完整的静默失效链：**尾部展开一次非 fix skill → 判定被跳过 → 无任何落盘 → 无人会发现**。

> F257 的审查方当时提出过最小收口建议（① 曾出现 fix 锚点但最终锚点非 fix 必须落审计；② `entries.length===0` 独立诊断码），因"与当次改动不同轴"未纳入。
> **F270 与之同轴**（spec 附录 A-3 已据此建议 FR-045）。本实证把该建议从"历史备注"升级为"有复现的缺口"。

---

## R-3 附带确认：`--mode report` 的安全性符合契约

两次实证均验证：`--mode report` **恒 `exit 0`**、**零落盘**（状态目录与审计日志均无新增）。故本文件的复现步骤可安全地在任何环境重跑，**不会污染门禁状态**——这也是把它写成"可复现实证"而非"一次性观察"的前提。

---

## 未复现的病根（诚实缺席）

| 病根 | 状态 | 原因 |
|---|---|---|
| i · transcript 陈旧致假 block | **未复现** | 需要构造真实的"Stop 时 transcript 缺当前轮"时序，本机 headless（`claude --print`）因 OAuth 过期不可用。官方口径与 `research/harness-field-probe.md` §2 的构造代码支持其存在，但**本文件不声称已复现** |
| ii · 四次委派耗尽 `IN_FLIGHT_DEFER_LIMIT` | **未复现** | 同上，需完整 fix 流程的真实会话 |
| iii · GATE 暂停被当收口尝试 | **部分**：已确认判定器中**不存在**任何 GATE 识别逻辑（代码扫描 + spec 附录 A-4 取证），但"被误阻断"的端到端复现未做 |
| v · 状态竞态 | **未直接复现**，但并发前提已实证（`harness-field-probe.md` P-5：主线程与子代理 hook 交错 13 次、独立进程） |

> 这些留白**不得**在 spec/plan 中被当作已复现事实引用。
