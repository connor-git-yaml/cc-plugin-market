---
feature_id: "112"
title: "Fix 112 — graph.json 路径统一 + community 持久化 + budget 硬上限 + Obsidian 碰撞检测"
verification_date: "2026-04-12"
overall_result: "PASS"
---

# 验证报告 — Feature 112

## Layer 1: Spec-Code 对齐（任务完成率）

spec.md 为模板文件（未实际填写），以 tasks.md 作为需求基准。

| 任务 | 状态 | 说明 |
|------|------|------|
| T001 新建 graph-paths.ts | ✅ 已实现 | `src/panoramic/graph/graph-paths.ts` 存在，导出 `resolveGraphJsonPath` |
| T002 query.ts 使用 helper | ✅ 已实现 | checkbox 已勾选 |
| T003 export.ts 使用 helper | ✅ 已实现 | checkbox 已勾选 |
| T004 graph-tools.ts 使用 helper | ✅ 已实现 | checkbox 已勾选 |
| T005 graph-paths 单元测试 | ✅ 已实现 | `tests/panoramic/graph-paths.test.ts` 4 测试全通过 |
| T006 community.ts 持久化回写 | ✅ 已实现 | checkbox 已勾选 |
| T007 community 持久化测试 | ✅ 已实现 | `tests/panoramic/community-persist.test.ts` 3 测试全通过 |
| T008 graph-query.ts budget slice | ✅ 已实现 | checkbox 已勾选 |
| T009 budget 硬上限测试 | ✅ 已实现 | `tests/panoramic/graph-query-budget.test.ts` 3 测试全通过 |
| T010 ObsidianPage 类型扩展 | ✅ 已实现 | checkbox 已勾选 |
| T011 obsidian-exporter 碰撞检测 | ✅ 已实现 | checkbox 已勾选 |
| T012 碰撞场景测试 | ✅ 已实现 | `tests/panoramic/obsidian-collision.test.ts` 3 测试全通过 |
| T013 npm run build | ✅ 已实现 | checkbox 已勾选 |
| T014 npx vitest run | ✅ 已实现 | checkbox 已勾选 |

**覆盖率**: 100%（14/14 任务完成）

---

## Layer 1.5: 验证铁律合规

- **状态**: COMPLIANT
- 本次验证直接运行了构建命令（`npm run build`）和测试命令（`npx vitest run tests/panoramic/`），均有实际命令输出作为证据
- 构建: 零 TypeScript 错误，零编译警告
- 测试: 54 个测试文件，599 个测试，全部通过

---

## Layer 1.75: 深度检查

### index.md wikilinks 一致性（4a spec-review 发现，INFO 级）

**状态**: FIXED

**问题根因**:
- 原实现中 `buildIndexPage` 在 `generateObsidianVault` 的 L336 被调用，此时碰撞检测尚未执行（L348-363）
- `buildIndexPage` 内使用 `sanitizeFilename(godNode.label)` 生成 wikilink，而碰撞后实际文件名已追加哈希后缀
- 示例：两个 god node label 均 sanitize 为 `foo-bar`，碰撞后第二个文件变为 `foo-bar-a1b2.md`，但 index.md 仍链接到 `[[foo-bar]]`，导致链接失效

**修复方案**:
1. 在 `generateObsidianVault` 中将 god-node pages 构建和碰撞检测提前（第一阶段）
2. 从去重后的 pages 提取 `nodeId → wikilinkName`（最终文件名，不含目录前缀和 .md 扩展）映射
3. `buildIndexPage` 增加第四可选参数 `godNodeFinalNames?: Map<string, string>`
4. index.md 构建时（第二阶段）传入 `godNodeFinalNames`，确保 wikilink 与实际文件名一致
5. 无碰撞时 `godNodeFinalNames` 包含原始 sanitized 名称，行为与修复前等价

**修改文件**: `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/magical-goodall/src/panoramic/exporters/obsidian-exporter.ts`

