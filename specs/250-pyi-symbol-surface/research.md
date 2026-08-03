# Phase 0 研究：`.pyi` 符号采集面扩集实现决策

> **修订记录**：本版本已按 plan 阶段对抗审查结论（C1）修正决策 2 的等价性论证，决策 4 补充 `signature` 参考形态说明。

本 feature 的产品裁决与理由链已在 `spec.md`「核心决策记录」章节完整记录（含两轮对抗审查的证伪与修正），不再重复。本文件只记录**实现层面**在 plan 阶段需要裁定、且有明确替代方案取舍的技术决策——不存在需要外部调研的 `NEEDS CLARIFICATION` 项，全部决策基于对现有源码的实证阅读。

## 决策 1：护栏 A 的实现形态——显式跳过 vs 保留现状偶然安全

**Decision**：`buildModuleGraph` 构建 `pyModuleMap` 时，对 `.pyi` 文件显式跳过（不写入该 map），而非保留现状"`path.basename(absF, '.py')` 对 `.pyi` 不剥离后缀"这一偶然安全属性。

**Rationale**：
- 现状分析：`pyModuleMap.set(path.basename(absF, '.py'), rel)` 对 `mod.pyi` 产生键字面值 `mod.pyi`（因为 `.py` 后缀严格匹配失败，`basename` 不做任何剥离）。绝对 import 解析时 `topModule = spec.split('.')[0]`（如 `import mod` → `topModule = 'mod'`），`'mod' !== 'mod.pyi'`，故查表 `pyModuleMap.get('mod')` 永远查不到 `.pyi` 对应项——这是"正确的"，但正确性来自两个独立事实的巧合交汇，而非显式设计。
- 风险点：本次同时引入护栏 B（`stripFileExtension` helper，对 `.py`/`.pyi` 均按真实扩展名剥离）。若未来有维护者注意到 `extractSymbolNodes` 与 `buildModuleGraph` 都在做"从路径剥扩展名"这件事，可能会"合并成一个共享 helper"（这是一个自然的代码整洁冲动）。一旦这样做，`pyModuleMap` 的键会从 `mod.pyi` 变为 `mod`，与同目录 `mod.py` 产生的键 `mod` 发生**碰撞**（`Map.set` 后写覆盖先写，取决于 `fs.readdirSync` 遍历顺序，是不确定性 bug）。这正是 spec FR-004 所说"不得依赖其恰好实现正确的偶然性继续裸奔"的具体后果。
- 显式跳过（`if (absF 是 .pyi) continue;` 或等价判定）把"`.pyi` 不参与绝对 import 目标解析"变成一条独立于 label 剥离逻辑的、自解释的不变量，即使未来 label helper 被重构/合并，这条不变量也不会被连带破坏。

**Alternatives considered**：
- **保留现状（选项 a）**：零代码改动，但把一个已被本次改动亲手证明"脆弱"的偶然属性继续当长期契约裸奔，与本 story 自身"消除认知负债"的价值主张自相矛盾，故不采用。
- **在 `surfaceMatchesFile`/SSoT 层面新增一个"import-resolution-only surface"**：过度抽象——当前只有一处消费方（`pyModuleMap` 构建），且逻辑仅一行 `continue`，为此新增一个 SSoT 常量违反 Constitution III（YAGNI）。

## 决策 2：label 扩展名剥离的实现形态——共享 helper vs 各自内联

**Decision**：在 `python-adapter.ts` 内提取一个函数级私有 helper（非导出），供 `extractSymbolNodes` 的正常分支与 parseError 降级分支共用：

```ts
function stripFileExtension(relPath: string): string {
  return path.basename(relPath, path.extname(relPath));
}
```

**Rationale**：
- spec FR-005 明确点名当前 bug 存在于**两处**分支（正常分支约 `python-adapter.ts:220`、parseError 降级分支约 `:202`），且历史上（初版 spec 的证伪记录）已经出现过"只改一处漏改另一处"的真实错误标本。单一函数收敛为一处实现，结构性消除双写漂移风险，而非依赖"记得同步改两处"的人工纪律。
- 不引入独立文件/导出符号：helper 只有 `extractSymbolNodes` 内部两个分支消费，无跨模块复用需求，作为该函数作用域内（或类内 private 方法）的最小实现即可，避免为两行逻辑新增一个独立模块（Constitution III）。

