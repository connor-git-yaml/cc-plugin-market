# 任务清单 — F223 charter 快照烤死生成日期

> 模式：fix（精简任务分解）。依据：`plan.md`（方案 A）。范围边界：仅测试守护层，`src/**` 生产代码零改动。
> 依赖顺序：T1 → T2 → T3 → T4 → T5（可与 T1-T4 并行，纯文档订正）→ T6（收尾，依赖 T1-T4 全部完成）。

## T1 — 扩展 `scrubRuntimeNoise` 噪声清洗规则（C1a/C1b/C1c）

**涉及文件**：`tests/e2e/f220-decomposition-charter.e2e.test.ts`

**定位方式**：
- C1a：头部说明注释块，插入点在既有第 19 行（`* 统计结构保留（mock 下确定，是调度行为的真信号）`）与第 20 行（`*/`）之间
- C1b：`scrubRuntimeNoise` 函数上方的枚举式注释块（约 L158-166），插入点在既有 "ISO-8601 时间戳" 说明行（约 L162）之后
- C1c：`scrubRuntimeNoise` 函数体（约 L167-177），插入点在既有 `<ISO-TS>` 规则（`.replace(/\d{4}-\d{2}-\d{2}T.../g, '<ISO-TS>')`，约 L172）之后，原后续 `.replace(...)` 链依次下移一行

**具体动作**：

1. C1a：插入注释行
   ```
    * - F223 修复：README 首行本地化日期（`toLocaleDateString('zh-CN')`，产品既有行为）曾被当成
    *   稳定内容冻结，跨系统日期必红；scrubRuntimeNoise 补 <DATE> 规则，.snap 做外科式定点替换
    *   （9 处字面量，严禁 `vitest -u`）；生产代码零改动，详见 fix-report.md
   ```
2. C1b：插入枚举项
   ```
    * - 本地化日期 `YYYY/M/D`（README 首行 `toLocaleDateString('zh-CN')` 产出，无补零；F223 新增）
   ```
3. C1c：在 `<ISO-TS>` 规则之后插入一条新的 `.replace(...)`：
   ```ts
   .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, '<DATE>') // toLocaleDateString('zh-CN') 本地化日期（F223）
   ```
   插入后完整函数体应为（顺序即最终态）：
   ```ts
   function scrubRuntimeNoise(text: string, root: string): string {
     return text
       .replaceAll(root, '<ROOT>')
       .replaceAll(basename(root), '<PROJECT>')
       .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
       .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO-TS>')
       .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, '<DATE>') // toLocaleDateString('zh-CN') 本地化日期（F223）
       .replace(/("?durationMs"?\s*:\s*)\d+/g, '$1"<N>"')
       .replace(/\bbatch-\d{10,}\b/g, 'batch-<TS>')
       .replace(/\b\d+(?:\.\d+)?\s*ms\b/g, '<MS>')
       .replace(/\b\d+(?:\.\d+)?\s*s\b/g, '<SEC>'); // summary 人类可读行 "总耗时: 0.8s"
   }
   ```

**验收命令**：
```bash
grep -n "toLocaleDateString('zh-CN')" tests/e2e/f220-decomposition-charter.e2e.test.ts
grep -n "'<DATE>'" tests/e2e/f220-decomposition-charter.e2e.test.ts
```
期望：两条 grep 均有匹配（各至少 1 行，其中第二条命中新增的 `.replace(...)` 语句所在行）。

**依赖**：无，首个任务。

---

## T2 — `.snap` 文件 9 处外科式定点替换（C2）

**涉及文件**：`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`

**定位方式**：9 处日期字面量行号 L286 / 739 / 1260 / 1804 / 2041 / 2546 / 3080 / 3509 / 4098，内容形如：
```
> 由 spectra v4.3.0 自动生成 | 2026/7/21
```

**具体动作**：逐处使用 Edit 工具做定点字符串替换，`old_string` 取整行（含行号上下文的最小唯一片段），仅将 `2026/7/21` 替换为 `<DATE>`，其余字符（含前缀 `> 由 spectra v4.3.0 自动生成 | `、行尾换行）逐字节保留。**禁止使用 `vitest -u`，禁止全文 `sed -i` 批量替换**。9 处逐一编辑，每处编辑后立即复核累计变化行数（不要全改完再一次性核验）。

**验收命令**（三条全部满足才算通过，任一条不满足须回退重做）：