---

## Layer 1.8: 残留扫描（二次碰撞盲区）

### 碰撞二次碰撞盲区（4b quality-review 发现，WARNING 级）

**状态**: FIXED

**问题根因**:
- 原碰撞检测（L349-363）在碰撞后生成 `newRelativePath = ${base}-${suffix}${ext}` 但未将其注册到 `seenPaths`
- 如果存在第三个 god node 与第二个产生相同的碰撞哈希后缀路径，会再次覆盖

**修复**: 在生成 `newRelativePath` 后，立即将其注册到 `seenPaths`：
```typescript
seenPaths.set(newRelativePath, page.nodeId ?? newRelativePath);
```

**测试覆盖**: `obsidian-collision.test.ts` 中的三节点同名场景（"a/b"、"a:b"、"a b"）验证了三个不同碰撞节点均生成独立文件（3/3 通过）

---

## Layer 1.9: 文档一致性

本次修复未涉及模块新增/删除/重命名，仅在现有函数内部重构执行顺序并新增一个可选参数，无文档漂移风险。

---

## 4a/4b 发现处理情况

| 发现 | 来源 | 级别 | 处理 |
|------|------|------|------|
| index.md wikilinks 失效（碰撞后链接指向不存在文件） | spec-review (4a) | INFO | **FIXED** — 重构了 `generateObsidianVault` 流程，碰撞检测提前，index.md 使用最终路径映射 |
| 碰撞检测二次碰撞盲区（碰撞后新路径未注册到 seenPaths） | quality-review (4b) | WARNING | **FIXED** — 一行修复：碰撞后新路径注册到 seenPaths |
| `budget=0` 语义分裂（query.ts 和 graph-query.ts 行为不一致） | quality-review (4b) | WARNING | **ACCEPTED** — `budget: 0` 在实际 CLI 中由 parse-args 默认为 undefined，不会传入 0；理论边界问题，不影响运行时正确性，可在后续 PR 修复 |
| 测试文件使用 `as any` | quality-review (4b) | WARNING | **ACCEPTED** — 测试代码不影响运行时正确性；属于技术债，可在后续 PR 修复 |
| `getCommunity` 内部硬编码 `_meta/graph-report.md` | quality-review (4b) | WARNING | **ACCEPTED** — 该函数读取 GRAPH_REPORT.md（非 graph.json），是独立路径，不在本次 graph.json 路径统一的修复范围内 |

---

## Layer 2: 原生工具链验证

**检测语言**: TypeScript/Node.js（package.json + tsc）

| 语言 | 构建 | Lint | 测试 |
|------|------|------|------|
| TypeScript (npm) | ✅ PASS | ⏭️ 未配置独立 lint 脚本 | ✅ PASS |

### 构建验证
- 命令: `npm run build`
- 退出码: 0
- 输出摘要: `[inline-d3] d3-force 3.0.0 已内联... tsc 零错误`

### 测试验证（Feature 112 相关）
- 命令: `npx vitest run tests/panoramic/graph-paths.test.ts tests/panoramic/graph-query-budget.test.ts tests/panoramic/obsidian-collision.test.ts tests/panoramic/community-persist.test.ts`
- 退出码: 0
- 结果: 4 个测试文件，13 个测试，全部通过

### 全量回归测试
- 命令: `npx vitest run tests/panoramic/`
- 退出码: 0
- 结果: 54 个测试文件，599 个测试，全部通过，零回归

---

## 总体结论

**结论**: ✅ PASS — READY FOR REVIEW

- 构建: ✅ PASS（TypeScript 零错误）
- 测试: ✅ PASS（599/599 通过，零失败）
- 必须修复项: 2 项均已修复（index.md wikilinks + 二次碰撞盲区）
- ACCEPTED 项: 3 项（budget=0 理论边界、as any 技术债、getCommunity 旧路径）