**等价性论证（C1 订正——原表述"对 `.py` 输入行为与原实现逐字等价"范围过宽）**：

`path.basename(relPath, path.extname(relPath))` 对**采集面内除纯点文件 `.py` 外的全部输入**与原硬编码 `path.basename(relPath, '.py')` 逐字等价，包括 `mod.py`（均剥离为 `mod`）、`__init__.py`/`__init__.pyi`（均剥离为 `__init__`）等常规样本。但存在一处已声明的可接受行为 delta：

| 输入 | 旧实现 `path.basename(relPath, '.py')` | 新实现 `path.basename(relPath, path.extname(relPath))` |
|------|---|---|
| `.py`（纯点文件，即文件名恰好等于扩展名本身） | `''`（空串） | `.py`（原样返回） |
| `.pyi`（纯点文件） | `.pyi`（原样返回，无变化） | `.pyi`（原样返回，无变化） |
| `mod.py` | `mod` | `mod` |
| `mod.pyi` | `mod.pyi`（不剥离，既存 bug） | `mod`（本次修复目标） |

该 delta 的成因是 Node.js `path` 模块两个函数的实现细节差异：
- `path.basename(path, ext)` 在 `ext === path`（整个路径恰好等于要剥离的扩展名字符串）时**直接返回空字符串 `''`**，这是 Node 源码里的显式特判（避免"整个文件名都被吃掉"这种更荒谬的结果，但空字符串本身并不比原文件名更合理）。
- `path.extname(path)` 对纯点文件（文件名以且仅以一个 `.` 开头、后面无更多的点分隔扩展名）返回空字符串 `''`（这是"dotfile 视为无扩展名"的既定 POSIX 语义），因此新实现对 `.py` 输入调用 `path.basename('.py', '')`——`ext` 参数为空串时不触发任何剥离逻辑，直接返回原始文件名 `.py`。

`case-sensitive`/`endsWith` 语义的采集面（TSJS/PY skeleton walk、python 符号扫描）本就允许纯点文件命中（`collector-surface.ts:29-30` 明文记录 `'.ts'.endsWith('.ts') === true` 这一语义，`collector-surface.test.ts:515-534` 的 W-004 探针已实跑验证 `.py` 纯点文件会被 `scanPyFiles`/`extractSymbolNodes` 真实采集），因此这不是一个理论边界情形，而是采集面内确实可能出现的真实输入。**该 delta 判定为可接受**：旧行为（空字符串 label）在任何下游展示场景都更接近一个静默 bug（空 label 无法向用户传达任何信息），新行为（保留原始点前缀文件名）虽然也谈不上"美观"，但至少诚实反映了文件名本身，不构成需要额外护栏拦截的回归。已在 `tasks.md`/`tests/adapters/python-adapter.test.ts`（T-C1-dotfile）中钉死该行为，防止未来被误当作 bug"修复"回空字符串或引入其他不一致处理。

**Alternatives considered**：
- **各分支各自内联 `path.basename(relPath, path.extname(relPath))`**：本质等价但违反 DRY，且历史已证明相同逻辑分裂在两处会漂移，故收敛为共享函数。
- **把 helper 提到 `collector-surface.ts`（SSoT 模块）里**：过度归位——`collector-surface.ts` 是"采集面判定"的 SSoT（回答"文件是否在某管线的扫描范围内"），而 label 剥离是"图节点展示字段生成"，两者是不同职责；且 SSoT 模块被裁定为"零依赖叶子模块"（FR-019 既有约束），不应承载与采集面判定无关的展示逻辑。
- **为纯点文件特判，强制 label 回退为某个占位符（如 `'(unnamed)'`）**：过度设计——当前采集面内纯点文件本就是极端边界情形（真实 Python 项目几乎不会存在字面量名为 `.py`/`.pyi` 的文件），为此新增特判分支属于"为假设性边界增加复杂度"，违反 Constitution III；如实记录 delta 并用探针钉死即可。

