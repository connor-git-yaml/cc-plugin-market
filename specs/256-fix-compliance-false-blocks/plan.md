# 修复规划 — fix 依从性判定器两处误报盲区

**输入**：`specs/256-fix-compliance-false-blocks/fix-report.md`（5-Why 根因、证据基线、推荐方案 A 已定稿）
**模式**：fix（精简规划，聚焦最小变更范围 + 回归风险评估 + 修复验证方案，不做完整架构设计）

## 1. Summary

按 fix-report.md 推荐的**方案 A（磁盘侧重锚定 + 在途第三态）**落地两处独立、正交的修复：

- **盲区 1**（judge 层新增磁盘兜底）：主候选磁盘不可用、且 F227 既有候选历史兜底也未命中时，
  按 short-name 在 `specs/` 下重新枚举同名不同编号的目录，命中且制品齐全者按最大编号采信。
- **盲区 2**（core 层新判定 + judge 层新路由分支）：新增"在途委派"纯函数判定，命中时把
  `runHook` 的裁决从"阻断/降级"改为"推迟（exit 0 + warn 级诊断 + 不消耗阻断预算）"。

两处改动均为**纯加法**：不修改 `resolveFeatureDirCandidate` 的状态机语义、不放宽
`scanRenameCommandEvents` 光杆命令白名单、不放宽 `VERIFY_ROLE_REGEX`，`DELEGATION_TOOL_NAMES`
不并入 `SendMessage`。这些均为 fix-report.md 已定论的"不采纳"边界，本规划严格遵守。

## 2. Codebase Reality Check（精简版）

| 文件 | LOC（现状） | 导出函数数 | 已知 debt |
|------|------|------|------|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 521 | 3（`parseArgs`/`buildFeedbackText`/`main`）+ 内部函数 | 无 TODO/FIXME；`evaluate()` 已承载 F224/F227 两轮历史兜底注释，本次是第三轮同类叠加，注释密度高但职责单一，不构成"需要先拆分再改"的债务 |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 1359 | 约 20 个（纯函数 + re-export） | 无 TODO/FIXME；行数虽 >500，但绝大部分是逐条对抗性 bug 的"why"级 JSDoc（F224/F227/F228/F229/F230/F231 教训记录），不是重复代码或超长函数债务——单个函数体量均 <120 行 |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | 346 | 约 12 个 | 无 TODO/FIXME、无重复逻辑 |

**前置清理规则复核**：`fix-compliance-core.mjs` 满足"LOC>500 且本次新增>50 行"的字面阈值
（本次预计新增约 110 行纯函数 + JSDoc）。但落地判断为**不新增 cleanup task**，理由：

1. 该文件的高行数是逐条安全论证 JSDoc 的历史累积（本仓库既定的"重复教训必须留痕"约定，
   见文件头 F231 段"本 Feature 的重复教训"），不是待偿还的代码坏味道；
2. 本次新增内容是与既有"委派抽取"（`extractDelegationsAfter`）平级的独立判定单元
   （"在途委派判定"），插入点明确、无需重排既有代码；
3. 运行时上下文已明确本次为 fix 模式精简规划，"不需要完整架构设计"；引入一次不相关的
   拆分重构会扩大本次修复的验证面（与 fix-report.md 影响范围扫描"类似模式（需评估）"
   一节"本次不改"的原则相悖）。

## 3. Impact Assessment

| 维度 | 结论 |
|------|------|
| 直接修改文件 | 3 个源码文件（judge.mjs / core.mjs / io.mjs）+ 2 个合同文件（schema.json / judge-cli.md）+ 3 个测试文件 = 8 |
| 间接受影响（调用方） | 仅 `hooks/stop-fix-compliance-check.sh`（纯退出码透传薄壳，逻辑不变，无需改动）；fix-report.md 已确认判定链路无其他外部调用方 |
| 跨包影响 | 0（全部改动落在 `plugins/spec-driver/` 内部，未跨 `plugins/`/`src/`/`scripts/` 顶层边界） |
| 数据迁移 | 无——审计事件仅新增一个诊断码枚举值（加法式扩展，历史事件文件无需回填/迁移） |
| API/契约变更 | `fix-compliance-verdict-event.schema.json` 新增 enum 值（非破坏性加法）；`evaluate()`/`runReport()` 返回对象新增 `inFlightDelegations` 字段（内部契约，仅本文件与测试消费）；core.mjs 新增 2 个导出函数、io.mjs 新增 1 个导出函数，均为纯加法，零签名变更 |
| 风险等级（机械判定） | 影响文件 8（<10）且跨包 0 → **LOW** |

