# 修复规划 — F223 charter 快照烤死生成日期

> 模式：fix（精简规划）。诊断依据：本目录 `fix-report.md`（方案 A 已选定，方案"冻结时钟"已被证伪）。
> 范围边界：仅测试守护层（清洗规则 + 快照字面量），`src/**` 生产代码零改动。

## 1. 变更清单（逐文件）

### C1 `tests/e2e/f220-decomposition-charter.e2e.test.ts` — 噪声清洗规则扩展

**C1a — 头部说明注释（L1-20）**：在 L19（`* 统计结构保留（mock 下确定，是调度行为的真信号）`）与 L20（`*/`）之间插入一条新说明，标注本次修复的边界：

```
 * - F223 修复：README 首行本地化日期（`toLocaleDateString('zh-CN')`，产品既有行为）曾被当成
 *   稳定内容冻结，跨系统日期必红；scrubRuntimeNoise 补 <DATE> 规则，.snap 做外科式定点替换
 *   （9 处字面量，严禁 `vitest -u`）；生产代码零改动，详见 fix-report.md
```

**C1b — `scrubRuntimeNoise` 函数注释（L158-166）**：在既有 "ISO-8601 时间戳" 说明（L162）之后新增一条枚举项：

```
 * - 本地化日期 `YYYY/M/D`（README 首行 `toLocaleDateString('zh-CN')` 产出，无补零；F223 新增）
```

**C1c — `scrubRuntimeNoise` 函数体（L167-177）**：在既有 `<ISO-TS>` 规则（现 L172）之后插入一条新的 `.replace(...)` 链式调用（原 L173-176 依次下移一行，函数逻辑顺序不受影响 —— 各条正则字符集互斥，插入位置只影响可读性分组，不影响清洗结果）：

```ts
.replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, '<DATE>') // toLocaleDateString('zh-CN') 本地化日期（F223）
```

完整字段效果（新函数体）：

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

**正则设计说明（`\b\d{4}\/\d{1,2}\/\d{1,2}\b`）**：

| 设计点 | 理由 |
|--------|------|
| `\d{4}` 精确要求 4 位年份 | 排除 `4/5`（比例/进度文本）、`v4.3.0`（版本号，分隔符是 `.` 非 `/`，天然不匹配）等短数字场景；只有真实四位年份才会触发 |
| `\/\d{1,2}\/\d{1,2}` 月日各 1-2 位 | `toLocaleDateString('zh-CN')` 在 Node 全 ICU 下不补零（实测 `2026/7/21`），若未来 Node/ICU 版本改为补零（`2026/07/21`）该正则同样匹配，前向兼容 |
| 首尾 `\b` 边界 | 防止匹配到更长数字串的子串（例如某长十进制 ID 中间恰好出现 4 个连续数字 + 斜杠片段的极端场景）；`\b` 在两侧数字相邻处（无词边界）天然不生效，起到锚定整词的作用 |
| 未限定分隔符前后文（不要求前缀 `\| `） | 保持与既有 `<ISO-TS>` / `<SHA>` 等规则一致的"纯字面量匹配"风格，不引入上下文耦合；已用下方核验命令证明当前语料零误匹配，无需收窄 |

**误匹配核验方式（当前快照语料，规划阶段已实跑，结果如下）**：

```bash
# 核验 1：精确正则在 .snap 全文的匹配数 = 9（与已知 9 处冻结日期字面量一致）
grep -oE '\b[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}\b' \
  tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | wc -l
# 已实跑输出：9

# 核验 2：放宽到任意"数字/数字/数字"形态（比精确正则更宽松的超集），验证语料内不存在
# 任何非日期的 slash-数字序列会被精确正则遗漏而被宽松正则捕获的情况
grep -oE '[0-9]{1,4}/[0-9]{1,2}/[0-9]{1,2}' \
  tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | wc -l
# 已实跑输出：9（与核验 1 相同 → 证明语料内不存在任何其它 slash-数字序列，精确正则无遗漏也无误伤）

# 核验 3：全仓扫描确认该模式只出现在本快照文件（排除同类漂移隐藏在其它文件）
grep -rlE '[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}' tests/
# 已实跑输出：仅 tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap 一个文件
```

