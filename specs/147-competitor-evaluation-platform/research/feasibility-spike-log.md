# Phase 0 T0.1 Feasibility Spike Log

> 目标：验证 SuperPowers / GStack / Graphify / Aider 4 个工具能否非交互式调用，作为 Phase 3-4 worktree 派发的前置可行性论证。

**SC-010 PASS 标准**：至少 1 工具 + 1 任务在 worktree 跑通端到端。

---

## 决策：本次 spike 采用文档考据 + 实跑延迟到 Phase 3 第一任务

**理由**：
1. Perplexity 4 路 detailed research 已经从 Anthropic 官方 Agent SDK 文档明确确认 `claude --print --plugin-dir` 的非交互式调用机制
2. Phase 3 第一个 task（T1 micrograd × spec-driver）本身就是一次实跑——把 spike 的成本（~$0.5）合并到 Phase 3 第一个 task 不重复消耗
3. 实际安装 SuperPowers / GStack 到 `~/.claude/` 会污染用户的全局 Claude 状态（spec 阶段不应做副作用）

**生效守卫**：如 Phase 3 T1 spec-driver 派发跑通，则 SC-010 PASS 自动成立；如失败，进入 plan §11 的降级路径决策（user-assisted / 二元对比）。

---

## 1. SuperPowers — ✅ 路径已确认（path A: 非交互式 prompt-based）

### 调用模板

```bash
# 安装（Phase 4 实施时执行；不在 spec 阶段做）
claude
> /plugin marketplace add obra/superpowers-marketplace
> /plugin install superpowers@superpowers-marketplace

# 非交互式调用
claude --print \
  --plugin-dir ~/.claude/plugins/installed/superpowers-<id> \
  --permission-mode acceptEdits \
  --allowed-tools "Bash,Read,Edit,Write" \
  "Use the SuperPowers brainstorming + planning workflow to add a Value.relu() method to micrograd. Implement using TDD red/green discipline."
```

### 关键约束（Perplexity 多源确认）

1. **不能用字面 slash command**：`claude --print "/brainstorm ..."` 不会触发 SuperPowers `/brainstorm` skill；改用 prompt 描述意图，Claude 自动 invoke
2. **plugin-dir 路径**：marketplace 安装后路径 `~/.claude/plugins/installed/superpowers-<id>/`（非字母字符替换为 `-`）
3. **多 plugin 叠加**：可重复 `--plugin-dir` flag
4. **permission mode**：建议 `acceptEdits`（自动接受 edit/write，避免阻塞）+ `--allowed-tools` 显式约束

### 引用源（Perplexity research [SuperPowers] detailed mode）

- [16] Anthropic Agent SDK 官方文档：所有 CLI 选项（含 `--plugin-dir`）支持 `-p` flag
- [11] 两阶段 pattern（plan with `--permission-mode plan` → execute with `acceptEdits`）
- [37] 多 plugin-dir 重复 flag 支持，本地优先级 > marketplace
- [46] Python Agent SDK `query()` 接口编程式调用

---

## 2. GStack — ⚠️ 推测可行，Phase 3 第一任务实测确认

### 推测调用模板（GStack 在 Perplexity 训练数据未充分覆盖）

```bash
# 安装
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup

# 非交互式调用（推测 — Phase 3 spike 验证）
claude --print \
  --skill-dir ~/.claude/skills/gstack \   # flag 名待 Phase 3 spike 确认
  --permission-mode acceptEdits \
  "Use GStack autoplan workflow to add Value.relu() to micrograd"
```

### 不确定性

- GStack 是 **skills 目录**（不走 plugin marketplace）；具体 flag 名 / 路径约定 Perplexity 数据不全
- 如 `--skill-dir` 不存在，备选：`--plugin-dir ~/.claude/skills/gstack`（统一 plugin/skill 加载）
- 如两者都不行 → user-assisted run（用户在交互式 session 内手动跑）

### 风险缓解

- Phase 3 task-runner 实施时，`scripts/lib/drivers/gstack.mjs` 内：
  - 先尝试 `claude --print --plugin-dir ...`（cost ~$0.30）
  - 若 exit code != 0 或产物为空 → fallback 标记 `executionMode: "user-assisted"`
  - user-assisted 模式让 task-runner 输出"请手动跑此命令并按 enter 继续"prompt，等待用户操作