**执行层面的谨慎加注**（不改变 LOW 判定，但影响交付节奏建议）：本判定链路（`resolveFeatureDirCandidate`
+ `runHook` 路由）历史上是本仓库事故率最高的子系统之一——F224/F227/F230/F231 四个独立 Feature
都在此反复因"看似安全的收紧/放宽"引入新的 fail-open 或 fail-closed 回归。因此即便量化风险落
LOW 档，仍建议实现阶段按"盲区 1（纯磁盘侧只读枚举，隔离性最强）→ 盲区 2（新判定路径 + 运行时
路由变更，风险相对更高）"顺序分两次提交验证，而非一次性合并，以便任一环节出问题时可独立回退。

## 4. 盲区 1 设计定稿：short-name 磁盘兜底

### 4.1 核心新增：`fix-compliance-core.mjs::extractFixShortName`

```js
/**
 * 从合法特性目录路径中抽取 short-name 段（F256 盲区 1：`specs/NNN-fix-<short>` 的 `<short>`）。
 * 仅接受已满足 FIX_DIR_NAME_REGEX 的路径；不满足时返回 null（不做启发式兜底/模糊提取）。
 * @param {string|null} dirPath
 * @returns {string|null}
 */
export function extractFixShortName(dirPath) {
  if (typeof dirPath !== 'string') return null;
  const match = /^specs\/\d+-fix-([a-z0-9-]+)\/?$/.exec(dirPath);
  return match ? match[1] : null;
}
```

放置位置：紧邻 `FIX_DIR_NAME_REGEX` 常量定义之后（同一语义分组）。纯字符串正则抽取，零 I/O，
符合 core 层"纯函数、不做磁盘判断"的分层契约。

### 4.2 核心新增：`fix-compliance-io.mjs::listFeatureDirCandidatesByShortName`

```js
/**
 * 按 short-name 枚举 `specs/` 下形如 `NNN-fix-<shortName>` 的目录（F256 盲区 1）。
 * 只读一层 `specs/` 目录项做字面量后缀比对，无递归、无 glob 引擎、非全仓扫描；
 * 目录项数量以 `specs/` 现有规模为界，单次调用是常数级磁盘 I/O。
 * 非抛出式：`specs/` 缺失/不可读均返回空数组。
 * @param {string} projectRoot
 * @param {string} shortName - 已由 extractFixShortName 抽取的 <short> 段
 * @returns {string[]} 匹配目录相对路径（`specs/NNN-fix-<shortName>`），按编号升序排列
 */
export function listFeatureDirCandidatesByShortName(projectRoot, shortName) {
  if (typeof shortName !== 'string' || shortName.length === 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(projectRoot, 'specs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const suffix = `-fix-${shortName}`;
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!name.endsWith(suffix)) continue;
    const numPart = name.slice(0, name.length - suffix.length);
    if (!/^\d+$/.test(numPart)) continue;
    matches.push({ num: Number(numPart), relPath: `specs/${name}` });
  }
  matches.sort((a, b) => a.num - b.num);
  return matches.map((m) => m.relPath);
}
```

**为何用字面量 `endsWith` + 数字前缀校验而非动态构造正则**：`shortName` 来自用户可控的 transcript
文本（虽已被 `FIX_DIR_NAME_REGEX` 约束为 `[a-z0-9-]+`），字符串操作天然规避正则元字符转义问题，
且更易人眼审计"是否可能误配"。已验证误配边界（如 `shortName="x"` 不会误配
`999-fix-decoy-x`/`1-fix-xx` 等相邻形态，见 §7 回归风险清单）。

### 4.3 judge.mjs `evaluate()` 集成点

在既有 F227 候选历史兜底循环**之后**追加一级，不改动循环体本身：

