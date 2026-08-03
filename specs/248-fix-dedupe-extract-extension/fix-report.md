# 问题修复报告

## 问题描述

F243 quality-review 发现仓库存在多份行为等价的"取扩展名"实现（保留原始大小写的 `lastIndexOf('.') + slice` 提取），建议收敛到共享纯函数。原始报告称有三处并指定落点 `src/collector-surface.ts`，经本次诊断对实仓核实后修正（见下方"原始报告与实仓的偏差核实"）。

## 原始报告与实仓的偏差核实

原始发现按 memory/转录转述，落点与清单需对实仓核实（F205 教训：prompt 自带事实也可能错）。逐项核实结果：

| 原始声明 | 实仓核实结果 |
|----------|-------------|
| `src/panoramic/graph/source-commit.ts::extname`（F217 遗留） | ✅ 存在，L71-75，`lastIndexOf('.') + slice`，引入于 0f72d4a (F217) |
| `src/panoramic/graph/quality/ignore-oracle.ts::extnameOf`（F217 遗留） | ✅ 存在，L117-121，与上者逐字等价（仅参数名不同），同引入于 0f72d4a (F217) |
| `src/batch/stages/source-discovery.ts::fileExtension`（F243 新增） | ❌ **不存在**。walkTsJsFiles 用 `name.endsWith('.ts') \|\| ...` 六连字面判定（L516-521），无提取函数；F243 只是往 endsWith 链加了 `.mjs`/`.cjs` |
| 落点 `src/collector-surface.ts`（F243 建立的采集面 SSoT 叶子模块，含 surfaceHasExtension） | ❌ **不存在**。F243 实际采用"四处同源同步 + 注释互指 + 防漂移测试"方案（SSoT 锚点是 `source-commit.ts::TSJS_COLLECTOR_EXTENSIONS`），未建独立 SSoT 模块 |
| `tests/unit/collector-surface.test.ts` AST oracle（FR-019/SC-015 约束） | ❌ **不存在**，无此约束 |

**结论**：真实收敛面为 **2 处逐字重复**（我已亲自逐字对比确认等价），核心诉求（消除重复、建共享纯函数）成立；落点需按实仓结构重新选择。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何同一 3 行函数存在两份拷贝？ | F217（0f72d4a）同一 commit 内，source-commit.ts 与 ignore-oracle.ts 两个模块各自内联实现（`extname` / `extnameOf`），未抽共享 |
| Why 2 | 为何同 feature 内各自内联？ | 3 行微函数低于"抽共享"的直觉阈值；两模块职责不同（freshness 判定 vs ignore 分派），实现时被当作各自的实现细节 |
| Why 3 | 为何事后长期未被发现？ | 两函数均为模块私有（未导出）且异名（extname vs extnameOf），全仓符号搜索面上不可见；重复只在逐行对比时暴露 |
| Why 4 | 为何直到 F243 才暴露？ | F243 在两文件同步加 .mjs/.cjs 时，quality-review 首次把两处扩展名相关实现并排对比 |
| Why 5 | 为何未被机制捕获？ | 仓库无重复代码检测门禁（jscpd 类）；3 行片段低于多数 clone 检测阈值；语义等价但字面异名，只能靠人审 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: 微函数（3 行）在同 feature 不同模块中被各自内联为私有异名实现，重复对符号搜索不可见，且无自动化重复检测兜底。
**Root Cause Chain**: 两份逐字拷贝 → 同 commit 各自内联 → 微函数低于抽共享阈值 → 私有+异名不可见 → 无重复检测门禁。

## 影响范围扫描

全仓 `lastIndexOf('.')` 模式共 7 处命中 + `extname` 关键字 29 文件，逐一分类：

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| src/panoramic/graph/source-commit.ts | L71-75 `extname` | `lastIndexOf('.') + slice`，严格大小写（FIX-4 注释合同） | 删除私有实现，改 import 共享函数 |
| src/panoramic/graph/quality/ignore-oracle.ts | L117-121 `extnameOf` | 同上，逐字等价 | 删除私有实现，改 import 共享函数 |

### 类似模式（已评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| src/core/query-mappers/java-mapper.ts | L542, L892 | `lastIndexOf('.')` | [安全] Java FQN/import path 点分割，非文件扩展名语义 |
| src/knowledge-graph/call-resolver.ts | L573, L577, L651 | `lastIndexOf('.')` | [安全] caller context 方法/类名点分割，非文件扩展名语义 |
| src/core/single-spec-orchestrator.ts | L773 | `replace(/\.[^.]+$/, '')` | [安全] basename 去扩展名生成显示名，语义不同（basename 域 + 去除方向） |
| src/panoramic/builders/component-view-builder.ts | L617 | `replace(/\.[^/.]+$/, '')` | [安全] 同上 |
| src/batch/stages/source-discovery.ts | L516-521 | `endsWith` 六连字面判定 | [安全] 判定面而非提取函数；F243 已建注释互指 + 防漂移测试合同，收敛扩展名**集合**属更大重构，超出本 fix 范围（见"范围边界"） |
| 27 个文件 | — | `path.extname`（node:path） | [安全] basename + dotfile 特判语义，与手写严格语义**不等价**，不属收敛面 |

### 手写实现与 path.extname 的语义差异（收敛时必须保持的行为合同）

| 输入 | 手写 lastIndexOf 语义 | path.extname | 差异后果 |
|------|----------------------|--------------|----------|
| `'.gitignore'` | `'.gitignore'`（整串） | `''`（dotfile 特判） | 手写值不命中扩展名白名单 → 走兜底，行为安全 |
| `'src.v2/Makefile'` | `'.v2/Makefile'`（全字符串搜索，目录段的点也命中） | `''`（仅看 basename） | 同上，怪值不命中白名单 → 兜底安全 |
| `'a.TS'` | `'.TS'`（保留大小写） | `'.TS'` | 两处调用方依赖严格大小写与生产者 `endsWith` 判定面对齐（source-commit FIX-4 明确合同：生产者不收 `.TS`，freshness 也不应把它算 dirty） |

