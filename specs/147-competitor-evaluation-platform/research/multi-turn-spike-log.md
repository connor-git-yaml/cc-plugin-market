# Sprint 3 Phase D — Multi-turn 实跑 Feasibility Spike Log

> **目标**：在 T2-nanogpt-cosine-lr 任务上跑真实 multi-turn `claude --print` 对比 sprint2 single-turn GLM 数据，验证 spec-driver workflow 的"commit history advantage" 卖点是否在非交互式调用下成立。
>
> **结论**：**否**。即使 `--dangerously-skip-permissions + bypassPermissions` 让 bash 命令完全开放，3 工具（control / spec-driver / spec-driver-spectra）在 multi-turn `claude --print` 调用下都 **不主动 git commit**，spec-driver workflow 的差异化优势在非交互模式下无法落地（这是 `claude --print` non-interactive 模式的固有限制，不是 spec-driver workflow 设计缺陷）。

**生成时间**：2026-05-01  
**Feature**：147 Sprint 3 Phase D  
**Cost**：~$0.15（3 × claude --print sonnet × ~$0.05）

---

## 1. 实验设置

- **任务**：T2-nanogpt-cosine-lr（在 nanoGPT/train.py 实现 cosine LR scheduler，30-100 LOC）
- **执行模式**：`claude --print --model claude-sonnet-4-6 --permission-mode bypassPermissions --dangerously-skip-permissions`
- **Worktree**：每工具独立 ephemeral worktree（`~/.spec-driver-bench-worktrees/T2-nanogpt-cosine-lr/<tool>-multiturn/`）
- **Setup**：跑 `eval-task-setup-T2-strip-cosine-lr.mjs` 把 nanoGPT@3adf61e 现有 cosine LR 删掉 → task 起始状态为"无 scheduler"
- **Oracle**：functional（AST + numerical 验证 get_lr 正确性）

---

## 2. 数据

| Tool | wall | oracle | commits | diff lines | exit |
|------|------|--------|---------|-----------|------|
| **control** | 43.5s | ✅ PASS | **0** | 17 | 0 |
| **spec-driver** | 48.8s (+12%) | ✅ PASS | **0** | 18 | 0 |
| **spec-driver-spectra** | 55.4s (+27%) | ✅ PASS | **0** | 18 | 0 |

> SuperPowers / GStack 真实 plugin 安装 follow-up（当前 `~/.claude/plugins/installed` 不存在，runner 退化为 prompt-only mode = 同 control + tool-specific 前缀）。这两个工具的 multi-turn fixture 留 follow-up。

---

## 3. 关键发现

### 3.1 `--bypass-permissions` 不让 agent 主动 commit

即使配合 `--dangerously-skip-permissions`（绕过所有 hooks）+ bypassPermissions（覆盖 file edit + bash + git），3 工具全部 commits=0。Agent 修改文件正确，但**非交互式 `--print` 模式下 sonnet 没有触发 commit 动作**。这跟模型本身的"in print-mode default behavior is single deliverable"行为一致 — agent 倾向"一次完成 + 输出 + 退出"，而不是"commit + iterate"。

**Implications**：
- spec-driver workflow 的"分阶段结构化 commit"是 plugin 在交互式 / sub-agent 模式下才能发挥的价值
- 非交互式 batch 调用（`claude --print`）→ 所有工具表现等同 control + 不同 prompt 前缀
- Sprint 1 sprint2 数据（commits=0 across all tools）和 Sprint 3 multi-turn 数据 **完全一致** — 不是 acceptEdits 限制，是 print-mode 行为

### 3.2 工作流 prompt 增加 wall time 但不改进结果

- control（裸任务 prompt）: 43.5s
- spec-driver（+ "请使用 spec-driver-fix workflow specify→plan→implement→verify"）: 48.8s（**+12%**）
- spec-driver-spectra（+ 12KB spectra context）: 55.4s（**+27%**）