```js
const usable = (dir) => dir !== null && readArtifactFile(projectRoot, `${dir}/fix-report.md`).exists;
let resolvedPath = candidate.path;
if (candidate.ambiguous === false && !usable(resolvedPath)) {
  const history = Array.isArray(candidate.candidates) ? candidate.candidates : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (usable(history[i])) { resolvedPath = history[i]; break; }
  }
  // F256 盲区 1：F227 候选历史兜底仍未命中 + 原始主候选是明确的 specs/NNN-fix-<short> 形态时，
  // 按 short-name 在磁盘上重新枚举——覆盖 Feature 编号被复合命令（`cd ... && git mv A B && ...`）
  // 重编、而 F231 刻意不跟随复合命令改名事件的场景（fix-report.md Why 3/Why 4）。
  // 安全边界：仅当 candidate.path !== null 时才取 short-name——这确保 short-name 来自 transcript
  // 中一个明确被提名过的具体候选，而非从 ambiguous 状态或空候选反推，维持与 F227 相同的
  // "提名≠判据，磁盘核验才采信"原则。
  if (!usable(resolvedPath) && candidate.path !== null) {
    const shortName = extractFixShortName(candidate.path);
    if (shortName !== null) {
      const diskMatches = listFeatureDirCandidatesByShortName(projectRoot, shortName).filter(usable);
      if (diskMatches.length > 0) resolvedPath = diskMatches[diskMatches.length - 1]; // 编号最大者
    }
  }
}
```

**单调性论证**（沿用 F227 已确立的不变量，逐条复核）：
- `ambiguous === true` 时整段 `if` 不进入，F224 fail-open 降级通道逐字保持；
- 主候选可用时 `!usable(resolvedPath)` 为假，整段 `if` 体不执行，行为逐字不变；
- 主候选不可用但 F227 历史兜底已命中时，第二段 `if` 的 `!usable(resolvedPath)` 为假，
  短名兜底不执行；
- 只有"主候选不可用 + 历史兜底也未命中 + short-name 磁盘命中制品齐全目录"这一狭窄交集才会
  改变 `resolvedPath`，且只可能把"改动前阻断"转为"改动后放行"（`resolvedPath` 从 `null`/不存在
  变为一个磁盘上真实存在且含 `fix-report.md` 的目录），不产生新的误阻断。

**已知限界（如实登记，非本次消除）**：这把 F227「已知限界一」（冒用磁盘上已存在且制品齐全的
历史特性目录）从"必须精确提名该目录"放宽到"提名同 short-name 的任一编号"。fix-report.md 已判定
这是被接受限界的边际扩大而非新攻击面——冒用者直接提名目标目录即可达成同样效果，无需借道本兜底。

## 5. 盲区 2 设计定稿：在途委派 = 判定时机未到

### 5.1 三条检测规则的安全边界（关键设计决策，务必逐条遵守）

fix-report.md 给出的三条规则若照字面实现，**规则 1（同步委派无配对 tool_result）会与现有测试
体系产生严重冲突**：本仓库全部现有 fixture（F208/216/224/227/230/231/240 各测试文件）在构造
`TOOL_USE('Agent', {...})` 时**从不**附带对应的 `tool_result` 条目（因为委派抽取此前从不需要
tool_result）。若规则 1 不加限定地扫描"任意位置的未配对 Agent/Task 调用"，会把现有大量本该
`exit 2` 的既有阻断类测试误判为"在途"而降级为 `exit 0`，是一次隐蔽的大规模行为回归。

**收窄依据（语义上是必要的，不是权宜之计）**：同步 `Agent`/`Task` 调用会阻塞会话轮次直至
`tool_result` 返回——只要 transcript 中在该次调用之后还有任何后续条目，就足以证明它已经解决
（否则会话不可能继续产生新条目）。因此"真正在途"只可能发生在**整个 transcript 的最后一条
条目**上。据此将规则 1 收窄为：

> **规则 1（收窄版）**：只检查 `entries` 数组的最后一条条目。若它是 `assistant` 角色、
> 锚点之后、且其 `toolUseBlocks` 中最后一个 `Agent`/`Task`（非 `run_in_background`）调用
> 缺少同条目内的配对 `tool_result` → 判在途。

