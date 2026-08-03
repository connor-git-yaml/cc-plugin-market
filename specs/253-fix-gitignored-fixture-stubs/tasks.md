> 关联报告：[fix-report.md](./fix-report.md) ｜ 关联规划：[plan.md](./plan.md)

# 任务列表：fixture 忽略样本入库 + 前置存在性守卫

**模式**：fix（精简任务列表，无 User Story 拆分，按最小可验证步骤线性排列）
**验证命令**：`npx vitest run` + `npm run build` + `npm run repo:check`

## 任务顺序说明

T001-T003 相互独立可并行（不同新文件）；T004 依赖 T001-T003 已在磁盘存在；T005 依赖 T004；T006 依赖 T005；T007-T008（变异 A/B）依赖 T006 通过；T009 收口依赖 T007-T008 已还原。

---

- [x] T001 [P] 创建 fixture 样本文件 `tests/fixtures/graph-quality-java/generated/StubOnly.java`
  - 内容：`package generated;` + `public class StubOnly` 含一个可提取方法；顶部注释说明其角色是 fixture 内 `.gitignore:1 generated/` 命中样本，注记 F253 入库背景
  - 风格对齐同 fixture 现有 `src/main/java/com/acme/*.java` 文件（顶部注释 + 简单声明）
  - 验收标准：文件存在于磁盘且语法合法（tree-sitter 可解析出至少一个 export symbol）

- [x] T002 [P] 创建 fixture 样本文件 `tests/fixtures/graph-quality-go/generated/stub.go`
  - 内容：`package generated` + 顶层函数 `func Noop() string`；顶部注释说明角色同上
  - 风格对齐已入库的 `tests/fixtures/graph-quality-go/vendor/Generated.go`（`package vendor` + `func Noop() {}`）
  - 验收标准：文件存在于磁盘且语法合法，含至少一个可提取的顶层 export symbol

- [x] T003 [P] 创建 fixture 样本文件 `tests/fixtures/graph-quality-java/build/Generated.java`
  - 内容：`package build;` + `public class Generated` 含一个方法；顶部注释说明其排除依赖 `JavaLanguageAdapter.defaultIgnoreDirs` 的目录级剪枝（`walkFiles` L79），与仓库根 `.gitignore:7 build/` 规则无关
  - 验收标准：文件存在于磁盘且语法合法，含至少一个可提取的 export symbol

- [x] T004 `git add -f` 强制入库 3 个新样本文件（依赖：T001, T002, T003）
  - 命令：
    ```bash
    git add -f tests/fixtures/graph-quality-java/generated/StubOnly.java
    git add -f tests/fixtures/graph-quality-go/generated/stub.go
    git add -f tests/fixtures/graph-quality-java/build/Generated.java
    ```
  - 验收标准：
    - `git ls-files <各路径>` 均输出对应路径（非空）
    - `git check-ignore -v <各路径>` 仍报命中对应 `.gitignore` 规则（证明是 `-f` 强制入库而非误改 `.gitignore`，仓库根 `.gitignore`/两个 fixture 内 `.gitignore` 均保持不变）

- [x] T005 修改测试文件 `src/batch/generic-language-skeleton-collector.test.ts`，为三条 ④ 号用例加存在性前置守卫（依赖：T004）
  - 顶部追加 `import * as fs from 'node:fs';`
  - L59-65（Java build 内置忽略用例）：在跑 collector 之前插入 `expect(fs.existsSync(path.join(JAVA_FIXTURE_ROOT, 'build/Generated.java'))).toBe(true);`
  - L67-73（Java `.gitignore` 用例）：插入 `expect(fs.existsSync(path.join(JAVA_FIXTURE_ROOT, 'generated/StubOnly.java'))).toBe(true);`
  - L84-91（Go 联合用例）：分别对 `vendor/Generated.go` 与 `generated/stub.go` 各插入一行 `existsSync` 断言（共两行，覆盖两类排除路径）
  - 均用 `path.join(JAVA_FIXTURE_ROOT, ...)` / `path.join(GO_FIXTURE_ROOT, ...)` 构造路径，与文件已有常量保持一致
  - 不改动 ① 号数量断言（L40-47 Java=5、L75-82 Go=4）、不改动生产代码
  - 验收标准：文件保存后 TypeScript 编译通过（`import * as fs` 类型无误），四行新增 `existsSync` 断言均出现在对应 `it(...)` 用例体内、跑 collector 调用之前