**diff 行数 17 vs 18 vs 18 几乎相同**。增加的 wall time 全部花在 agent 的"思考 + 解读 spec.md"上，未转化为代码质量提升。

### 3.3 Phase C.1 grounding 结论被 multi-turn 实跑再次印证

Phase C.1 single-turn grounding 实验：spectra-control delta = 0  
Phase D multi-turn 实跑：spec-driver-spectra (含 spectra context) vs control = 同样 oracle PASS + 18 vs 17 lines + +27% wall

两份独立数据都说明：**在简单任务上，spec.md 上下文 / spec-driver workflow prompt 都不能 lift 单 turn 代码质量**。Spec.md / workflow 的真实价值仍然是：
- 人类可读性
- 模块化文档化  
- LLM agent **在交互模式 / 多 sub-agent 协作 / 长 horizon 任务**中的语义 anchor

**未测的复杂场景**：跨多个文件 + 跨 module style follow + 大型 codebase navigation。需要 follow-up Feature。

---

## 4. 真实 plugin (SuperPowers / GStack) 的 follow-up 计划

Phase D 没跑真实 plugin，因为：
1. `~/.claude/plugins/installed` 不存在（用户没装），runner `findSuperPowersDir()` 返回 null
2. SuperPowers / GStack plugin 都是给交互式 Claude Code session 设计的，**非交互式 batch 兼容性未验证**
3. 即使装了，从 §3.1 看 `claude --print` 的 commit-shy 行为是 LLM 模型层面的，不是 plugin 层面 — 真实 plugin 大概率仍不主动 commit

要测真实 plugin 的差异化价值，需要 **interactive multi-turn driver**：
- 用 stream JSON / WebSocket 模式让 agent 在 plan / build / commit 之间显式 iterate
- 或人工触发"please commit" 命令观察响应

**这超出 Sprint 3 scope，留给 Feature 148+**。

---

## 5. 数据存档

3 个 fixture：
- `tests/baseline/tasks/T2-nanogpt-cosine-lr/control-multiturn/full.json`
- `tests/baseline/tasks/T2-nanogpt-cosine-lr/spec-driver-multiturn/full.json`
- `tests/baseline/tasks/T2-nanogpt-cosine-lr/spec-driver-spectra-multiturn/full.json`

每个 fixture 含：
- `taskExecution.executionMode`: `non-interactive`
- `taskExecution.wallMs / commits / filesChanged / diffStat`
- `taskExecution.primaryOracle`: functional PASS

**没跑 jury 评分** — Phase D 是 feasibility spike，不是 quality 评估。如需，运行：
```bash
node scripts/eval-judge-jury.mjs --task T2-nanogpt-cosine-lr --tool control-multiturn
```

---

## 6. 对外结论修订建议

**1. spec-driver "Constitution Check / TDD" 强项**：
- 在 T6 violation-refusal 任务上 surface refusal vs fully complied 二元行为有差异化（auto-report §4.4.b: gstack/spec-driver/superpowers 1/1 ⭐）— **这是 sprint2 single-turn jury 已验证的真实优势**
- 但"commit history quality" 维度在非交互模式下无法验证 — **不应作为对外 differentiation 卖点**

**2. spec-driver "specify→plan→tasks→implement→verify multi-phase workflow" 价值**：
- Phase D 实跑显示在 batch 模式下 agent 不会自动多 phase 实施
- 真实价值依赖 **interactive Claude Code session + sub-agent 协作**
- 营销话术应明确"workflow 价值 in interactive mode"，避免读者误以为 batch 模式也有

**3. spec.md grounding 价值**：
- 单 turn / 多 turn 实测都显示 sonnet 4.6 在简单任务上不依赖 spec.md
- 价值定位：human readability + LLM long-horizon agent semantic anchor
- 不再宣传"spec.md = grounding lift"

---

*Phase D feasibility spike log，Sprint 3 实测数据，2026-05-01。*