已对全仓库测试 fixture 做穷举核实（`Grep` 定位 `TOOL_USE\('(Agent|Task)', \{[^}]*\}\),\n\s*\]\);`
模式）：仅有**一处**命中"数组以裸 Agent 调用收尾"，且该用例走 `reportInProcess`（`--mode report`）
——不经过 `runHook`，不受本次改动影响。故收窄版规则 1 对现有全部 hook 模式用例**零回归**。

规则 2、3 因本仓库现有 fixture 中不存在 `run_in_background` 字段、也不存在 `SendMessage`
tool_use（已 `Grep` 确认），可按 fix-report.md 原始描述实现，无需额外收窄。

### 5.2 `<task-notification>` wire format 实测（不臆造，取自 fix-report.md 引用的真实 transcript）

```
<task-notification>
<task-id>ad602324a1dd9715a</task-id>
<tool-use-id>toolu_01JBaV47Pcvm1xPqVKkAJjTP</tool-use-id>
<output-file>...</output-file>
<status>completed</status>
<summary>...
<note>task-notification fires each time this agent stops with no live background children
of its own. The user can send it another message and resume it, so the same task-id may
notify more than once.</note>
<result>...</result>
</task-notification>
```

`<task-id>` 与 `<tool-use-id>` 恒相邻、恒同顺序出现，故可用单一锚定正则一次捕获两个分组，
无需解析完整 XML-like 结构。该文本块只从 **`role === 'user'` 的文本块**中提取（harness 注入，
模型无法伪造），与 `detectFixSkillExpansion` 的反伪造模型一致。

`SendMessage` 的 `to` 字段实测取自真实 transcript：`"name":"SendMessage","input":{"to":"ad602324a1dd9715a",...}`。

### 5.3 `fix-compliance-core.mjs` 新增常量与函数

