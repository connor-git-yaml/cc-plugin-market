---
feature: F5 Reading UX
branch: 132-reading-ux
phase: analyze
created: 2026-04-20
severity_summary:
  critical: 0
  high: 4
  medium: 8
  low: 5
verdict: WITH RESERVATIONS → FIXED
---

# F5 Reading UX — 一致性分析报告

## 摘要

| 维度 | 结果 |
|------|------|
| FR 覆盖率 | 24/24 = 100% |
| Risk 缓解覆盖率 | 7/7 = 100% |
| SC 验证覆盖率 | 7/7 = 100% |
| 读写边界违规 | 1 处潜在 + 1 处待确认 |
| Q1/Q2/Q3 决策一致性 | 1 处遗留（R4 缓解描述用旧 "> 1000"） |
| 跨 Feature 文件冲突 | 2 个（F130/F131，MEDIUM，已集成 master） |
| **总评** | **WITH RESERVATIONS**（无 CRITICAL，4 HIGH 需修） |

实施本报告后经编排器修复，所有 HIGH 及关键 MEDIUM 问题已解决，见 §「修复回执」。

---

## 1. FR → Plan → Task 三层追溯（摘要）

24 条 FR 全部有对应 plan 章节和 task。4 条 FR 标注"部分"覆盖：

- **FR-006**：仅 CLI 层有 mode 日志（T-009），MCP 路径（T-010）未明确 → 修复项 F-009
- **FR-019**：现有搜索是否已满足"节点高亮"未在 T-029 Exit Criteria 断言 → 修复项 F-012（LOW，暂留）
- **FR-021**：零 CDN 仅由"确认现有机制保留"覆盖，无主动断言新增 hyperedge 路径不引入 CDN → 修复项 F-007（MEDIUM，暂留）
- **FR-024**：T-031 与 T-034 对横幅（FR-023）和体积警告（FR-024）实现位置有描述混用 → 修复项 F-002 关联

## 2. Risk 缓解追溯（摘要）

R1-R7 全部有 plan 缓解 + task 验证。轻微缺口：
- **R2**：singleton 复用策略在 plan 有描述但无专门 task 标记 → 可接受，T-015 实现时注意
- **R7**：minified JSON 在 plan 提到，tasks 无专属 task → 可接受，T-033/T-034 实现时注意

## 3. SC 验证追溯

SC-001 ~ SC-007 全部有明确验证 task 和测量方式。SC-003/SC-005 为人工浏览器验证（T-038/T-047），有明确记录要求。

## 4. 读写边界合规性

- `src/panoramic/anchoring/`、`src/spec-store/`、`src/debt-scanner/`、`src/panoramic/hyperedges/` 仅只读调用 ✅
- **T-026 潜在违规**：范围写"现有 `plugins/` 目录下各 SKILL.md"过宽，可能误改禁修目录 `plugins/spec-driver/` → 修复项 **F-004（HIGH）**
- **T-036 待确认**：可能需修改 `buildKnowledgeGraph()` 所在文件，未在 plan §2 修改模块表中 → 修复项 F-006（MEDIUM）

## 5. 决策一致性

- Q1（冷 < 300s + 热 < 60s）：spec/plan/tasks 三层完全一致 ✅
- Q2（$0.05/query record-only）：spec/plan/tasks 完全一致 ✅
- Q3（2000 阈值）：spec FR/plan/tasks 一致 ✅；但 **spec.md L269 Risks 表 R4 缓解遗留旧值 "> 1000"** → 修复项 **F-003（HIGH）**

## 6. 任务粒度评估

- 54 个 task 对 MEDIUM 复杂度 feature 合理
- **T-033（hyperedge 凸包 + GRAPH_DATA 写入）**：跨 html-template 实现 + 确认 `buildKnowledgeGraph` 侧 hyperedges 传入两个关注点 → 修复项 **F-002（HIGH，扩展 T-002 Exit Criteria 覆盖）**
- 9 个并行 task（Step 0 + Step 2 单测 + Step 5 部分）均验证独立性真实