```bash
# 核验 A：变更统计 —— 必须恰好 9 行删除 + 9 行新增，且只涉及这一个文件
git diff --numstat tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap
```
期望输出：`9	9	tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`

```bash
# 核验 B：逐行内容形态 —— 每一对 -/+ 行除日期 token 外必须逐字节相同
git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap \
  | grep -E '^[+-]> 由 spectra' \
  | sed -E 's/^[+-]//; s#2026/7/21|<DATE>#<X>#' \
  | sort -u
```
期望输出：恰好 1 行（`> 由 spectra v4.3.0 自动生成 | <X>`）

```bash
# 核验 C：变化行数与已知失败用例数一致
git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | grep -cE '^[+-]> 由 spectra'
```
期望输出：`18`

**依赖**：无强制先后（T2 本身不依赖 T1 才能编辑），但**必须在 T1 完成后才能验证"改完全绿"**（T1 提供清洗规则，T2 提供已清洗的快照基准，二者组合才能通过测试）。建议顺序：先 T1 后 T2，便于统一跑一次全绿验证。

---

## T3 — 新增场景10b 纯函数级时间不变性用例（§4.2）

**涉及文件**：`tests/e2e/f220-decomposition-charter.e2e.test.ts`

**定位方式**：插入点在场景10a 用例之后（描述块内，同级 `it(...)` 兄弟节点）

**具体动作**：新增以下用例，原样落地：

```ts
it('场景10b（F223 守护）：scrubRuntimeNoise 对本地化日期的清洗与系统日期无关（时间旅行防线）', () => {
  const root = '/tmp/f220-guard-root';
  const sample = (date: string): string =>
    `> 由 spectra v4.3.0 自动生成 | ${date}\n40位SHA: ${'a'.repeat(40)}\n耗时: 12.3ms / 0.8s\n`;

  // 覆盖：修复当天日期 / 跨日次日 / 跨年边界 / 补零形态 / 远古日期 —— 五个互不相同的日期变体
  const dates = ['2026/7/21', '2026/7/22', '2027/1/1', '2026/07/22', '1999/1/1'];
  const cleaned = dates.map((d) => scrubRuntimeNoise(sample(d), root));

  // 不变量：无论输入哪个日期，清洗结果必须收敛到同一字符串 —— 证明与"系统当前日期"无关
  expect(new Set(cleaned).size).toBe(1);
  expect(cleaned[0]).toContain('<DATE>');
  expect(cleaned[0]).not.toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);

  // 回归防线：既有 ISO-8601 完整形态规则不受本次改动干扰
  expect(scrubRuntimeNoise('lastUpdated: 2026-07-22T03:04:05.000Z', root)).toBe(
    'lastUpdated: <ISO-TS>',
  );

  // 负例防线：短数字（版本号/比例）不得被误伤
  const untouched = 'v4.3.0 spectra | specs/modules/_index.spec.md | 4/5 通过';
  expect(scrubRuntimeNoise(untouched, root)).toBe(untouched);
});
```

**约束**（须在实现时人工确认，非可执行命令能完全覆盖）：
- 该用例**不得**调用 `toMatchSnapshot()`（纯断言，无快照落盘）
- 该用例标题**不得**写入 `SCENARIO_TITLES` 数组（该数组是场景10a `expectedKeys` 断言的唯一事实源）

**验收命令**：

```bash
# 命令 1：确认用例已插入且不含快照断言
grep -A20 "场景10b" tests/e2e/f220-decomposition-charter.e2e.test.ts | grep -c "toMatchSnapshot"
```
期望输出：`0`

```bash
# 命令 2：确认场景10b 标题未被写入 SCENARIO_TITLES（不破坏场景10a key 集合断言）
grep -n "SCENARIO_TITLES" tests/e2e/f220-decomposition-charter.e2e.test.ts | xargs -I{} echo {}
grep -c "场景10b" <(sed -n '/SCENARIO_TITLES/,/\];/p' tests/e2e/f220-decomposition-charter.e2e.test.ts)
```
期望输出：第二条命令输出 `0`（`SCENARIO_TITLES` 数组定义区间内不含"场景10b"字样）

```bash
# 命令 3：单独运行场景10a 确认未被打破
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts -t "场景10a"
```
期望：该用例通过（`1 passed`）

**依赖**：可与 T1 并行编辑（同文件不同位置，建议顺序编辑避免冲突），但需在 T1 之后跑测试验证（依赖 `scrubRuntimeNoise` 已扩展）。

---

## T4 — 端到端时间旅行交叉验证（§4.3）

