# Phase 2 → Phase 3 移交清单

> **目的**：确保 Phase 3 从已知状态启动，不重踩 Phase 2 的教训。
> 
> **创建日期**: 2026-04-29  
> **前置**: M-101 Phase 2 ✅ Delivered, M-103 Blueprint 已定稿

---

## 一、Phase 2 已交付能力清单

以下能力在 Phase 2 实施并通过验收，Phase 3 可直接基于它们构建：

| 能力 | Feature | 状态 |
|------|---------|------|
| SpecStore 抽象（单一 spec list 消费点） | F128 | ✅ |
| sourceKind 元数据（extraction/llm/manual）| F128 | ✅ |
| `--budget` / `--dry-run` / `--mode reading/code-only` | F127/F132 | ✅ |
| tokenUsage frontmatter（input/output，含 cache 分量）| F133/F134 | ✅ |
| technical-debt.md + TODO/Open Questions 提取 | F130 | ✅ |
| graph.json schema v2.0 + hyperedges | F131 | ✅ |
| graph.html D3 交互可视化 | F132 | ✅ |
| 自然语言问答（RAG-based panoramic-query）| F132 | ✅ |
| Bundle Profiles（4 种角色视图）| F132 | ✅ |
| orchestration-overrides（项目级流程定制）| F133 | ✅ |
| 默认 model 升级到 Sonnet 4.6 | F133/F134 | ✅ |
| ADR hallucination 修复（--enable-adr 显式开关）| v4.0.1 hotfix | ✅ |

---

## 二、已知的 v4.x Patch 候选（Phase 3 并行进行）

这些问题来自集成测试，是 v4.x 的 patch 工作，**不是 Phase 3 主线**，但影响 Phase 3 Wave 2 的能力。

| # | 问题 | 严重性 | 对 Phase 3 的影响 |
|---|------|--------|-----------------|
| P0 | Python 项目 graph.json 无代码节点（Python AST 不支持）| P0 | Wave 2 的 Python 大型项目验证依赖此修复 |
| P1 | `--hyperedges` 前置条件悖论（首次运行无法使用）| P1 | 影响大项目首次 onboarding 体验 |
| P2 | technical-debt.md tokenUsage=0（Python 项目 README 被跳过）| P2 | 技术债分析在 Python 项目失效 |
| P3 | dry-run 预估偏差 65x | P3 | 成本预估参考价值低 |
| SD-B1 | orchestrator-cli 需手动 npm install | P2（SD）| 新环境 onboarding 有摩擦 |
| SD-B2 | 文档示例使用不合法枚举值（pause/error）| P1（SD）| 用户按文档配置 overrides 会静默失效 |
| SD-B3 | mode overrides 要求写全所有 phase 字段（不支持 partial）| P3（SD）| overrides 文件冗长，维护成本高 |

**处理建议**：Python AST P0 优先级最高，在 Phase 3 Wave 1 期间（前 6 周）完成修复。

---

## 三、Phase 3 启动前必须完成的前置工作

### 必须完成（硬前置）

- [ ] **M-103 Blueprint 已 commit 到 master**（本次工作的产出之一）
- [ ] **Python AST patch（v4.x）已启动**（不需完成，但需立项）
- [ ] **Phase 3 Feature Prompt 模板包含 L1/L6/L4 教训的守卫**（见下方模板要求）

### 应该完成（软前置，不阻塞 Wave 1）

- [ ] R1（M-101 遗留）：graphify 21 模块完整 reading 全量 perf 基线（30-45 分钟测量，明确 F5 SC-001 大项目性能实际表现）
- [ ] 确认 spec-driver.config.yaml 在本仓库的 model override 配置（避免 L2 教训：代码层 default 变更后没有同步 yaml）

### Phase 3 每个 Feature Prompt 模板必须包含

```markdown
## 前置守卫
git fetch origin
git checkout <feature-branch>
test -f specs/<NNN>-<name>/spec.md && echo "spec 存在" || { echo "ERROR: spec 缺失"; exit 1; }

## 每阶段结束守卫
git add specs/<NNN>-<name>/
git commit -m "docs(NNN): <phase> 产物落盘"
git push origin <feature-branch>

## 提交前守卫
npx vitest run          # 零失败
npm run build           # 类型检查零错误
npm run repo:check      # 同步检查
```

---

## 四、第一波 Feature 启动顺序

```
Week 1-2:   并行启动
  ├── Feature 143：大项目 E2E 基线测量（research，不写代码）
  └── Feature 144：E2E Fixture 测试基础设施（coding）

Week 3-5:   依赖 F143 结果
  └── Feature 145：LLM 并发优化（wait for F143 bottleneck 数据）

Week 4-6:   依赖 F144 基础
  └── Feature 146：AI Essence 输出格式（wait for F144 E2E 框架）

Week 6-8:   Phase 3 Wave 2 准备
  ├── Python AST patch 预计完成（可开始 Python 大型项目验证）
  └── 多 runtime 适配调研（Cursor/Continue/Aider，1-2 人天）
```

---

## 五、Phase 3 开发卫生约定

以下约定直接对应 Phase 2 的教训，**强制执行**：

| 约定 | 来源 | 执行方式 |
|------|------|---------|
| SC 性能指标必须含项目规模维度 | L4 | Spec Review 门禁检查 |
| 新 pipeline 改动必须有对应 E2E fixture 场景 | L6 | Feature 144 建立后，作为后续 Feature 的验收标准 |
| 每阶段产物立刻 git add + commit + push | L1 | Prompt 模板守卫 |
| 外部 SDK 字段提取必须 cover 所有子字段 | L3 | Spec 的"必须 cover 的字段"章节 |
| config 覆盖链路可见性（effective resolution 打印）| L2 | dry-run 输出包含 effective model + config source |

---

*移交清单创建于 2026-04-29。Phase 3 第一波 Feature（143-146）启动后，本清单不再需要更新（Feature 自身的 spec.md / plan.md 接管执行状态追踪）。*