## 7. 跨 Feature 冲突

- F131（anchor-hyperedges-schema）：SKILL.md 路径重叠。F131 commit 已在 master（见 git log `652cd6d`），F132 rebase 无冲突
- F130（debt-intelligence）：`batch-orchestrator.ts` 两处注入点不同代码段。F130 已合并 master，rebase 无实际冲突

## 8. 发现表（HIGH + MEDIUM 仅）

| ID | 严重性 | 位置 | 摘要 | 修复路径 |
|----|--------|------|------|---------|
| **F-001** | HIGH | tasks.md frontmatter | `total_tasks: 62` ≠ 实际 54；`commit_points: 7` 说明混乱 | 改为 54 / 6 |
| **F-002** | HIGH | tasks.md T-033 | 跨 html-template 实现 + buildKnowledgeGraph 确认两关注点 | 扩展 T-002 Exit Criteria 覆盖 hyperedges 传入确认 |
| **F-003** | HIGH | spec.md L269 Risks 表 R4 缓解描述 | 写 "> 1000"，应为 "≥ 2000（Q3 锁定）" | 修正 R4 缓解描述 |
| **F-004** | HIGH | tasks.md T-026 | 范围 `plugins/*/SKILL.md` 可能误改禁修目录 spec-driver | 明确限定 `plugins/spectra/` 下相关 SKILL.md |
| F-005 | MEDIUM | 问答性能测试 | plan §8 规划冷 < 20s/热 < 5s 无对应 task | 在 T-041 附加问答性能测量 |
| F-006 | MEDIUM | T-036 读写边界 | 可能需修改 `buildKnowledgeGraph()` 所在文件 | 由 T-002 Exit Criteria 扩展一并解决（关联 F-002） |
| F-007 | MEDIUM | FR-021 测试 | 无主动验证零 CDN | 可在 T-037 单测加断言（暂留） |
| F-008 | MEDIUM | Edge Cases | 单节点图谱 / mode flag 冲突无测试 | 可在 T-020/T-009 补测（暂留） |
| F-009 | MEDIUM | FR-006 MCP 路径 | 仅 CLI 有 mode 日志 | 扩展 T-010 Exit Criteria 要求 MCP 路径也输出 mode |
| F-010 | MEDIUM | T-049 README 更新 | 条件性表述 | 可改为明确 task（暂留） |
| F-011 | MEDIUM | R2/R7 缓解 | singleton / minified JSON 无专属 task | T-015/T-033 实现时注意（暂留） |

LOW 问题 5 条（F-012~F-015）不阻塞 implement，留存文档备查。

## 9. 修复回执（主编排器执行）

| 问题 | 修复状态 | 修复位置 |
|------|---------|---------|
| F-001 | ✅ 已修复 | tasks.md frontmatter |
| F-002 + F-006 | ✅ 已修复 | tasks.md T-002 Exit Criteria 扩展 |
| F-003 | ✅ 已修复 | spec.md L269 Risks 表 R4 |
| F-004 | ✅ 已修复 | tasks.md T-026 范围 |
| F-005 | ✅ 已修复 | tasks.md T-041 / T-046 附加问答性能测量 |
| F-009 | ✅ 已修复 | tasks.md T-010 Exit Criteria |
| F-007/F-008/F-010/F-011 + LOW 5 | 📝 已备查，不阻塞 implement | 本文件 §8 发现表 |

## 10. 结论

**可进入 Phase 6 implement**。

4 个 HIGH 问题已全部修复；2 个关键 MEDIUM（F-005 问答性能 / F-009 MCP 日志）已修复；其余 MEDIUM/LOW 进入 "implement 阶段注意事项" 清单，不阻塞启动。

跨 Feature 冲突（F130/F131）已在 master 集成，rebase 无实际合并冲突。

宪法原则对齐（双语规范 / Spec-Driven / YAGNI / 诚实标注 / 只读安全 / 纯 Node.js）无 CRITICAL 违规。