```js
/** SendMessage 恢复后台子代理的工具名（F256 盲区 2）。刻意不并入 DELEGATION_TOOL_NAMES——
 * "派了工"(SendMessage 触发恢复) 与"收了工"(子代理完成收口) 是两个不同断言，把它计入委派会让
 * "派一条消息"直接顶替"验证闭环已完成"（fix-report.md 方案 B 不采纳理由）。本常量只用于识别
 * "在途"信号，不参与 judgeCompliance 的 delegationCounts。 */
const SEND_MESSAGE_TOOL_NAME = 'SendMessage';

/** <task-notification> 完成信号内 <task-id>/<tool-use-id> 配对提取（harness 注入的 user 文本块，
 * 模型无法伪造）。`[^<]+` 由下一个 `<` 天然止界，双分组单趟线性扫描，无嵌套量词、无回溯。 */
const TASK_NOTIFICATION_PAIR_REGEX = /<task-id>([^<]+)<\/task-id>\s*<tool-use-id>([^<]+)<\/tool-use-id>/g;

// ────────────────────────────────────────
// 在途委派判定（F256 盲区 2：判定时机未到）
// ────────────────────────────────────────

/** 尾部未消费的同步委派——安全边界见 §5.1 收窄论证，仅检查 entries 最后一条条目。 */
function findTrailingUnresolvedSyncDelegation(entries, anchor) {
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1];
  if (!last || last.role !== 'assistant' || last.lineIndex <= anchor) return null;
  let target = null;
  for (const block of last.toolUseBlocks) {
    if (!DELEGATION_TOOL_NAMES.has(block.name)) continue;
    if (block.input && block.input.run_in_background === true) continue;
    target = block;
  }
  if (!target || !target.id) return null;
  const resolved = last.toolResultBlocks.some((r) => r.toolUseId === target.id);
  return resolved ? null : { kind: 'sync', id: target.id, lineIndex: last.lineIndex };
}

/** 后台 Agent/Task（run_in_background===true）尚未收到匹配 <tool-use-id> 完成通知者。 */
function findPendingBackgroundDelegations(entries, anchor, notifications) {
  const pending = [];
  for (const entry of entries) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (!DELEGATION_TOOL_NAMES.has(block.name)) continue;
      if (!block.input || block.input.run_in_background !== true || !block.id) continue;
      const done = notifications.some((n) => n.toolUseId === block.id);
      if (!done) pending.push({ kind: 'background', id: block.id, lineIndex: entry.lineIndex });
    }
  }
  return pending;
}

/** SendMessage(to: A) 最后一次派发晚于 A 最后一次 <task-id> 通知者。有效性门槛：仅计入自身已
 * 获得非错误 tool_result 回执的派发——防止伪造/失败的 SendMessage 调用凭空制造"永久在途"逃逸面
 * （deferred 不是 exempted 语义的必要补强，fix-report.md 未列举、本次新增的对抗性边界）。 */
function findPendingSendMessageResumptions(entries, anchor, notifications, resultByToolUseId) {
  const lastDispatchByAgent = new Map();
  for (const entry of entries) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (block.name !== SEND_MESSAGE_TOOL_NAME) continue;
      const to = block.input && typeof block.input.to === 'string' ? block.input.to : null;
      if (!to || !block.id) continue;
      const result = resultByToolUseId.get(block.id);
      if (!result || result.isError === true) continue; // 无回执/回执报错 → 不计入派发
      const prev = lastDispatchByAgent.get(to);
      if (!prev || entry.lineIndex > prev) lastDispatchByAgent.set(to, entry.lineIndex);
    }
  }
  const lastNoteByAgent = new Map();
  for (const n of notifications) {
    const prev = lastNoteByAgent.get(n.taskId);
    if (!prev || n.lineIndex > prev) lastNoteByAgent.set(n.taskId, n.lineIndex);
  }
  const pending = [];
  for (const [agentId, dispatchLine] of lastDispatchByAgent) {
    const noteLine = lastNoteByAgent.get(agentId) ?? -1;
    if (dispatchLine > noteLine) pending.push({ kind: 'send-message', id: agentId, lineIndex: dispatchLine });
  }
  return pending;
}

/**
 * 抽取锚点之后的"在途委派"——判定时机未到的第三态（fix-report.md 盲区 2 Root Cause：
 * stop 并非恒为终态）。三条规则详见 §5.1/fix-report.md「检测判据」，本函数是其纯函数化实现，零 I/O。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ kind:'sync'|'background'|'send-message', id:string, lineIndex:number }[]}
 */
export function extractInFlightDelegationsAfter(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;

  const notifications = [];
  const resultByToolUseId = new Map();
  for (const entry of list) {
    if (!entry) continue;
    if (entry.role === 'user' && entry.lineIndex > anchor) {
      for (const text of entry.textBlocks) {
        TASK_NOTIFICATION_PAIR_REGEX.lastIndex = 0;
        let m;
        while ((m = TASK_NOTIFICATION_PAIR_REGEX.exec(text)) !== null) {
          notifications.push({ taskId: m[1], toolUseId: m[2], lineIndex: entry.lineIndex });
        }
      }
    }
    for (const r of entry.toolResultBlocks) {
      if (typeof r.toolUseId === 'string') {
        resultByToolUseId.set(r.toolUseId, { isError: r.isError, lineIndex: entry.lineIndex });
      }
    }
  }

  const items = [];
  const trailing = findTrailingUnresolvedSyncDelegation(list, anchor);
  if (trailing) items.push(trailing);
  items.push(...findPendingBackgroundDelegations(list, anchor, notifications));
  items.push(...findPendingSendMessageResumptions(list, anchor, notifications, resultByToolUseId));
  return items;
}
```

放置位置：紧接 `extractDelegationsAfter` 之后，独立分节标题"在途委派判定（F256 盲区 2）"。

### 5.4 judge.mjs 集成点

**`evaluate()` 末尾**（复用已解析的 `entries`/`anchor.anchorLineIndex`，零额外磁盘/transcript 读取）：

```js
const inFlightDelegations = extractInFlightDelegationsAfter(entries, anchor.anchorLineIndex);
return {
  enforcement, configDegraded, isFix: true, mode: anchor.mode,
  transcriptDiagnostics: [], verdict, inFlightDelegations,
};
```