## 决策 3：护栏 A/B 防回归探针落位——独立文件 vs 复用 `tests/adapters/python-adapter.test.ts`

**Decision**：新增探针直接追加到既有 `tests/adapters/python-adapter.test.ts`（38 个既有 `it`，含 `extractSymbolNodes`/`scanPyFiles` 相关 describe 块），不新建独立测试文件。

**Rationale**：本次改动的被测对象（`extractSymbolNodes`/`buildModuleGraph`/`scanPyFiles`）已在该文件有对应的 describe 分组与 fixture 构造惯例（`fs.mkdtempSync` 临时目录 + `vi.spyOn(adapter, 'analyzeFile')` mock），复用可减少样板代码、保持测试组织的内聚性；新建文件除了物理隔离外无额外收益，且会制造"同一 adapter 的测试分散在两个文件"的维护负担。

**Alternatives considered**：新建 `tests/adapters/python-adapter-pyi-surface.test.ts` 专测本 feature——考虑过，但本次改动量（plan.md「测试策略」列出的 6 个必须 + 1 个可选 `it`）不足以构成独立文件的理由，且 `collector-surface.test.ts` 已经是本类"跨管线采集面"探针的既定归宿，护栏 A/B 探针性质上更贴近 adapter 自身行为（非跨管线对拍），故落在 `python-adapter.test.ts`。

## 决策 4：`.pyi` symbol 节点 `signature` 精确字符串——不预先猜测，以实跑结果为准

**Decision**：plan/tasks 不预先写死 `mod_fn` 的 `signature` 精确字符串（如是否含 `-> int`、是否含省略号 `...`），改为在 FR-007 fixture 再生步骤中，以 `npm run fixtures:regen:collector-fingerprint` 的实际产出为准，人工核对 delta 后再决定是否接受再生结果。

**Rationale**：Constitution IV（诚实标注不确定性）要求推断内容不得以确定性口吻呈现。`signature` 字段来自 `TreeSitterAnalyzer`（tree-sitter-python）对函数声明的提取逻辑，本次改动完全不修改该提取逻辑本身，但其对 `.pyi` 语法（含返回类型注解 `-> int` 与省略号函数体 `...`）的具体呈现形式未经本次实跑验证。写死一个猜测值会有两个风险：(a) 猜错导致 fixture 校验误报；(b) 掩盖了"验证阶段本应实跑确认"这一必要步骤。正确做法是让 tasks.md 的验证步骤显式包含"运行 regen 脚本 → 人工核对 delta 内容与预期字段清单（本 plan/spec 已列出的字段名集合）是否吻合 → 确认后再 commit fixture"。

**参考形态（非确定值，仅供实现者预期校准，仍以 regen 实跑产出为准）**：对同一 `TreeSitterAnalyzer` 提取逻辑下、含返回类型注解且无省略号函数体的常规 `.py` 函数（如 `def real_fn(x: int) -> str: ...`），观察到的既有签名提取形态通常为 `"def real_fn(x: int) -> str"`（即保留返回类型注解、不含函数体/末尾冒号）。若 `mod.pyi` 的 `mod_fn` 最终提取结果与此形态量级不符（例如完全没有返回类型、或包含了函数体 `...`），应视为需要人工核查的异常信号，而非直接接受再生结果。

**Alternatives considered**：直接在 plan 中猜测写出 `"def mod_fn() -> int: ..."` 之类的确定字符串并写入 fixture 校验——被否决，因为这是对未验证事实的确定性断言，违反 Constitution IV；只给出"参考形态"而非"确定值"是在诚实标注与提供校准基准之间的折衷。

## 结论

以上 4 项决策均不改变 spec.md 已裁决的产品方向与 FR 范围边界，只解决"怎么写代码/怎么组织测试"这一层的具体取舍。Phase 1（data-model / contracts / quickstart）与 tasks.md 均基于此处的决策展开。
