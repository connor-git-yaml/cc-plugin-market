/**
 * ledger-reader.mjs
 * F270 P4 — Stop 侧读会话证据账本的**委派证据**（D-1 方向 X：账本只承担委派）。
 *
 * 职责边界：读账本 → 逐行解析（坏行跳过计数，FR-010）→ 去重（FR-048）→ 按 hookTs 窗口
 * 过滤（FR-013 归属窗口）→ 产出与 `extractDelegationsAfter` 同形的委派列表（source:'ledger'）。
 * **只产委派类**（Agent/Task）——见证、执行记录、锚点一律不碰（D-1）。
 *
 * 承重边界（对抗审查 C-3/必答① 登记，禁 over-claim）：
 * - 账本条目来自 PostToolUse 采集器，`tool_use_id`/`subagent_type` 均**被判方可经 Bash 写入**。
 *   委派证据的安全下界因此从「harness 背书的 transcript tool_use」降到「hook 记录 + 可事后改写」。
 *   本模块只提供"账本记了哪些委派"，是否采信、如何与 transcript 交叉由判定器按 FR-008 方向性
 *   优先裁决（账本只在 transcript 尾部缺证方向补充，矛盾时取更严一侧）。
 * - 去重键含 `subagent_type` **全值**（不截断）：截断相同的不同委派被误折叠会漏计（FR-048/delta W-6）。
 *
 * 零 I/O 之外的纯逻辑；读文件失败/不存在一律返回 LEDGER_ABSENT，绝不抛（判定器 FR-009 回退 transcript）。
 */

import fs from 'node:fs';
import { classifyDelegationRole } from './fix-compliance-core.mjs';
import { ledgerPathFor } from './ledger-writer.mjs';

/** 账本状态：缺席（文件不存在/不可读）vs 存在（可能含坏行） */
export const LEDGER_ABSENT = 'ledger-absent';
export const LEDGER_PRESENT = 'ledger-present';

/** 同 tool_use_id 但内容不一致的诊断码（FR-048） */
export const LEDGER_CORRUPT_ENTRY = 'ledger-entry-conflict';

/**
 * 上游翻转嫌疑诊断码（FR-021 后半）：账本里**每一条**委派都带 `agent_id`。
 * 正常会话中主线程至少派发过一次（否则不会有 fix 收口），故「一条主线程条目都没有」要么是
 * harness 翻转了 `agent_id` 语义（主线程也带），要么是账本只收到了子代理侧。两者都意味着
 * 归属判据的前提可能不再成立 —— 按 FR-021「MUST 落诊断而非静默改判」：**只落码，不改行为**。
 */
export const LEDGER_AGENT_ID_INVERSION = 'ledger-agent-id-inversion-suspected';

/** 窗口画不出来（latestFix 无 timestamp）→ 不用账本补充 */
export const LEDGER_WINDOW_UNDETERMINED = 'ledger-window-undetermined';

/** 账本补了 transcript 没有的角色（唯一有安全意义的补充事件，判定器侧 push） */
export const LEDGER_SUPPLEMENTED_ROLE = 'ledger-supplemented-role';

/**
 * 账本侧全部诊断码的**canonical 表**。新增码必须登记进此表，
 * 且必须同步 `specs/208-.../contracts/fix-compliance-verdict-event.schema.json` 的
 * diagnostics enum —— 后者由 `ledger-reader.test.mjs` 的合同用例**从本表派生**校验
 * （对抗 E WARNING-2：此前守卫是硬编码 4 元白名单，只能抓"删已知项"、抓不到"加新项漏登记"，
 * 而后者正是它声称要防的方向；与 `FOREIGN_DIALECT_DIAGNOSTICS` 的派生式同步用例同源纪律）。
 */
export const LEDGER_DIAGNOSTICS = Object.freeze({
  corruptEntry: LEDGER_CORRUPT_ENTRY,
  agentIdInversion: LEDGER_AGENT_ID_INVERSION,
  windowUndetermined: LEDGER_WINDOW_UNDETERMINED,
  supplementedRole: LEDGER_SUPPLEMENTED_ROLE,
});

/**
 * 委派工具名（与 core 的 DELEGATION_TOOL_NAMES 同口径，此处不 import 私有常量，硬编码两项）。
 * 导出供 hooks.json 的 matcher 同步守卫**派生**校验——matcher 收窄为 `Agent|Task` 后，
 * 两者失配会让账本静默漏采委派（对抗 E W-1 实测：改 matcher 零测试变红）。
 */
