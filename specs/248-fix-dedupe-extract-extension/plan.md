
# 修复实施计划：收敛重复的"取扩展名"私有实现

**Branch**: `248-fix-dedupe-extract-extension` | **Date**: 2026-08-03 | **Mode**: fix
**Input**: `specs/248-fix-dedupe-extract-extension/fix-report.md`（方案 A，推荐）

## Summary

`src/panoramic/graph/source-commit.ts::extname`（L71-75）与
`src/panoramic/graph/quality/ignore-oracle.ts::extnameOf`（L117-121）是 F217
同一 commit（0f72d4a）内产生的逐字重复私有实现（`lastIndexOf('.') + slice`，
严格保留大小写、不做 dotfile/basename 特判）。本次修复新建零依赖叶子模块
`src/panoramic/graph/collector-extname.ts`，导出共享纯函数 `extractExtension`，
两处调用方改为 import 该函数并删除各自的私有实现；新增共置单测锚定全部行为
边界，防止未来"顺手优化"为 `path.extname` 静默改变语义。

本次修复范围极小（2 处调用方替换 + 1 个新模块 + 1 个新测试文件），无需
caller/impact 工具介入——两个目标函数均为模块私有 symbol（未 export），
`grep` 已确认全仓仅有本 fix-report 中列出的 2 处定义 + 2 处调用，不存在
第三方 import 或跨模块引用，改动是完全局部的等价替换。

## Codebase Reality Check（精简版，fix 模式）

| 目标文件 | 现状 | 改动量 |
|----------|------|--------|
| `src/panoramic/graph/source-commit.ts` | 224 行，无 TODO/FIXME，无超长函数 | 删 5 行私有函数 + 改 1 行 import，净减 |
| `src/panoramic/graph/quality/ignore-oracle.ts` | 约 250 行，无 TODO/FIXME，无超长函数 | 删 5 行私有函数 + 改 1 行 import，净减 |
| `src/panoramic/graph/collector-extname.ts`（新建） | 不存在 | 新增约 30 行（含 doc 注释），零 import |

两文件均远低于 500 LOC 且新增行数为负（删除多于新增），不触发前置 cleanup task 规则。

## Impact Assessment

- **影响文件数**：2 处调用方修改 + 1 个新模块 + 1 个新共置测试 = 4 个文件（含新建）
- **跨包影响**：无——全部在 `src/panoramic/graph/` 子树内（`quality/` 是其子目录）
- **数据迁移**：无——纯函数级重构，不涉及任何 schema/配置/状态文件
- **API/契约变更**：无——两个原函数均为模块私有（未 export），不出现在任何 spec 的 FR/公共 API 面；新增
  `extractExtension` 导出的是新符号，不改变任何既有导出面
- **风险等级：LOW**（影响文件 < 10，无跨包影响，无数据迁移，无公共 API 变更）

## 变更清单

### 1. 新建 `src/panoramic/graph/collector-extname.ts`

零依赖叶子模块（不 import 任何其他项目模块），导出单一纯函数：

```ts
/**
 * F248：收敛 source-commit.ts::extname 与 ignore-oracle.ts::extnameOf 的逐字重复实现。
 *
 * 严格大小写、全字符串 lastIndexOf 语义（不做 dotfile/basename 特判），
 * 与图采集器 `name.endsWith(ext)` 的精确匹配判定面对齐（详见 source-commit.ts
 * FIX-4 决策）。返回值仅用于 `Set.has()` 白名单查询——与 `path.extname` 的
 * 语义差异（dotfile → ''、仅看 basename、见下表）不是 bug，是保持"怪值不命中
 * 白名单即安全兜底"合同的必要行为，禁止替换为 path.extname：
 *
 * | 输入                  | extractExtension       | path.extname |
 * |----------------------|-------------------------|--------------|
 * | '.gitignore'          | '.gitignore'（整串）     | ''           |
 * | 'src.v2/Makefile'     | '.v2/Makefile'（目录段的点也命中）| '' |
 * | 'a.TS'                | '.TS'（保留大小写）      | '.TS'        |
 *
 * @param name 文件路径或文件名（相对/绝对均可，函数不关心路径结构，只做字符串
 *   层面的最后一个 '.' 定位）
 * @returns 从最后一个 '.'（含）到末尾的子串；不含 '.' 时返回空字符串 ''
 */
export function extractExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx);
}
```

### 2. 修改 `src/panoramic/graph/source-commit.ts`

- 删除 L70-75 私有函数 `extname`（含其上单行注释）
- 顶部 import 区新增：`import { extractExtension } from './collector-extname.js';`
- L138 调用点精确替换：`extensions.has(extname(p))` → `extensions.has(extractExtension(p))`
- 调用形态不变（仍是 `Set.has()` 查询），无需改动上下游逻辑

### 3. 修改 `src/panoramic/graph/quality/ignore-oracle.ts`

- 删除 L117-121 私有函数 `extnameOf`
- 顶部 import 区新增：`import { extractExtension } from '../collector-extname.js';`
- L125 调用点精确替换：`const ext = extnameOf(relativePath);` → `const ext = extractExtension(relativePath);`
- 调用形态不变，`ignoreDirsForPath` 其余逻辑（TSJS/PY/.java/.go 分派 + union 兜底）不动

### 4. 新建共置测试 `src/panoramic/graph/collector-extname.test.ts`

覆盖 fix-report 语义差异表的全部边界，用例清单（每条断言 `extractExtension` 的
返回值，且与"手写 lastIndexOf 语义 ≠ path.extname"形成对照，锚定行为合同）：