- [x] T006 目标测试文件单跑验证（依赖：T005）
  - 命令：`npx vitest run src/batch/generic-language-skeleton-collector.test.ts`
  - 验收标准：全部用例（①②③④⑤⑥）通过，零失败；④ 三条用例的前置 `existsSync` 守卫均通过（证明样本已真实入库生效）；① Java=5、① Go=4 数量断言继续通过（此时为"强形态"验证：7/6 个文件中正确排除 2/2 个）

- [x] T007 变异 A：验证 `.gitignore` 驱动排除路径的真实锚定力（依赖：T006 通过）
  - 步骤：
    1. 临时注释 `src/panoramic/graph/quality/ignore-oracle.ts:157` 的 `if (gitignoreCheck(relativePath)) return true;`
    2. 跑 `npx vitest run src/batch/generic-language-skeleton-collector.test.ts`
    3. 核对转红清单：④ Java `.gitignore` 用例失败、④ Go 联合用例的 `generated` 断言部分失败、① Java（期望 5 实际 6）失败、① Go（期望 4 实际 5）失败；④ Java build 内置忽略用例**应仍通过**（两条防线相互独立的反证）
    4. `git checkout -- src/panoramic/graph/quality/ignore-oracle.ts` 还原
  - 验收标准：转红/维持绿的用例与期望清单完全一致；还原后 `git status` 对该文件无残留 diff

- [x] T008 变异 B：验证内置忽略目录驱动排除路径的真实锚定力（依赖：T007 完成并还原）
  - 步骤：
    1. 临时废掉 `src/batch/generic-language-skeleton-collector.ts:79` 的 `if (adapterIgnoreDirs.has(entry.name)) continue;` 与 `src/panoramic/graph/quality/ignore-oracle.ts:158-160` 的目录段 `ignoreDirs.has(seg)` 检查（改恒 `false` 或删除该分支）
    2. 跑 `npx vitest run src/batch/generic-language-skeleton-collector.test.ts`
    3. 核对转红清单：④ Java build 内置忽略用例失败（`Generated.java` 进入 map）、① Java（期望 5 实际 6）失败
    4. `git checkout -- src/batch/generic-language-skeleton-collector.ts src/panoramic/graph/quality/ignore-oracle.ts` 还原
  - 验收标准：转红用例与期望清单一致；还原后 `git status` 对两文件均无残留 diff

- [x] T009 全量收口验证（依赖：T007, T008 均已还原）
  - 命令：
    ```bash
    npx vitest run
    npm run build
    npm run repo:check
    ```
  - 验收标准：三条命令均零失败/零错误；`git status` 确认仅剩 3 个新增 fixture 文件 + 1 个测试文件修改这 4 处改动，无变异验证的临时改动残留；`git ls-files` 复核 3 个新样本路径均已 tracked

---

## FR / 修复点覆盖映射

| 修复点（来自 fix-report.md 影响范围扫描） | 对应 Task |
|---|---|
| `generated/StubOnly.java` 缺失入库（任务登记 ①） | T001, T004 |
| `generated/stub.go` 缺失入库（任务登记 ②） | T002, T004 |
| `build/Generated.java` 缺失入库（影响面扫描新发现） | T003, T004 |
| ④ Java build 用例缺存在性前置守卫 | T005 |
| ④ Java `.gitignore` 用例缺存在性前置守卫 | T005 |
| ④ Go 联合用例缺存在性前置守卫（两类样本） | T005 |
| 锚定力证明（变异验证，任务硬性要求） | T007, T008 |
| ① 号数量断言从"弱形态"恢复"强形态" | T004, T006（自动恢复，无需改代码） |

## 依赖关系图

```
T001 ─┐
T002 ─┼─→ T004 ─→ T005 ─→ T006 ─→ T007 ─→ T008 ─→ T009
T003 ─┘
```

## 推荐实现策略

单人线性执行：T001-T003 可并行创建（各自独立文件），随后严格串行 T004 → T009，因为每步都依赖上一步的实际验证结果（尤其变异验证必须在真实通过的基线上进行，且每轮变异后立即还原避免污染下一轮）。全程不涉及生产代码的永久改动，仅测试基础设施 + fixture 样本入库。
