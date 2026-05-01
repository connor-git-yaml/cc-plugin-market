# 修复任务清单 — Feature 148

## T1: 引入阈值常量

- 在 `src/core/single-spec-orchestrator.ts` 顶部（imports 之后，函数定义之前）添加：
  - `FILE_DETAIL_LIMIT = 12`
  - `DATA_DETAIL_LIMIT = 20`
  - `MEMBER_DETAIL_LIMIT = 30`
- 提供 JSDoc 说明阈值含义和触发条件

## T2: 改造 `generateAstInterfaceDefinition`

文件：`src/core/single-spec-orchestrator.ts:735-782`

- 按 `exports.length` 倒序排序，文件名次序作 tiebreaker
- 详细展开 Top `FILE_DETAIL_LIMIT` 文件（保持现有渲染逻辑）
- 剩余文件渲染为单一折叠表格：标题「### 其他 N 个文件（共 M 导出）」 + 文件名/导出数/前 3 个符号缩略
- 单类成员展开应用 `MEMBER_DETAIL_LIMIT`：超过则截断 + 「\*另 N 个成员省略\*」

## T3: 改造 `generateAstDataStructures`

文件：`src/core/single-spec-orchestrator.ts:792-886`

- 按 `members.length` 倒序排序，无 members 的 type/enum 排在最后；同分时文件名+符号名稳定排序
- 详细展开 Top `DATA_DETAIL_LIMIT` 数据结构（保持现有渲染逻辑）
- 剩余数据结构渲染为折叠表格：标题「#### 其他数据结构（共 N 个）」 + 名称/类型/文件/成员数
- 字段表与方法表分别应用 `MEMBER_DETAIL_LIMIT`

## T4: 新增单元测试

文件：`tests/unit/single-spec-orchestrator.test.ts`

- T4.1: 接口定义触发文件折叠（构造 15 文件 → Top 12 + 3 折叠）
- T4.2: 接口定义触发成员截断（35 成员 class → 30 + 截断提示）
- T4.3: 接口定义未触发阈值（5 文件保持现状）
- T4.4: 数据结构触发数据折叠（25 数据结构 → Top 20 + 5 折叠）
- T4.5: 数据结构触发成员截断（35 字段 interface → 30 + 截断提示）
- T4.6: 数据结构未触发阈值（5 数据结构保持现状）
- T4.7: 排序稳定性（同导出数文件按 fileName 升序）

## T5: 运行单测验证

```bash
npx vitest run tests/unit/single-spec-orchestrator.test.ts
```

- 旧 7 个用例必须保持绿（向后兼容性）
- 新 7 个用例必须绿
- 总计 14 个测试零失败

## T6: 类型检查 + 构建

```bash
npm run lint     # tsc --noEmit
npm run build    # tsc
```

零错误。

## T7: 全量单测

```bash
npx vitest run
```

零失败。

## T8: repo:check

```bash
npm run repo:check
```

通过同步链路验证。

## T9: Codex 对抗审查（commit 前必跑）

按 CLAUDE.local.md 要求，启动 `codex:codex-rescue` 子代理执行对抗性审查：
- 输入：T1-T3 的代码改动 diff
- 输出：critical / warning / info 三档结论
- 真实 bug → 修复后重跑测试
- 风格偏好 → commit message 备注

## T10: 行数验证（端到端 sanity check）

由于 baseline:collect 需要消耗 LLM 调用（约 ~$6, ~10 min for self-dogfood），fix 阶段不强制重跑。改用 stub 验证：

- 构造 122 文件的 mock skeleton（模拟 panoramic 规模）
- 调用 `generateAstInterfaceDefinition` 后统计输出行数
- 调用 `generateAstDataStructures` 后统计输出行数
- 累加 + 模拟其他章节估算（~700 行）→ 总行数 ≤ 1500

可作为 T4 用例之一（命名 `T4.8: 大规模 mock 行数预算`），不单独跑 baseline:collect。

## T11: 提交

按 CLAUDE.md 提交规范，单 commit：
- title: `fix(panoramic): cap AST interface/data dump in module spec.md`
- body: 包含 panoramic 12468 → ~1300 行的实证数据 + 阈值常量说明 + 测试新增数量
- Co-Authored-By: Claude