| # | 用例描述 | 输入 | 期望输出 |
|---|---------|------|---------|
| 1 | 普通扩展名 | `'foo.ts'` | `'.ts'` |
| 2 | 保留大小写（不归一化） | `'a.TS'` | `'.TS'`（与 `path.extname('a.TS')` 相同，但用于对照大小写不被小写化） |
| 3 | dotfile 整串命中（与 path.extname 的 `''` 形成对照） | `'.gitignore'` | `'.gitignore'`（非空，验证不做 dotfile 特判） |
| 4 | 目录段含点（全字符串搜索，与 path.extname 仅看 basename 形成对照） | `'src.v2/Makefile'` | `'.v2/Makefile'` |
| 5 | 多个点，取最后一个 | `'archive.tar.gz'` | `'.gz'` |
| 6 | 尾点 | `'file.'` | `'.'` |
| 7 | 无点 | `'Makefile'` | `''` |
| 8 | 空字符串输入 | `''` | `''` |
| 9 | 路径分隔符 + 扩展名（真实调用场景，相对路径） | `'src/panoramic/graph/source-commit.ts'` | `'.ts'` |
| 10 | 大小写混合扩展名不命中白名单场景（回归 FIX-4 合同：白名单 `Set.has()` 严格匹配） | 结合 `new Set(['.ts']).has(extractExtension('a.TS'))` | `false`（`.TS` ≠ `.ts`） |

用例 2/3/4/9/10 直接对应 fix-report「手写实现与 path.extname 的语义差异」表；
用例 5/6/7/8 补充多点/尾点/无点/空串等边界完整性，防止未来重构引入回归。

### 同步更新（不改动，仅确认）
- `source-commit.test.ts`、`ignore-oracle.test.ts` 均只测试导出面（`resolveSourceCommit`
  / `evaluateFreshness` / `getDirtySourceExtensions`；`createIgnoreOracle` /
  `GRAPH_COLLECTOR_IGNORE_DIRS`），不直接测试私有的 `extname`/`extnameOf`，
  因此**无需修改**——这两个测试文件通过公开 API 间接覆盖了 dirty 判定 /
  ignore 判定的端到端行为，只要 `extractExtension` 与原私有实现行为等价，
  这两组测试应保持全绿，作为"行为等价"的独立回归证据。

## 回归风险评估

- **行为等价性验证方式**：新函数 `extractExtension` 与两处原私有实现逐字同源
  （唯一差异是函数名与参数名），本质是纯字符串操作的搬迁，无逻辑改动 ——
  通过共置测试的 10 条用例直接锚定其行为；再通过运行现有
  `source-commit.test.ts`（覆盖 `getDirtySourceFiles` 间接路径，真实临时 git
  仓库场景）与 `ignore-oracle.test.ts`（覆盖 `ignoreDirsForPath` 间接路径）
  确认端到端行为无变化，双重覆盖。
- **是否影响现有测试**：两个现有测试文件均只测试各自模块的公开导出，不直接
  import 私有的 `extname`/`extnameOf`，因此测试代码本身**不需要修改**；
  只要迁移后行为等价，两组测试预期保持零失败。
- **潜在风险点**：
  1. import 路径写错（相对路径层级：source-commit.ts 与 collector-extname.ts
     同目录用 `./`；ignore-oracle.ts 在 `quality/` 子目录用 `../`）—— 编译期
     `npm run build` 会捕获路径错误
  2. 遗漏更新调用点导致 TS 报"未使用的导入"或"未定义的函数"—— `npm run build`
     的 TypeScript 编译会捕获
  3. 新增测试文件命名/位置若与项目共置测试惯例不一致 —— 已核实惯例（同目录
     `.test.ts`），风险可控
- **回滚成本**：极低，改动完全局部、无对外契约变化，若发现问题可直接
  `git revert` 单个 commit。

## 验证方案

按序执行，任一步失败即停止并修复后重跑：

1. `npx vitest run` —— 全量单测零失败（重点关注新增
   `collector-extname.test.ts` 全绿 + `source-commit.test.ts` /
   `ignore-oracle.test.ts` 无回归）
2. `npm run build` —— TypeScript 编译零错误（捕获 import 路径 / 未使用导入等问题）
3. `npm run repo:check` —— 仓库级同步与一致性检查零告警（确认未破坏 F217/F243
   已有的防漂移测试合同、注释互指关系）

**通过标准**：以上三步全部零失败/零错误退出码；`collector-extname.test.ts`
的 10 条用例全部通过；`source-commit.test.ts` 与 `ignore-oracle.test.ts`
测试数量与断言内容较改动前不变且全绿（证明行为等价、非"改测试迁就实现"）。

## 不做清单（继承 fix-report 范围边界）

- **不统一扩展名集合**：`TSJS_COLLECTOR_EXTENSIONS`（source-commit.ts）、
  `TSJS_EXTENSIONS`（ignore-oracle.ts）、`walkTsJsFiles` 的 `endsWith` 判定链
  保持 F243 既有的"镜像 + 注释互指 + 防漂移测试"合同不动——集合层面的运行时
  共享是独立的更大重构（涉及 batch/panoramic 域 import 方向决策），不在本
  fix 范围内
- **不触碰 `java-mapper.ts` / `call-resolver.ts` 的 `lastIndexOf('.')` 用法**：
  语义是 FQN/类名点分割，非文件扩展名提取，与本次收敛无关
- **不改动任何 `path.extname` 使用面**（27 个文件）：其 basename +
  dotfile 特判语义与本次收敛的手写严格语义不等价，混用会引入静默行为变化
- **不修改 `source-discovery.ts::walkTsJsFiles` 的 `endsWith` 六连判定**：
  它是判定面而非提取函数，且已被 F243 纳入独立的防漂移合同
- **不更新任何 spec 文档**：两个原函数均为模块私有实现细节，未出现在任何
  spec 的 FR/公共 API 契约中；`specs/243-*/` 历史制品不追改