### C2 `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` — 外科式定点替换

9 处字面量位置（本次读取快照文件确认的行号，正文原样，无转义字符）：L286 / 739 / 1260 / 1804 / 2041 / 2546 / 3080 / 3509 / 4098，形如：

```
> 由 spectra v4.3.0 自动生成 | 2026/7/21
```

**编辑动作**：仅将这 9 行中的 `2026/7/21` 替换为 `<DATE>`，其余字符（含前缀 `> 由 spectra v4.3.0 自动生成 | `、行尾换行）逐字节保留。**不使用 `vitest -u`**（理由见 fix-report.md「方案证伪」一节：整体重录会静默吸收 batch-summary 双轮文件名等其它潜在漂移）。

## 2. 快照编辑规程

### 2.1 如何做到"只改 9 处日期、不碰其它字节"

- 采用**逐处定点编辑**（Edit 工具的精确字符串匹配替换），每处编辑的 `old_string` 取包含行号上下文的最小唯一片段（例如整行 `> 由 spectra v4.3.0 自动生成 | 2026/7/21`），`new_string` 仅将 `2026/7/21` 换成 `<DATE>`，其余字符原样重复；**不做全文 `sed -i` 批量替换**，避免因编辑器/工具的换行符、编码归一化行为意外触达其它行。
- 9 处编辑逐一执行并逐一确认 diff（每次编辑后立即用下方核验命令复核累计变化行数，而非全部改完再一次性核验），把"改错/改漏"的定位成本降到单次编辑粒度。

### 2.2 自证没有夹带其它改动（可执行核验命令）

```bash
# 核验 A：变更统计 —— 必须恰好 9 行删除 + 9 行新增，且只涉及这一个文件
git diff --numstat tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap
# 期望输出：9	9	tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap

# 核验 B：逐行内容形态 —— 每一对 -/+ 行除日期 token 外必须逐字节相同
git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap \
  | grep -E '^[+-]> 由 spectra' \
  | sed -E 's/^[+-]//; s#2026/7/21|<DATE>#<X>#' \
  | sort -u
# 期望输出：恰好 1 行（"> 由 spectra v4.3.0 自动生成 | <X>"）
#   —— 若输出多于 1 行，说明存在日期以外的字节差异，编辑未达"外科式"标准，须回退重做

# 核验 C：变化行数与已知失败用例数一致（交叉验证 fix-report 的"9 处对应 9 个失败用例"结论）
git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | grep -cE '^[+-]> 由 spectra'
# 期望输出：18（9 减 + 9 加）
```

三条命令全部满足期望值，即构成"只改 9 处日期字面量、零其它字节漂移"的可执行证据链，与 fix-report.md 中已聚合的 diff 证据互为交叉验证。

## 3. 回归风险评估

| 风险 | 等级 | 规避 / 验证手段 |
|------|------|----------------|
| 场景10a 的 snapshot key 集合断言（L542-557）因新增测试用例被打破 | 低 | §4.2 新增的验证用例（场景10b）**不调用 `toMatchSnapshot()`**（纯断言，无快照落盘），不产生新 `exports[...]` key；且**不**将其标题写入 `SCENARIO_TITLES` 数组（该数组是 L556 `expectedKeys` 的唯一事实源）。验证：单独运行场景10a 用例确认仍绿 |
| 新正则误伤既有已冻结内容（其它字段被意外清洗成 `<DATE>`） | 低 | §1 三条核验命令已证明当前语料匹配数恰为 9、无遗漏无误伤；实现阶段跑全量 9 个受影响用例，若有误伤会在这些用例上产生**非日期**的 diff（而非全绿），可被立即发现 |
| 其它读取该 `.snap` 文件的测试/脚本 | 极低 | 全仓检索确认 `f220-decomposition-charter.e2e.test.ts.snap` 无其它消费方（该文件仅被 vitest 快照机制与场景10a 自身的 key 集合校验读取，二者均已覆盖） |
| 清洗规则对未来新增噪声形态仍有遗漏（Why 4/5 揭示的枚举式清洗结构性缺口） | 中（长期） | 本次仅补齐已知的 `toLocaleDateString('zh-CN')` 形态，不做"系统性非确定性来源枚举"的架构改造（超出 fix 范围，若需要应立独立 Feature）；§4.2 新增的纯函数级时间旅行用例把"日期清洗结果与具体日期值无关"这一不变量转为回归防线，降低同类问题再次跨日引爆的概率 |
| `graph-report-generator.ts:49` 的裸 ISO 日期（`YYYY-MM-DD`）未来若被纳入快照冻结，会重演同一根因 | 低（当前不触发） | fix-report.md 已记录为已知风险；当前该内容不在 payload 内（快照中 `YYYY-MM-DD` 形态匹配数为 0，已由 fix-report 核验），本次不预防性处理（§5 明确列为不做项） |
| C1 头部/函数注释改动被误认为"生产行为变更" | 极低 | 注释与正则规则均限定在 `tests/e2e/` 下的测试私有 helper，`src/**` 零改动；`git diff --stat` 复核改动文件清单仅含 2 个 `tests/` 路径文件 |