**`runHook()` 插入位置**：在 `result.verdict.compliant` 早退分支**之后**、
`result.enforcement === 'warn'` 分支**之前**——对 `block` 与 `warn` 两档一视同仁生效
（`warn` 档虽然本就 exit 0，但插入点之前会写一条"普通不合规 warn"审计事件，语义上把"时机未到"
误记为"真实不合规"；插入到分支之前可以让两档都得到准确的 `delegation-in-flight` 诊断标注，
不引入行为差异，仅提升审计准确性）：

```js
function runHook(projectRoot, payload) {
  const cfg = findAndParseConfig(projectRoot);
  if (cfg.enforcement === 'off') return 0;

  const result = evaluate(projectRoot, payload.transcript_path, cfg);

  if (result.transcriptDiagnostics.length > 0) { /* 不变 */ return 0; }
  if (!result.isFix || !result.verdict) return 0;
  if (result.verdict.compliant) { resetBlockState(projectRoot, payload.session_id); return 0; }

  const sessionId = payload.session_id;

  // F256 盲区 2：判定时机未到——在途委派存在时推迟判定，不进阻断/降级路由，不消耗阻断预算。
  // 放行=推迟不是豁免：每个在途委派最终都会回收通知，届时再次 stop 会拿到完整证据重新裁决。
  if (Array.isArray(result.inFlightDelegations) && result.inFlightDelegations.length > 0) {
    appendAuditEvent(projectRoot, buildAuditEvent({
      sessionId, enforcement: result.enforcement, verdict: result.verdict,
      blockCount: null, degraded: false, extraDiagnostics: ['delegation-in-flight'],
    }));
    process.stderr.write(`${PREFIX_WARN} ${buildFeedbackText(result.verdict.missing, { diagnostics: ['delegation-in-flight'] })}\n`);
    return 0;
  }

  if (result.enforcement === 'warn') { /* 不变 */ }
  return routeBlock(projectRoot, sessionId, result.verdict);
}
```

复用既有 `PREFIX_WARN` 前缀，不新增前缀常量——本路径的退出码/阻塞语义与既有 warn 档完全一致
（exit 0、非阻断），差异仅在于**审计事件的 diagnostics 字段**携带 `delegation-in-flight`，
供事后审计区分"真实不合规"与"证据尚未到齐"。

**`runReport()`**：追加 `inFlightDelegations: result.inFlightDelegations || []` 到输出 JSON，
供 `--mode report` 端到端复现用例断言。

### 5.5 gaming 边界（本次新增，fix-report.md 未列举）

若不对 `SendMessage` 派发施加"必须获得非错误 `tool_result` 回执"的门槛，存在理论上的逃逸面：
向一个虚构 `to` 反复发送 `SendMessage` 即可让 `runHook` 永久判"在途"、永不进入阻断路由。
门槛收窄后，攻击者至少需要真实调用一次成功的 `SendMessage`（获得 harness 落地的非错误
`tool_result`），且该目标 agent 最终仍会在完成对新消息的响应后产生新的 `task-notification`
（per 实测 `<note>` 语义：同一 `task-id` 可多次通知）。残余限界（如实登记）：若攻击者持续向一个
**真实存在但恒不产出响应**的 agent 重复派发，理论上仍可无限期推迟。这与 F227「已知限界一」
同属"判定器无法从 transcript 文本推断意图"的同类残余面，不在本次消除范围。

## 6. 合同同步点

### 6.1 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`

`diagnostics.items.enum` 数组追加一项 `"delegation-in-flight"`（置于现有末项
`"dialect:codex-rollout"` 之后）。

### 6.2 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md`

在退出码场景表追加一行（真实新增的独立分支）：

| 场景 | 退出码 | stdout | stderr |
|------|--------|--------|--------|
| `enforcement=block` 或 `warn` 且不合规，但检出**在途委派**（判定时机未到，见 data-model 在途判据） | 0 | （空） | `[FIX-COMPLIANCE][WARN] {反馈文本 + 诊断: delegation-in-flight}` |

并在"特性目录"相关说明处追加一段脚注（盲区 1 不产生独立退出码分支，是既有"合规收口"行的
前置解析扩展）：

