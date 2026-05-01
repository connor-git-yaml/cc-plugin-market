# 修复规划 — Feature 148: panoramic spec.md 行数膨胀

> **关联**：本规划基于 [fix-report.md](./fix-report.md) 中确定的方案 A（内置规模上限 + 智能折叠）。

## 修复范围

- **唯一改动文件**：`src/core/single-spec-orchestrator.ts`（两个 AST 渲染函数）
- **测试更新**：`tests/unit/single-spec-orchestrator.test.ts`（新增 3 个用例覆盖折叠逻辑）
- **不动**：调用方、类型定义、外部 API、合同 schema

## 设计要点

### 阈值常量（在文件顶部 import 后定义）

```ts
/** 接口定义章节：详细展开的文件数上限；超过则折叠剩余文件 */
const FILE_DETAIL_LIMIT = 12;
/** 数据结构章节：详细展开的数据类型数上限；超过则折叠剩余 */
const DATA_DETAIL_LIMIT = 20;
/** 单个 class/interface 的成员数上限；超过则截断并提示 */
const MEMBER_DETAIL_LIMIT = 30;
```

阈值理由：
- `FILE_DETAIL_LIMIT = 12`：覆盖中型模块（如 batch=12 文件可全展开），大模块（panoramic=122）触发折叠
- `DATA_DETAIL_LIMIT = 20`：覆盖大多数模块的核心数据结构（一般 < 20 个 class/interface）
- `MEMBER_DETAIL_LIMIT = 30`：保留大多数类的完整成员；极端 god class 才会触发截断

### `generateAstInterfaceDefinition` 改造

**新行为**：
1. 计算每个 skeleton 的 `exports.length`（按文件维度）
2. 全部文件按 `exports.length` 倒序排序
3. 详细展开 Top `FILE_DETAIL_LIMIT` 文件（行为同现状）
4. 剩余文件折叠为单一段落：
   ```markdown
   ### 其他 N 个文件（共 M 导出）

   | 文件 | 导出数 | 主要符号 |
   |------|--------|----------|
   | foo.ts | 5 | `FooA`, `FooB`, `FooC` (+2) |
   | ...
   ```
5. 每个详细展开的 class/interface 子表格应用 `MEMBER_DETAIL_LIMIT`（截断时追加 `*另 N 个成员省略*`）

### `generateAstDataStructures` 改造

**新行为**：
1. 收集所有数据导出（已有逻辑），并按 `members.length` 倒序排序（无 members 的 type 排后）
2. 详细展开 Top `DATA_DETAIL_LIMIT` 数据结构（行为同现状）
3. 剩余数据结构折叠：
   ```markdown
   #### 其他数据结构（共 N 个）

   | 名称 | 类型 | 文件 | 成员数 |
   |------|------|------|--------|
   | `Foo` | interface | bar.ts | 5 |
   | ...
   ```
4. 每个详细展开的 class/interface 字段+方法子表格应用 `MEMBER_DETAIL_LIMIT`

### 折叠提示语言

折叠段落需明确告知读者：完整 AST 数据可在 `_meta/skeletons.json` 找到（这是 batch 的现有输出，已包含完整骨架）。

## 测试用例新增

### `generateAstInterfaceDefinition` 折叠用例

1. **触发文件折叠**：构造 15 个 skeleton（每个 1 export），验证 Top 12 详细展开 + 1 个折叠表格列出剩余 3 个文件
2. **触发成员截断**：构造 1 个含 35 个成员的 class，验证显示前 30 + "另 5 个成员省略"提示
3. **未触发阈值时行为不变**：构造 5 个 skeleton（每个 2 export），验证全部详细展开（与原行为一致）

### `generateAstDataStructures` 折叠用例

4. **触发数据结构折叠**：构造 25 个 class/interface，验证 Top 20 详细展开 + 折叠 1 个表格列出剩余 5 个
5. **触发成员截断**：构造 1 个含 35 字段的 interface，验证字段表显示前 30 + 截断提示
6. **未触发阈值时行为不变**：构造 5 个 class/interface，验证全部详细展开

### 排序稳定性

7. **导出数量相同时按文件名稳定排序**：避免不同 OS 下文件枚举顺序导致输出不稳定

## 回归风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| 现有 3+4 个用例的 skeleton 规模 < 阈值，行为应保持不变 | 低 | 阈值选取确保小规模用例完全走原路径 |
| baseline fixture 重生后行数变化导致 quality.specStructure 字段变化 | 中（预期内） | 跑 baseline:collect 后更新 fixture，diff 验证 outliers 字段消失 panoramic |
| 折叠提示语言对 LLM 解析（下游 panoramic builder）可能产生噪声 | 低 | `_meta/skeletons.json` 仍是 LLM 输入的 ground truth；spec.md 仅供人类阅读 |

## 验证方案

1. **单元测试**：`npx vitest run src/core/single-spec-orchestrator` 必须全绿（旧 7 个 + 新 7 个）
2. **类型检查**：`npm run lint` 零错误（项目用 `tsc --noEmit` 作 lint）
3. **构建**：`npm run build` 零错误
4. **行数实证**：跑 self-dogfood baseline，验证 `panoramic.spec.md` 行数 ≤ 1500
5. **章节完整性**：grep 验证 spec.md 仍包含 1-9 全部 sections + 附录
6. **repo:check**：`npm run repo:check` pass（同步链路无破坏）
7. **Codex 对抗审查**：commit 前调用 codex-rescue 子代理做对抗 review

## 提交计划

单 commit 提交：
```
fix(panoramic): cap AST interface/data dump in module spec.md

- generateAstInterfaceDefinition: top-K file detail + folded summary for the rest
- generateAstDataStructures: top-K data structure detail + folded summary
- per-class/interface MEMBER_DETAIL_LIMIT to prevent god-class explosion
- panoramic.spec.md: 12468 → ~1300 lines (within 300-700 ideal band's outer bound)
- 新增 7 个单测覆盖折叠逻辑与稳定性
```