**涉及文件**：无代码改动，纯验证步骤（若 Step 0 sanity check 失败需更换时区标识符，不影响 T1-T3 代码）

**具体动作与验收命令**：

**Step 0：sanity check（本机 Node 是否识别所选 IANA 时区）**
```bash
node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
TZ=Pacific/Kiritimati node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
TZ=Etc/GMT+12 node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
```
期望：三行日期字符串至少有两行互不相同（若三行全同，说明本机 Node 缺少对应时区数据，需更换其它极端偏移时区标识符重试）

**Step 1：对照组（默认系统时区）**
```bash
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```
期望：`Test Files 1 passed (1)`

**Step 2：时间旅行组 A（UTC+14）**
```bash
TZ=Pacific/Kiritimati npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```
期望：`Test Files 1 passed (1)`

**Step 3：时间旅行组 B（UTC-12）**
```bash
TZ=Etc/GMT+12 npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```
期望：`Test Files 1 passed (1)`

**依赖**：必须在 T1、T2、T3 全部完成后执行（三组均跑完整套件，任一前置任务未完成都会导致非零失败）。

---

## T5 — 订正 plan.md §4.1 的事实错误

**涉及文件**：`specs/223-fix-charter-snapshot-date/plan.md`（约 L129，§4.1 "基础回归（必须）" 段落的"改动前基线"描述）

**问题**：原文称"9 个 `toMatchSnapshot()` 断言因日期漂移失败、2 个通过（场景10 code-only 因 README 未生成不含日期字面量、场景10a 不涉及内容比对）"，与主编排器 2026-07-22 实测不符。

**具体动作**：将该句改为准确表述：

- 失败 9 个：场景1、2、3、4、5、6、7、8、**场景10（code-only）**（场景10 快照**含**日期字面量，故失败，而非原文所称"不含日期")
- 通过 2 个：**场景9（dry-run，快照无日期字面量）** + 场景10a（不涉及内容比对）
- 补充说明：场景8 单个测试内含 2 个快照断言，第 1 个（firstPayload，无 reporting 字段）不含日期、第 2 个含日期，因此该测试整体判定失败

订正后 §4.1 的"修复后用例总数 12"结论保持不变，无需改动。

**验收命令**：
```bash
grep -n "场景10（code-only）" specs/223-fix-charter-snapshot-date/plan.md
grep -n "场景9（dry-run" specs/223-fix-charter-snapshot-date/plan.md
```
期望：两条 grep 均有匹配，且上下文内容与订正后的表述一致（不再出现"场景10 code-only 因 README 未生成不含日期字面量"这句原文）

**依赖**：无（纯文档订正，可与 T1-T4 并行进行，不影响代码验证链路）。

---

## T6 — 最终全量回归收尾

**涉及文件**：无改动，纯验证

**具体动作**：

```bash
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```
期望：
```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

```bash
npx vitest run
```
期望：全量套件零失败（允许既有已知 flaky 用例如 `watch-command.test.ts`、`batch-orchestrator-incremental.test.ts`、`community-analysis` 相关 perf 测试的偶发失败，需隔离重跑复核非本次改动引入）

```bash
npm run build
```
期望：零 TypeScript 编译错误

```bash
npm run lint
```
期望：零 lint 错误（`tsc --noEmit`）

**依赖**：必须在 T1、T2、T3、T4 全部完成且各自验收通过之后执行，是本次 fix 的收尾任务。

---

## FR / 变更点覆盖映射

| plan.md 变更点 | 对应任务 |
|----------------|---------|
| C1a 头部注释 | T1 |
| C1b 函数注释 | T1 |
| C1c 清洗正则 | T1 |
| C2 快照 9 处替换 | T2 |
| §4.2 场景10b 新增用例 | T3 |
| §4.3 端到端时间旅行交叉验证 | T4 |
| §4.1 事实订正（本次任务分解阶段发现） | T5 |
| §4.1 基础回归 + 全量回归 + build + lint | T6 |

## 并行性说明

- T1、T3、T5 可并行编辑（T1/T3 同文件不同位置需注意合并顺序，建议先 T1 后 T3 顺序落盘以减少编辑冲突；T5 是独立文件，天然并行）
- T2 依赖 T1 提供的清洗规则才能通过测试验证，但编辑动作本身可与 T1 同时进行，验证环节需等 T1 落盘
- T4、T6 是强收尾任务，必须在 T1-T3 全部完成后才能执行，不建议并行