两处调用场景返回值只用于 `Set.has()` 白名单查询，非常规返回值不命中白名单即走兜底——该"怪值安全"性质是现有行为合同的一部分。**因此收敛必须逐字保持 lastIndexOf 语义，禁止"顺手优化"为 path.extname**。此边界须写入共享函数 doc 注释并用测试锚定。

**因果修正（Codex 对抗审查 W2，commit 前已修）**：上表前两行（dotfile、目录段含点）在两种实现下**都不命中**白名单——返回值虽异、调用方分支不变，不构成换用 path.extname 的行为分歧。真正会改变调用方分支的是形如 `'.ts'` 的纯 dotfile 文件名：手写实现返回 `'.ts'` 命中 TSJS 白名单，`path.extname('.ts')` 的 dotfile 特判返回 `''` 走兜底；且生产者 walkTsJsFiles 对文件不做 dotfile 跳过（`'.ts'.endsWith('.ts')` 为 true 会正常采集），"命中"才是与生产者对齐的正确行为。共享函数 doc 与测试用例 11 已按此锚定。

**范围宣称修正（Codex 对抗审查 W1，commit 前已修）**：本函数镜像的判定面限定为 **TSJS/PY collector**（walkTsJsFiles / walkPyFiles 的 `endsWith` 严格大小写语义）；generic collector（Java/Go，generic-language-skeleton-collector.ts::walkFiles L86）实际用 `path.extname(name).toLowerCase()` 判定（大小写不敏感、dotfile 特判），与 endsWith 面存在**预存**不一致——F248 未扩大该缺口，也不在本次收敛范围内修复（见下方残留登记）。

### 残留登记（F248 范围外，候选后续 fix）
- **generic collector 与 freshness/ignore 判定面的大小写不一致（预存）**：Java/Go collector 用 `path.extname().toLowerCase()` 会接纳 `.JAVA`/`.GO` 大写扩展名文件入图，但 `getDirtySourceFiles`（严格大小写 extractExtension + getDirtySourceExtensions 小写集合）不会把这类文件计入 dirty 判定、ignore-oracle 也不会将其分派到 java/go 忽略集合——freshness 对这类文件的改动会漏报 dirty。source-commit.ts::getDirtySourceExtensions 上方的 FIX-4 历史注释（L48-53）对 generic collector 的 endsWith 宣称与实现不符，属同一预存失真，一并留待后续 fix 统一修正（修法需二选一：generic collector 改 endsWith 严格匹配，或 freshness/ignore 面对 Java/Go 扩展做大小写归一，两侧必须同向）。

### 同步更新清单
- 调用方: source-commit.ts L138（`extensions.has(extname(p))`）、ignore-oracle.ts L125（`extnameOf(relativePath)`）——仅改函数引用，调用形态不变
- 测试: 新增共享模块共置单测（锚定 dotfile/目录段/大小写/多点/尾点/无点边界）；现有 source-commit.test.ts / ignore-oracle.test.ts 经导出面测试，无需改动
- 文档: source-commit.ts L70 的 FIX-4 单行注释语义迁入共享函数 doc；无 spec 更新需要（两函数均为私有实现细节，不在任何 spec 公共 API 面）

## 修复策略

### 方案 A（推荐）：src/panoramic/graph/ 下新建零依赖叶子模块
新建 `src/panoramic/graph/collector-extname.ts`，导出 `extractExtension(name: string): string` 纯函数（零 import，贴合原始建议"SSoT 叶子 + 纯函数"精神）：
- source-commit.ts 改 `import { extractExtension } from './collector-extname.js'`
- ignore-oracle.ts 改 `import { extractExtension } from '../collector-extname.js'`
- doc 注释写明：严格大小写 + 全字符串 lastIndexOf 语义，服务图采集面与生产者 `endsWith` 判定对齐场景；与 `path.extname` 的 dotfile/basename 语义差异及"怪值不命中白名单即兜底"合同
- 共置 `collector-extname.test.ts` 锚定全部语义边界
- 落点理由：两消费方最近公共目录；域绑定使误用面小于 src/utils/（该函数语义反直觉，通用场景应用 path.extname）；batch 域未来消费也有先例（generic-language-skeleton-collector.ts 已 import panoramic/graph/quality/ 模块）

### 方案 B（备选）：从 ignore-oracle.ts 导出共享
ignore-oracle 定位本就是"共享判定 oracle"，导出 extnameOf 供 source-commit import。缺点：freshness 模块依赖 quality/ 子域方向不清晰；"ignore oracle"模块名与"extname 提取"职责不对口；文件级 I/O 说明（模块头声明"非零 I/O 纯函数"）与纯函数混放。

**选 A**。

### 范围边界（不做什么）
- 不统一扩展名**集合**（TSJS_COLLECTOR_EXTENSIONS / TSJS_EXTENSIONS / walkTsJsFiles endsWith 链）：F243 有意选择"镜像 + 注释互指 + 防漂移测试"合同（跨 batch/panoramic 域 import 方向考量），运行时共享化是独立的更大重构，不塞本 fix
- 不触碰 java-mapper / call-resolver 的 FQN 点分割（语义不同）
- 不改 path.extname 使用面（语义不等价）

## Spec 影响
- 需要更新的 spec: 无需更新（两函数均为模块私有实现细节，不出现在任何 spec 的 FR/公共 API 合同中；specs/243-*/ 制品为历史记录不追改）
