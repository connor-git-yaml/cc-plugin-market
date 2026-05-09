# Feature 156 — Quality Checklist

## A. Functional Requirements 质量

- A1: PASS — 31 条 FR 均为"系统应执行 X 操作"形式，可独立写测试用例（如 FR-23 给出了精确 grep 命令）
- A2: PASS — 每条 FR 均标注主体：系统（大多数）/ `spectra index` 命令（FR-11/12/13/30）/ git hook（FR-15/16）
- A3: PASS — 无"合理处理""适当响应"等不可证伪表述；所有 FR 均有具体条件或命令作为判据
- A4: PASS — YAGNI 表格明确区分 MUST / SHOULD / MAY；FR-14/15/16 明确为可选，其余均为必须

## B. Acceptance Criteria 可证伪性

- B1: PASS — AC-1~11 全部带数字（< 30 秒、= 0、≥ 3155、≥ 11）或具体命令（grep、jq、vitest）
- B2: PARTIAL — FR-7（caller expansion 深度）、FR-8（合并后 hash 更新完整性）在 AC 中未明确对应验证项；FR-14（进度输出格式）有 FR 无 AC（SHOULD 级别可接受）
- B3: PARTIAL — AC-1/2a/2b 指定了项目名和文件类型，但未指定测试机型 / CPU 规格，在 CI vs 本地差异下"< 30 秒"可能不稳定
- B4: PASS — AC-8 明确测试命令路径 `tests/unit/knowledge-graph/persistence.test.ts` 等

## C. Edge Cases 完备

- C1: PASS — EC-8（corruption）、EC-9（rename/delete）、EC-10（shallow clone）、EC-11（跨 worktree）全部覆盖
- C2: PASS — EC-1（caller 数量过大扇出）、EC-2（watch 无 git context）覆盖增量边界；EC-5 覆盖 UnifiedGraph 节点过滤边界
- C3: PASS — EC-6 明确说明 Python import resolution 限制，依赖 dependency-cruiser 的 TS/JS import 边由 ts-extractor 接管（FR-28）

## D. Scope 清晰

- D1: PASS — 3.1 in-scope 文件清单粒度到文件名，含新增 / 修改 / 删除三类
- D2: PASS — NG-1~7 显式列出 sqlite / 跨 repo / schema 冻结 / call-resolver 冻结 / watch 命令不动
- D3: PASS — 4 周时间盒 + 拆分触发条件明确，无超出 scope 的承诺

## E. Risk 可缓解

- E1: PASS — 风险 A 给出 5 步具体缓解操作，含 fallback（incremental 推迟为 Feature 153）
- E2: PASS — 风险 B/C 有具体缓解方向（单测 AC-8 + 对比验证 AC-3a/3b）
- E3: PASS — Milestone 时间盒含出口条件和拆分触发条件

## F. Spec 写作规范

- F1: PASS — frontmatter 全英文 key（feature_id、status、created 等）
- F2: PARTIAL — spec 使用 [AUTO-RESOLVED] 标注但未用规范约定的 [推断] 或 [INFERRED] 标记；虽语义清晰，形式上与规则不符
- F3: PASS — SnapshotWrapper schema 以伪代码块展示结构，未泄露 Zod schema 字段细节或函数签名
- F4: PASS — 无跨 spec 引用（parent_feature 在 frontmatter 中以相对 ID 引用）

---

## 总分

- PASS：15 / 18
- PARTIAL：3 / 18（B2、B3、F2）
- FAIL：0 / 18

## 阻断项（FAIL）

无 FAIL 项，无阻断。

### PARTIAL 项修复建议（可带条件进入 GATE_DESIGN）

- **B2**：建议在 AC 列表末尾补一条 FR → AC trace 映射注释，或在 plan 阶段确认 FR-7/FR-8 的验收入口（可并入 AC-3a/3b 说明）
- **B3**：建议 AC-1/2a/2b 补注"以 baseline host 机型（macOS M-series + 16 GB）为准"，避免 CI 硬件差异导致误判
- **F2**：建议将 `[AUTO-RESOLVED]` 统一替换为 `[INFERRED]` + 一句决议理由，符合 `.claude/rules/specs.md` 规范

## 总体评估

- **是否可以进入 GATE_DESIGN 用户审核？yes-with-conditions**
- 条件：PARTIAL 项 B2/B3/F2 建议在 plan 阶段一并修订，不阻断 GATE_DESIGN 审核进行