> F256：当 transcript 提名的主候选目录在磁盘上不可用、且既有候选历史回溯（F227）也未命中时，
> 判定器会按 short-name 在 `specs/` 下重新枚举匹配的 `NNN-fix-<short-name>` 目录（见
> `fix-compliance-core.mjs::extractFixShortName` / `fix-compliance-io.mjs::listFeatureDirCandidatesByShortName`），
> 命中且制品齐全时按该目录继续判定。命中结果仍落在上表既有分支（通常是"合规收口"），不产生新退出码分支。

## 7. 回归风险清单

| 既有断言/测试文件 | 风险点 | 结论 |
|---|---|---|
| `fix-compliance-core.test.mjs` 全部既有用例 | 新增导出函数是否影响既有函数 | 纯加法，零改动既有函数体，零风险 |
| `fix-compliance-io.test.mjs` 全部既有用例 | 新增导出函数是否影响既有函数 | 同上 |
| `fix-compliance-judge-cli.test.mjs`：F208/216/224/227/230/231/240 各 `runCli(...)`（hook 模式）用例 | 规则 1（同步委派未配对 tool_result）若不收窄会把大量既有阻断用例误判为在途 | 已用 `Grep` 穷举核实：全仓库仅一处"数组以裸 Agent 调用收尾"，且属 `--mode report` 用例（不经 `runHook`）；规则 1 收窄为"仅检查最后一条条目"后，对现有全部 hook 模式用例回归面为 **0** |
| 同上：涉及 `run_in_background` / `SendMessage` 的用例 | 规则 2/3 是否已有覆盖面 | `Grep` 确认全仓库零现有 fixture 使用这两个字段/工具名，规则 2/3 对现状零介入 |
| `it('主候选不可用 + 历史候选全不可用 → 完全回落现状...')`（约 L1053） | 盲区 1 短名兜底是否会在"磁盘无任何 specs 目录"场景下意外命中 | `listFeatureDirCandidatesByShortName` 对 `specs/` 不存在时走 `catch` 返回 `[]`，短名兜底空转，`resolvedPath` 保持不变，断言逐字不变 |
| `describe('F227 real transcript re-verification...')`（`--mode report`，`--project-root REPO_ROOT`） | `evaluate()` 对 hook/report 两模式共用，盲区 1 新代码会在真实仓库 `specs/`（260+ 目录）上执行 | 已核实：两条现有用例（全量 + head-526 截断）的候选在**既有** F227 历史兜底阶段即已解析为真实存在的 `specs/225-fix-compound-command-hijack`（`usable()` 为真），本次新增代码块的外层 `if (!usable(resolvedPath) ...)` 不会进入，零交互；建议实现阶段若本机存在该真实 transcript 文件，显式重跑这两条用例做实证复核（而非仅凭静态分析） |
| `it('单调性不变量：ambiguous=true + 历史候选可用 → 兜底零介入...')` | 盲区 1 新代码是否会打破 ambiguous=true 时"零介入"的既有断言 | 新代码块整体嵌套在 `if (candidate.ambiguous === false ...)` 内，`ambiguous===true` 时连外层判断都不会进入，逐字不变 |
| 合同同步用例（`合同同步：方言诊断码从 FOREIGN_DIALECT_DIAGNOSTICS 派生...`） | 新增诊断码是否需要同类合同同步守卫 | 追加一条独立断言 `registered.has('delegation-in-flight')`（见 §8.4），不改动既有 `FOREIGN_DIALECT_DIAGNOSTICS` 遍历逻辑 |

**结论**：两处修复设计上均满足"只可能把改动前阻断转为改动后放行，不产生新阻断"的单调性约束，
且已对现有测试体系做穷举式碰撞核查，理论回归面为 0。§8 的验证方案要求用**实际跑批**（而非仅
静态分析）确认这一结论。

## 8. 验证方案