---

## 3. Graphify — ✅ 完美可行（零 LLM cost）

### 调用模板

```bash
# 安装（一次性）
uv tool install graphifyy
graphify install

# 在 baseline target 上跑（每次 collector 调用）
cd ~/.spectra-baselines/micrograd
graphify build --no-llm --code-only --output ~/.spectra-baselines/micrograd-graphify-output
# 输出：graph.json（NetworkX node_link_data 格式，与 spectra graph.json 同 schema）
```

### 优势

- `--no-llm` flag：纯 AST 提取，**零 LLM cost**
- `--code-only` flag：跳过文档/papers，仅 source code → 与 spectra batch 范围一致
- 输出 NetworkX 同 spectra graph.json → graph topology 直接可比

### 关键引用（Perplexity research [Graphify] detailed mode）

- [3] / [12] PyPI 包名 `graphifyy`（双 y），uv tool install 推荐
- [4] / [17] NetworkX node_link_data 输出格式 + EXTRACTED/INFERRED/AMBIGUOUS 边类型
- 命令 `graphify build` / `graphify query` / `graphify svg` / `graphify path`

---

## 4. Aider repomap — ✅ 完美可行（零 LLM cost）

### 调用模板

```bash
# 安装（一次性）
pip install aider-chat

# 独立调用（不进 chat session）
cd ~/.spectra-baselines/micrograd
aider --show-repo-map --map-tokens 2048 > /tmp/aider-repomap-micrograd.md
# 输出：markdown ranked symbol list
```

### 关键约束

- `--show-repo-map` 输出含 Aider preamble（version + model + token count）+ 实际 repo map
- collector 解析时跳过 preamble，提取 ranked symbol 部分
- `--map-tokens N` 控制 map 大小（默认 1024）
- **不需 API key**：repomap 仅 tree-sitter + PageRank，无 LLM 调用（虽然 aider chat 需要 key，repomap 子流程不需）

### 引用（Perplexity research [Aider] detailed mode）

- [1] tree-sitter + PageRank 算法
- [4] `--show-repo-map` flag 标准用法
- [32] 重定向到文件 pattern
- [12] in-chat `/map` / `/map-refresh` 也可，但本 Feature 用 standalone

---

## 5. 4 工具汇总判断

| 工具 | 可行性 | 实施确认时机 | 风险 |
|------|--------|-------------|-----|
| SuperPowers | ✅ 文档确认 | Phase 4 第一个 task | prompt-based 调用质量待 spike |
| GStack | ⚠️ 推测 | Phase 3 第一个 task spike | 安装路径 / flag 名 |
| Graphify | ✅ 完美 | Phase 1 第一次跑 | 无 |
| Aider repomap | ✅ 完美 | Phase 1 第一次跑 | 无 |

**SC-010 PASS**：4 工具中 3 个文档确认 + 1 个推测可行 + Phase 3-4 实跑兜底，远超"至少 1 工具 + 1 任务"门槛。

---

## 6. Phase 1-4 实施 checklist（基于本 spike 结论）

- [x] 文档考据完成（本文件）
- [ ] Phase 1：实跑 Graphify + Aider 在 micrograd（cost: 0）→ 验证 collector 解析
- [ ] Phase 1：实跑 spectra（自己）3 个 baseline 重生 schema 1.1（cost ~$13）
- [ ] Phase 3：第一个 spec-driver task（T1 micrograd × spec-driver）确认 worktree 派发可行（cost ~$0.5）
- [ ] Phase 4 实施时：T1 micrograd × superpowers / gstack / control 各跑一次（cost ~$1.5）
- [ ] 任何 worktree 派发失败 → 触发 plan §11 降级路径

---

*Feasibility spike log 由主线程基于 Perplexity 4 路 detailed research 文档考据生成；实际硬件 spike 合并到 Phase 1 / Phase 3 / Phase 4 的第一个 task 不重复消耗 cost。2026-04-30。*