## 4. 修复验证方案

### 4.1 基础回归（必须）

改动前基线（2026-07-22 实跑）：`tests/e2e/f220-decomposition-charter.e2e.test.ts` 共 11 个 `it()` 用例（10 个场景独立用例 + 场景10a key 校验），其中 9 个失败、2 个通过：

- **失败 9 个**：场景1、2、3、4、5、6、7、8、**场景10（code-only）** —— 这 9 个用例的快照均含 README 首行日期字面量
- **通过 2 个**：**场景9（dry-run）**，其快照不含日期字面量（dry-run 路径不写 README）；**场景10a**，只校验快照 key 集合、不做内容比对
- 补充：场景8 单个用例内含 2 个快照断言，第 1 个（`firstPayload`，不含 `reporting` 字段）无日期、第 2 个含日期，因此该用例整体判失败 —— 这也解释了"快照文件 11 个 key / 其中 9 个含日期"与"11 个用例 / 9 个失败"的对应关系

```bash
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```

期望（含 §4.2 新增的场景10b，本次修复后用例总数变为 12）：

```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

```bash
npx vitest run     # 全量回归，确认改动未影响其它套件
npm run lint         # tsc --noEmit
npm run build         # tsc
```

### 4.2 新增纯函数级时间旅行验证（回归防线，随 C1 一并落地）

在 `f220-decomposition-charter.e2e.test.ts` 描述块内、场景10a 之后新增一条独立用例（不进入 `SCENARIO_TITLES`，不产生新快照 key，因此不计入 §1 C2 的 9 处快照替换范围，属纯新增用例）：

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

该用例把 Why 5 揭示的"无时间不变性验证"缺口转成一条常驻回归防线：任何人未来往 `scrubRuntimeNoise` 里改坏 `<DATE>` 规则，会在**函数级**立即失败，无需等到真实跨日才发现。

### 4.3 端到端时间旅行交叉验证（"任意系统日期下全绿"的进程级证据）

`vi.setSystemTime` 已被证伪（会连带冻结 `Date.now()`，破坏 batch-summary 双轮文件名唯一性）。改用**只影响本地化日期渲染、不影响 `Date.now()` 纪元值**的进程级手段：Node 的 `toLocaleDateString()`（无显式 `timeZone` 选项时）按进程启动时读取的 `TZ` 环境变量解析日历日期，而 `Date.now()` 返回的 UTC 毫秒纪元完全不受 `TZ` 影响。用极端时区偏移（UTC+14 / UTC-12）让 README 渲染出与"当前系统日期"确定不同的日历日期，同时保证 `Date.now()` 单调性与 batch-summary 文件名唯一性不受任何干扰 —— 这正是"不污染被测行为"的时间旅行验证，直接命中本 bug 的根因字段（`toLocaleDateString('zh-CN')`），而非绕过它。

**Step 0：确认 TZ 切换在本机 Node 生效（前置 sanity check，成本 < 1s）**

```bash
node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
TZ=Pacific/Kiritimati node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
TZ=Etc/GMT+12 node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
```

期望：三行日期字符串至少有两行互不相同（证明 `TZ` 确实改变了本地化日期渲染结果，且本机 Node 具备识别这两个 IANA 时区标识符的能力；若三行全同，说明该 Node 构建缺少对应时区数据，需换用其它极端偏移时区标识符重试，不影响本方案思路本身）。

**Step 1：对照组（默认系统时区，当前"今天"）**

```bash
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```

**Step 2：时间旅行组 A（切到 UTC+14，README 日期比默认时区可能提前 1 天）**

```bash
TZ=Pacific/Kiritimati npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```

**Step 3：时间旅行组 B（切到 UTC-12，README 日期比默认时区可能落后 1 天）**

```bash
TZ=Etc/GMT+12 npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
```

三组期望结果一致：`Test Files 1 passed (1)`，零失败。三组分别对应三个不同的实际日历日期渲染进 README，且均能被 `<DATE>` 规则归一化 —— 这是比"只等下一个自然日"更强的证据：单次验证即覆盖至少两个额外的、真实存在偏移的日历日期，且不依赖任何 mock/fake-timer 干预被测代码路径。

**为何选择 TZ 偏移而非直接改系统时钟 / 引入 libfaketime**：
- 改真实系统时钟（`date` 命令）具破坏性、需要权限、影响同机其它进程/服务，成本与风险远超收益
- `libfaketime` 等 `LD_PRELOAD` 级方案需要新增外部依赖 + 平台相关的动态库加载配置（macOS 上 `DYLD_INSERT_LIBRARIES` 还受 SIP 限制），不符合"不引入新依赖"约束，且行为比 `TZ` 环境变量更难预测
- `TZ` 环境变量是 POSIX/Node 标准机制，零依赖、零权限、对 `Date.now()` 完全无副作用，恰好精准命中本 bug 的根因（`toLocaleDateString` 依赖本地时区解析），验证目标与验证手段一一对应

## 5. 不做什么

| 不做的事 | 理由 |
|---------|------|
| 改 `src/batch/batch-readme-generator.ts:49` 的日期格式（如改成 ISO 或固定格式） | README 本地化日期是面向用户的既有产品行为，与本 bug 无因果关系；为迁就测试改产品输出属本末倒置，违反"不自行添加未要求的改动" |
| 改 `src/panoramic/community/graph-report-generator.ts:49` 的裸 ISO 日期 | 当前不在任何快照冻结范围内（fix-report.md 已核验匹配数为 0），属"已知但当前不触发"的风险记录项，非本次 bug 的组成部分；提前处理是未要求的预防性改动 |
| 用 `vitest -u` 整体重录快照 | 会静默吸收批次两轮 `batch-summary-<TS>.md` 等其它潜在漂移，无法自证"零其它改动"；外科式定点替换 + §2 核验命令是唯一能证伪"改动面仅限日期"的路径 |
| 用 `vi.useFakeTimers` / `vi.setSystemTime` 冻结测试运行时钟 | 已被 fix-report.md 证伪：会连带冻结 `src/batch/stages/artifact-reporting.ts:54` 与 `batch-orchestrator.ts:534` 依赖的 `Date.now()`，导致场景6/7/8 两轮 batch 产出同名 `batch-summary` 文件、artifacts 清单从 2 条塌成 1 条，制造新的快照失配 |
| 把 `reportingArtifacts().readme` 降级为 hash/形状断言（fix-report 方案 B） | 会销毁 Codex G 审查 C2 明确要求的能力 —— README 全文冻结正是为了让 B7 搬迁的"空文件化/参数断线"现形；为躲一个日期废掉整条内容合同代价过大 |
| 系统性枚举并清洗所有非确定性来源（架构级重构 `scrubRuntimeNoise`） | 超出本次 fix 的最小变更范围；本次仅补齐已被实证命中的 `toLocaleDateString('zh-CN')` 形态缺口，架构性改造应作为独立 Feature 评估 |
| 修改其它 e2e / 集成测试快照 | 全仓检索确认 `\d{4}/\d{1,2}/\d{1,2}` 形态仅出现在本快照文件（§1 核验 3），无同源问题需要同步处理 |
| 更新 spec.md | fix-report.md 已判定"无需更新"：改动全部落在测试守护层，不触及产品行为面、公共 API 或生成产物合同 |