export const DELEGATION_TOOL_NAMES = new Set(['Agent', 'Task']);

/**
 * 读账本委派证据。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {{ sinceTs: string|null }} opts - sinceTs=latestFix 展开的 transcript timestamp；
 *   非空时只保留 hookTs >= sinceTs 的委派（FR-013 归属窗口）。
 *   🔴 sinceTs=null（latestFix 无 timestamp，如老 transcript 无 timestamp 字段）→ **窗口未定**，
 *   返回 `windowUndetermined:true` + 空委派。**不能**退回"全保留"（P4 对抗 WARNING-2）：多修复会话里
 *   fix#1 真派的 verify 会越过 fix#2 锚点补进 fix#2 的空 transcript → 坍塌会话被诚实数据跨周期洗白。
 *   保守方向是"窗口画不出来就不用账本补充"，由判定器退回纯 transcript（fail-closed 侧，不误放行）。
 * @returns {{ state:string, delegations:object[], corruptCount:number, diagnostics:string[], windowUndetermined:boolean }}
 */
export function readLedgerDelegations(projectRoot, sessionId, { sinceTs = null } = {}) {
  const filePath = ledgerPathFor(projectRoot, sessionId);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { state: LEDGER_ABSENT, delegations: [], corruptCount: 0, diagnostics: [], windowUndetermined: false };
  }
  if (sinceTs === null) {
    // 窗口画不出来 → 不用账本补充（对抗 WARNING-2：宁可退回 transcript 也不跨周期回流）
    return { state: LEDGER_PRESENT, delegations: [], corruptCount: 0, diagnostics: [LEDGER_WINDOW_UNDETERMINED], windowUndetermined: true };
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let corruptCount = 0;
  const diagnostics = [];
  // FR-021 翻转检测计量（统计在窗口过滤**之前**：翻转是账本整体属性，与证据窗口无关）
  let delegationSeen = 0;
  let subagentSkipped = 0;
  // 去重：key=tool_use_id → 首见条目的规范化内容指纹；再见时比对
  const seen = new Map();
  const ordered = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      corruptCount += 1; // FR-010：坏行跳过并计数，不使整本失效
      continue;
    }
    if (!entry || typeof entry !== 'object') { corruptCount += 1; continue; }
    if (entry.type === 'ledger-open') continue;          // 活性哨兵，非委派
    if (!DELEGATION_TOOL_NAMES.has(entry.tool_name)) continue;  // D-1：只委派类
    const id = typeof entry.tool_use_id === 'string' ? entry.tool_use_id : null;
    if (id === null) { corruptCount += 1; continue; }

    // 去重键含 subagent_type 全值（FR-048/delta W-6：不用截断摘要）
    const fingerprint = `${entry.tool_name} ${typeof entry.subagent_type === 'string' ? entry.subagent_type : ''}`;
    if (seen.has(id)) {
      if (seen.get(id) !== fingerprint && !diagnostics.includes(LEDGER_CORRUPT_ENTRY)) {
        diagnostics.push(LEDGER_CORRUPT_ENTRY); // 同 id 不同内容：可疑，落诊断（不静默取一）
      }
      continue; // 内容一致的重复静默折叠（hook 叠装/双注册，F264）
    }
    seen.set(id, fingerprint);

    // 🔴 FR-021 归属过滤（集成 review CRITICAL-1，实跑复现）：`agent_id` 键**整体缺席**＝主线程
    // （C-4 结构性判据，非启发式）；带非空串 `agent_id` ＝ 子代理内部派发。
    //
    // 为何必须剔除：PostToolUse 对子代理内部工具同样触发，且 `session_id` 与主线程**同值**
    // （P-2 直证）→ 整棵会话树写进同一本账本。不过滤则「主线程只派 general-purpose、由它在
    // 内部再派 implement/verify」被判成主线程走了两阶段收口，F208「禁止编排器行内修改」的
    // 语义在这一支上失效 —— 且**不需要伪造任何字节**，触发它的是本仓常规行为。
    //
    // transcript 侧天然无此问题：子代理的 tool_use 不进主 transcript。账本是新引入的证据面，
    // 归属过滤是它必须自带的对应约束。
    //
    // 🔴 判据是**键存在性**而非值形状（对抗 D WARNING-1 修订）。初版写成
    // `typeof === 'string' && length > 0`，与上一段注释自称的 C-4「键整体缺席＝主线程」不等价，
    // 且探针实测姊妹字段 `agent_type` 就是 `a ?? ""` 语义（空串而非缺席）——于是
    // `agent_id:""` / `agent_id:null` 两形都会漏过过滤，让 CRITICAL-1 的病灶原样复活，
    // 而翻转诊断挂的是 `subagentSkipped === delegationSeen`，在「一条都没命中」时**结构性
    // 不响**，等于新增了一个会静默退回病灶态的判据。
    //
    // 初版误引了 in-flight 三态的「形状异常不猜方向」纪律：那里的 undetermined 落在**保守**
    // 分支，而这里的「形状异常 ⇒ 按主线程保留」落在**放行**分支，方向恰好相反。
    //
    // 改存在性判定的安全上界已实证（对抗 D I-1）：账本是纯补充源、委派判定只做 `count >= 1`
    // 的单调判断，故「剔多了」的最坏后果 ＝ 等于没有账本 ＝ F270 之前的基线，**不会**产生
    // 高于基线的误阻断。宁可多剔，不可漏剔。
    delegationSeen += 1;
    if (Object.hasOwn(entry, 'agent_id')) {
      subagentSkipped += 1;
      continue;
    }

    // hookTs 窗口过滤（FR-013，此处 sinceTs 恒非 null——null 已在函数入口短路）。
    // 🔴 hookTs 缺省/非串 → 无法定位该条目在窗口内 → **保守剔除**（对抗 WARNING-2 同纪律：
    // 定位不了就不采信，而非无条件保留）。被判方自填 hookTs 过窗属已接受下界（D-1，只防疏忽）。
    //
    // ⚠️ 承重假设（P4 对抗 B 登记）：`hookTs < sinceTs` 是**两个独立来源**时间戳的裸字符串词法比较——
    // hookTs 由 ledger-writer 的 `new Date().toISOString()` 产（ISO8601 UTC-Z），sinceTs 是 transcript
    // entry 的 timestamp（Claude Code 客户端产，实测亦 ISO8601 UTC-Z，P-12）。二者**同构且词法可比**
    // 是此比较正确的前提。若未来 harness 改用偏移量形（`+00:00`）或异精度，词法序会错乱且无守卫。
    // 该假设由 tests 里一条格式断言钉住（见 ledger-reader.test「时间戳格式承重假设」）。
    const hookTs = typeof entry.hookTs === 'string' ? entry.hookTs : null;
    if (hookTs === null || hookTs < sinceTs) continue;

    const subagentType = typeof entry.subagent_type === 'string' ? entry.subagent_type : null;
    ordered.push({
      source: 'ledger',
      toolUseId: id,
      toolName: entry.tool_name,
      subagentType,
      description: null, // 采集器裁剪未存 description（D-1：只需 subagent_type 全值判角色）
      hookTs,
      roleClass: classifyDelegationRole(subagentType, null),
      // 🔴 必须**显式 false**，不能靠"不产"表达弃权（对抗 E CRITICAL-3 端到端证伪）：
      // 消费侧 `fix-compliance-core.mjs` 的判据是
      //   `d.noopVerify === true || (d.noopVerify === undefined && cls === 'verify')`
      // —— `undefined` 不是中立值，它恰好是**回退分支的触发条件**。于是"刻意不产"反而让
      // 每一条账本 verify 委派都被记进 `noopVerifyCount`，一行 JSONL 即可关掉 F216 的
      // `delegation:noop-verify` 要求（实测：无账本 missing 含该项 → 有账本即消失）。
      // D-1 方向 X 明确 F216 执行记录**不迁账本**、仍走 transcript；账本委派只回答"派了哪类
      // 子代理"（roleClass），对 no-op 问题弃权 —— 弃权在这里的正确编码就是 false。
      noopVerify: false,
    });
  }

  // FR-021 后半：全部委派都来自子代理 → 归属前提可疑。只落诊断，过滤行为逐字不变。
  if (delegationSeen > 0 && subagentSkipped === delegationSeen) {
    diagnostics.push(LEDGER_AGENT_ID_INVERSION);
  }

  return { state: LEDGER_PRESENT, delegations: ordered, corruptCount, diagnostics, windowUndetermined: false };
}