1. **单元测试新增**（`fix-compliance-core.test.mjs`）：
   - `extractFixShortName`：合法路径提取正确；非法路径（缺 `fix-` 段/含大写/纯数字目录名）返回 `null`
   - `extractInFlightDelegationsAfter` 三规则各自阳性/阴性用例：
     - 规则 1 阳性：transcript 以裸 `Agent`/`Task` tool_use 收尾且无配对 tool_result → 命中
     - 规则 1 阴性（安全边界回归钉子）：同样的未配对 tool_use，但其后还有任意后续条目 → 不命中
     - 规则 2 阳性/阴性：`run_in_background:true` 有/无匹配 `<tool-use-id>` 通知
     - 规则 3 阳性/阴性：`SendMessage` 派发晚于/早于对应 `<task-id>` 通知；派发缺少非错误 `tool_result` 回执时不计入（gaming 边界用例）
   - 性能/无回溯用例：大量噪声 `<task-notification>` 文本下的线性时间断言（遵循仓库既有
     `fix-compliance-core.test.mjs` 的 F227/F231 perf 回归锚点惯例）

2. **单元测试新增**（`fix-compliance-io.test.mjs`）：
   - `listFeatureDirCandidatesByShortName`：命中单个/多个候选（含编号排序正确性）、`specs/` 缺失、
     子串误配边界（如 `shortName='x'` 不误配 `999-fix-decoy-x`/`1-fix-xx`）

3. **端到端复现用例新增**（`fix-compliance-judge-cli.test.mjs`，hook 模式）：
   - 盲区 1：transcript 经复合命令 `cd ... && git mv specs/251-fix-foo specs/254-fix-foo && ...`
     提名 `specs/251-fix-foo`（改名跟随判据不认复合命令，候选停留旧路径），磁盘仅存在
     `specs/254-fix-foo`（制品齐全）→ 断言 `runCli()` exit 0 且不落阻断审计事件
   - 盲区 2：`Agent` 委派获得 `tool_result`（含 `agentId`）→ `SendMessage(to: agentId)` 获得非错误
     `tool_result` ack → 无后续 `<task-notification>` → 断言 `runCli()` exit 0、stderr 含
     `[FIX-COMPLIANCE][WARN]` 与 `诊断: delegation-in-flight`、审计事件 `diagnostics` 含
     `delegation-in-flight`、且阻断计数状态文件未被创建/未递增（阻断预算未消耗）
   - 若本机存在 fix-report.md 引用的真实 F254 transcript（`~/.claude/projects/.../f3f2fe3b-....jsonl`），
     沿用既有 `F227_REAL_TRANSCRIPT` 的 `t.existsSync` + `t.skip` 先例，做 6 个历史 stop 时间戳
     截断回放，断言与 fix-report.md「检测判据」表格逐行一致（3 次命中在途、3 次不命中）

4. **合同同步守卫新增**：在既有"合同同步：方言诊断码..."用例旁追加一条，断言
   `fix-compliance-verdict-event.schema.json` 的 `diagnostics.items.enum` 含 `'delegation-in-flight'`

5. **全量回归门禁**（提交前必跑，零失败）：
   ```bash
   node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
   node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs
   node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
   npx vitest run
   npm run build
   npm run repo:check
   ```

6. **Codex 对抗审查**（按 CLAUDE.local.md 约定，plan/implement 各阶段提交前必跑）：重点复核
   §5.1 的规则 1 收窄边界是否真的零回归、§5.5 的 gaming 边界是否有遗漏的逃逸构造。

7. **版本同步**（如实现阶段确认改动落地）：本次为插件源码 bugfix，按 SemVer 属 patch 级；
   更新 `contracts/release-contract.yaml` 后跑 `npm run release:sync` + `npm run release:check`。

## 9. Out of scope（本次明确不做）

与 fix-report.md「类似模式（需评估）」一节结论一致，以下均**不在本次修复范围**：

- 不放宽 `scanRenameCommandEvents` 的光杆命令白名单（F231 十余轮对抗后刻意关闭的方向）
- 不放宽 `VERIFY_ROLE_REGEX`（角色词表宽度取舍，与两处盲区无因果关系，应独立立项）
- 不修改 F227 `usable()` 兜底的既有语义（本次新兜底串接其后，不改其行为）
- 不处理 F227「已知限界二」（transcript 中伪造 `mv` 文本触发 `ambiguous=true` fail-open）——
  已另开独立跟进项，本次两处修复均不涉及该分支
