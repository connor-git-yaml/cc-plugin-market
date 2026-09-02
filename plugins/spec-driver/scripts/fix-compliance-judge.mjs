#!/usr/bin/env node

/**
 * fix-compliance-judge.mjs
 * Feature 208 — fix 模式流程依从性判定 CLI 编排入口（唯一由 hooks.json 挂载的生产路径）
 *
 * 分层契约（research.md D3）：本文件是 I/O 编排层，负责
 *   解析参数与 stdin payload → 编排 io 层读取（config/transcript/state）→ 调用 core 纯函数判定
 *   → 编排 io 层写入（审计事件 / 阻断计数 / 降级放行的 record-workflow-run 终态事件）
 *   → 决定退出码与 stderr 反馈文本。
 *
 * 不变量（contracts/fix-compliance-judge-cli.md）：
 *   - 零 LLM / 零子代理委派：全程无 `Task(` / 模型 API 调用。
 *   - 顶层 try/catch 兜底（FR-013）：任何未捕获异常在 hook 模式下转化为 exit 0，不泄漏崩溃退出码。
 *   - `--mode report` 恒 exit 0、只打印 verdict JSON、零落盘副作用。
 *   - 不读取任务 ID / 任务描述文本作为判据（FR-011）。
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import {
  detectFixSkillExpansion,
  detectTranscriptDialect,
  FOREIGN_DIALECT_DIAGNOSTICS,
  extractDelegationsAfter,
  extractInFlightDelegationsAfter,
  isDeferrableMissingSet,
  extractFixShortName,
  collectArtifactWriteWitnessDirs,
  countAssistantEntriesSinceEarliestFixExpansion,
  countStorageUnavailableBlockFeedback,
  STORAGE_UNAVAILABLE_FEEDBACK_TOKEN,
  resolveFeatureDirCandidate,
  classifyClosureForm,
  extractExecutionRecordsAfter,
  judgeCompliance,
  MISSING_ACTION_TEXT,
  DUAL_PATH_GUIDANCE,
  GATE_DEGRADED_PREFIX_LINE,
} from './lib/fix-compliance-core.mjs';
import {
  readHookPayload,
  readTranscriptEntries,
  findAndParseConfig,
  appendAuditEvent,
  checkFeatureDirOnDisk,
  listFeatureDirCandidatesByShortName,
  readArtifactFile,
  loadBlockState,
  saveBlockState,
  resetBlockState,
} from './lib/fix-compliance-io.mjs';
import { classifyInFlightFromPayload, IN_FLIGHT_STATES } from './lib/in-flight-verdict.mjs';
import { readLedgerDelegations, LEDGER_ABSENT, LEDGER_SUPPLEMENTED_ROLE } from './lib/ledger-reader.mjs';
import { recordWorkflowRun } from './record-workflow-run.mjs';

/** stderr 反馈前缀（FR-010，与既有 stop-task-check.sh 的 `[提醒]` 相区分） */
const PREFIX_BLOCK = '[FIX-COMPLIANCE]';
const PREFIX_WARN = '[FIX-COMPLIANCE][WARN]';
const PREFIX_DEGRADED = '[FIX-COMPLIANCE][GATE-DEGRADED]';

/** 会话内不合规阻断上限（FR-006）：达到后降级放行 */
export const BLOCK_LIMIT = 2;

/**
 * 会话内"在途推迟"次数上限（F256 第 2 轮 CRITICAL-1b）：达到后不再推迟，恢复正常裁决。
 *
 * why 必须有界：推迟的安全性原本论证为"每个在途委派最终都会回收通知，届时在途集合已空"，
 * 该前提**已被实测证伪**——本机 2466 份 transcript 中 202 次后台派发有 43 次（21.3%）
 * 回执正常但完成通知从未到达。无界推迟等于给出一条自然发生率就有两成的永久放行通道。
 *
 * why 取 3：与 BLOCK_LIMIT=2 同源的"给足补救余量再收口"取向，且须覆盖真实在途停顿——
 * 本 Feature 取证的 F254 交付会话共 3 次 stop 命中在途（见 fix-report.md「检测判据」表的签名 B
 * 三行，测试以截断回放逐行钉死），取 3 恰好覆盖该实况。上限之外，"永不回收"的委派最多推迟
 * 3 次即恢复裁决——加上 BLOCK_LIMIT 的 2 次阻断，单会话最坏路径仍在有限步内收敛。
 * 刻意与 blockCount **分列计数**：推迟不消耗阻断预算，否则在途停顿会白白烧掉阻断额度，
 * 使真正需要阻断时已降级放行。
 */
const IN_FLIGHT_DEFER_LIMIT = 3;

/**
 * 闸门三：自**最早**一次 fix 技能展开之后允许的 assistant **entry** 上限（F257 缺陷 2）。
 *
 * why 需要第三道闸门：`IN_FLIGHT_DEFER_LIMIT`（闸门二）的唯一上界存放在
 * `.specify/runs/.fix-compliance-state/<sessionId>.json`——该目录在 projectRoot 下、被 gitignore、
 * 属"本地运行态"，`loadBlockState` 对缺失/损坏一律静默回落 0。实测：每轮 stop 前先 `rm -rf` 该目录，
 * 10 轮全部 exit 0、审计 `degraded=false`、终态记录 0 条，形成"永不裁决"的静默通道；且它比既有
 * blockCount 篡改杠杆更安静（推迟只打 `[WARN]`，事后审计看起来像"还有子代理在跑"）。
 * 本常量与闸门二**并联取严**，计量源派生自 transcript，被判方不经手写入、只增不减，`rm -rf` 抹不掉。
 *
 * 🔴 语义：**这不是"等待多久算超时"，而是"会话长度已异常，不再给推迟通道"**。
 * 后人若按"在途等待时长"去调它，会把一个会话长度阈值误当成超时阈值。
 *
 * 🔴 单位是 assistant **entry**，不是"轮"：wire format 里一次助手轮常拆成多条 assistant envelope
 * （文本一条、每个 tool_use 一条），"轮"没有稳定边界。常量名与诊断码一律按 entry 表述。
 *
 * 🔴 名字里的 `EARLIEST_FIX_` 是承重的，不是修饰：它指向本常量实际比较的那个量的**基线**
 * （`earliestFixLineIndex` / `assistantEntriesSinceEarliestFix`，即**最早**一次 fix 展开）。
 * 本常量第 4 轮前叫 `POST_ANCHOR_ENTRY_DEFER_LIMIT`——`POST_ANCHOR_` 指向的是判定**主锚点**
 * （`anchorLineIndex`，**最晚**一次展开），而那正是已被实测证伪的错误语义：以最晚锚点为基线时
 * 攻击组每轮重新 `Skill(spec-driver-fix)` 展开即可令计数归零，30/30 全 exit 0。
 * 即旧名精确地指向了攻击者想要的实现，顺着名字理解就会把修复改回去。**不要改回去。**
 *
 * why 取 420：真实语料标定。
 *
 * ⚠️ 本段前身版本写的是 `P75=76 / P99=409 / max=647`、并称"420 覆盖 P99"——**那组数字取自旧口径
 * （以最晚锚点 `anchorLineIndex` 为基线的"锚点后计数"），与本常量实际比较的量不是同一个**，
 * 结论因此偏乐观。第 4 轮审查以 `countAssistantEntriesSinceEarliestFixExpansion`（**实际生效的口径**）
 * 在同一语料重取数，已由两方独立复现，逐位一致：
 *   新口径（实际生效）：`N=149 / P50=61 / P75=77 / P90=244 / P95=286 / P99=647 / max=801 / min=1`
 *   旧口径（注释前身写的那组，仅存档对照）：`P50=61 / P75=76 / P90=244 / P95=286 / P99=409 / max=647`
 *
 * 故如实表述是：**420 落在约 P98.7**（149 份里 147 份 < 420，2 份越阈），**不是"覆盖 P99"**。
 *
 * why 明知落在 P98.7 仍**不上调**：按新口径 P99=647 抬到 660，会让"约 140 轮内免于裁决"变成
 * 约 220 轮，闸门被显著削弱；而两份越阈会话经复算**都不因此受实际影响**——
 *   · 801 那份：`missing=[feature-dir, fix-report.md]`，不属可推迟集合，闸门一先行拦下，本就不走推迟通道；
 *   · 647 那份：`compliant=true`，在推迟闸门之前就已合规早退。
 * 且越阈代价本身有界（见下条）。收益远小于代价，故取值维持 420 不动。
 *
 * ⚠️ 标定语料是**活的**：分位数会随会话增长持续漂移——上一轮记录的 `max=647` 在本轮已被 801 超过。
 * 后人复核时应重跑取数，不要把本段数字当作静态事实；同时它仍是单机 149 份样本，而本常量随 plugin
 * 发版进入所有用户环境，外推有效性未经验证。
 *
 * 被否的两个候选（按新口径复核）：占位值 200 低于 P90=244，会误伤 11.4%（17/149）真实会话；
 * 原公式值 620 相当于允许约 200 轮持续绕过，"有界"字面成立而工程意义上接近无界，
 * 且它在新口径下也**并非零误伤**（≥620 者同为 2 份），花掉的宽度换不到误伤面的改善。
 *
 * why 越界代价有界：越过阈值只是**不推迟、照常裁决**——若判不合规，最多阻断 2 次即触达
 * `BLOCK_LIMIT` 降级放行，会话不会卡死；若确有在途工作，被判方在下次 stop 前补齐制品即恢复。
 * 故阈值即使偏小，失效方向也是可自愈的 fail-closed。
 *
 * 如实登记的边界（禁止读成"消除"）：本闸门**不消除**"删状态文件绕过闸门二"这一手法本身，
 * 只给它加了一条抹不掉的天花板——把「**永久**免于裁决」降级为「约 140 轮内免于裁决」。
 */
export const EARLIEST_FIX_ENTRY_DEFER_LIMIT = 420;

// ────────────────────────────────────────
// 参数解析
// ────────────────────────────────────────

export function parseArgs(argv) {
  const args = { mode: 'hook', projectRoot: process.cwd(), transcriptPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--mode') {
      args.mode = argv[i + 1] ?? args.mode;
      i += 1;
    } else if (token === '--project-root') {
      args.projectRoot = argv[i + 1] ?? args.projectRoot;
      i += 1;
    } else if (token === '--transcript-path') {
      args.transcriptPath = argv[i + 1] ?? args.transcriptPath;
      i += 1;
    }
  }
  if (args.mode !== 'hook' && args.mode !== 'report') args.mode = 'hook';
  return args;
}

// ────────────────────────────────────────
// stdin 读取（同步，避免异步竞态；hook payload 体量极小）
// ────────────────────────────────────────

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ────────────────────────────────────────
// 判定编排（纯读取，不落盘；hook 与 report 共用）
// ────────────────────────────────────────

/**
 * 编排一次完整判定：读配置 → 读 transcript → 锚定 → 抽取委派/制品 → core 判定。
 * @returns {{
 *   enforcement:string, configDegraded:boolean,
 *   isFix:boolean, mode:string|null,
 *   transcriptDiagnostics:string[],
 *   verdict:object|null,
 *   inFlightDelegations?:{kind:string,id:string,lineIndex:number}[],
 *   assistantEntriesSinceEarliestFix?:number,
 * }}
 */
function evaluate(projectRoot, transcriptPath, cfg = null, sessionId = null) {
  const config = cfg || findAndParseConfig(projectRoot);
  const enforcement = config.enforcement;
  const configDegraded = config.configDegraded;
  const configDiagnostics = config.diagnostics || [];

  const { entries, diagnostics: transcriptDiagnostics } = readTranscriptEntries(transcriptPath);
  if (transcriptDiagnostics.length > 0) {
    // transcript 不可用/超限 → FR-013 fail-open（无法得出判定结论）
    return {
      enforcement, configDegraded, isFix: false, mode: null,
      transcriptDiagnostics, verdict: null,
    };
  }
  if (entries.length === 0) {
    // F270 P2b（FR-045 / F257 N1 收口）：文件存在但零条目 ≠ "非 fix 会话"，是"无法判定"。
    // 原实现走 isFix=false 静默零落盘早退——从这条路径出去的会话事后完全不可见（A-3 审计黑洞）。
    // 改走既有 fail-open loud 路径：仍放行（无法判定不阻断），但独立诊断码 + hook 侧落盘，
    // 与 transcript-unavailable 同族。不违反 US5：空文件是异常态，不是健康路径的常规形态。
    return {
      enforcement, configDegraded, isFix: false, mode: null,
      transcriptDiagnostics: ['transcript-empty'], verdict: null,
    };
  }

  const anchor = detectFixSkillExpansion(entries);
  // F270 P2（病根 iv）：isFix 改**存在性**判据——transcript 内曾出现过 `spec-driver-fix` 字面
  // 展开即按 fix 判定。原判据 `anchor.mode === 'fix'` 用"最晚任意展开的 mode"，会话尾部展开一次
  // sync/doc 即整体跳过 fix 判定且零落盘（--mode report 实测复现：R-1，两行文本 fixSession true→false）。
  // anchor.mode 仍如实报最晚任意展开（诊断语义不变）。
  //
  // 🔴 本判据封的是**会话内 fix 展开被后续非 fix 展开顶掉**这一支，**不封**以下既有能力边界
  // （改动前 `mode==='fix'` 判据同样放行这些，非本卡引入——如实登记，勿读作"病根 iv 全闭合"）：
  //   - resume 入口：`/spec-driver:spec-driver-resume` 承接 fix 委派链，其 transcript 只含
  //     `skills/spec-driver-resume` 字面展开、无 `spec-driver-fix` → earliestFix=null → 不判定。
  //   - fix 展开发生在子代理 sidechain（主 transcript 不可见）/ 跨会话续做（只看当前 transcript）。
  //   真正收口需把 resume 纳入 fix 家族基线 + 二级信号（窗口内 `specs/NNN-fix-*` 提名，否则
  //   feature/story 的 resume 会被误判成 fix 合同大面积误阻断）——范围超出本卡 D-1，分流跟进。
  //
  // ⚠️ 存在性判据的**对称代价**（本卡新引入的误阻断类，spec FR-023 已承认为已知代价）：同一会话
  //   先展开一次 fix（哪怕中途放弃、零制品）再跑 feature/story/implement，isFix 恒 true → 按 fix
  //   合同判 → missing 非空 → 阻断。原 `mode==='fix'` 判据（尾部展开即释放）无此形态。方向 fail-closed、
  //   可自愈（补齐 fix 制品或 BLOCK_LIMIT=2 兜底降级），但属新增误阻断类，按 F256「类 X」纪律登记。
  const isFix = anchor.earliestFixLineIndex !== null;
  if (!isFix) {
    // F240 FR-004：区分"确实不是 fix 会话"与"这份 transcript 我根本解析不了"。
    //
    // 谓词只认**正向识别**成功的异构方言（FOREIGN_DIALECT_DIAGNOSTICS 的键集）。'unknown'
    // 刻意不入表：它是开放世界的否定（"我不认识"），而两份 role 清单都非穷尽——实扫本机
    // 2676 份真实 Claude transcript，就有规范 session 文件只含 ai-title / agent-name 等
    // 会话元数据 envelope 而落入 unknown。若把 unknown 当异构断言，US5"健康路径零落盘"
    // 会被上游任意新增的 envelope 形态击穿：在无关的用户项目目录凭空建 .specify/ 并写入
    // 事实错误的诊断。故 unknown 一律回落 []（= 本改造前的行为，非能力回退）。
    //
    // 由此落盘条件收窄为单一肯定命题：**必须命中 Codex 的 role 名**。US5 因而不再依赖
    // Claude 白名单追平上游——上游新增任意顶层 type 都只会落进 unknown → 静默。
    // 残余面（如实标注，非本次消除）：若某天 Claude transcript 出现与 CODEX_ROLLOUT_ROLES
    // 重名的顶层 type（如 `compacted`）且整份文件不含任何 Claude role，仍会被判 codex-rollout。
    // 本机 2676 份实扫未出现此形态；真出现时的正确修法是给 Codex 侧加结构性判别（如 rollout
    // 特有的 `timestamp`+`payload` 信封），而不是回头去补 Claude 白名单。
    const dialect = detectTranscriptDialect(entries);
    const dialectCode = Object.hasOwn(FOREIGN_DIALECT_DIAGNOSTICS, dialect)
      ? FOREIGN_DIALECT_DIAGNOSTICS[dialect]
      : null;
    return {
      enforcement, configDegraded, isFix: false, mode: anchor.mode,
      transcriptDiagnostics: dialectCode ? ['transcript-format-unrecognized', dialectCode] : [],
      verdict: null,
    };
  }

  // F257 缺陷 2 · 闸门三的计量源：基线用 anchor.earliestFixLineIndex，**刻意不用 anchor.anchorLineIndex**。
  // 主锚点取的是最晚一次展开，agent 自调一次 Skill(spec-driver-fix) 即可把它推到末尾、令锚点后计数
  // 归零而 isFix 仍为真（对抗审查实跑：攻击组 30/30 全 exit 0、计数恒 4）。两个基线由**同一趟**
  // detectFixSkillExpansion 扫描顺带产出（第 3 轮修复：闸门三原先另扫一遍 SKILL_EXPANSION_REGEX，
  // 该正则含惰性量词，诱饵前缀语料下把最坏耗时整整翻倍——判定器跑在同步 Stop hook 上，不可接受）。
  // 🔴 绝不可为"统一"把两个基线合并成一个，也绝不可在此另起第二遍展开扫描。
  const assistantEntriesSinceEarliestFix =
    countAssistantEntriesSinceEarliestFixExpansion(entries, anchor.earliestFixLineIndex);

  // F276 卡 C · `!saved.ok` 分支的唯一放行上界：数本段 fix 展开之后 harness 回灌的存储不可用阻断反馈。
  // 🔴 传的是 `latestFixLineIndex`，**不是**同处那个 `earliestFixLineIndex`——两个基线来自
  // `detectFixSkillExpansion` 的同一次调用，取哪个都不多扫一遍，但**安全方向相反**：
  // 本计数器窗口变窄 ⟹ 数到的更少 ⟹ 更晚放行 ⟹ fail-closed；闸门三窗口变窄则是 fail-open。
  // 照抄 earliest 就是把防线搭反（被判方付过 2 次往返后重展开 fix 即可拿到 0 次往返的放行）。
  const storageUnavailableFeedbackCount =
    countStorageUnavailableBlockFeedback(entries, anchor.latestFixLineIndex);

  // F270 P2：证据窗口下界统一切至 latestFixLineIndex（最晚一次 **fix** 展开）。
  // 不能用 anchorLineIndex（最晚**任意**展开）：尾部一次 doc 展开会把 5 个窗口推到 doc 行，
  // fix 阶段的委派/见证/执行记录被整段切到窗外 → 大面积误阻断（core.test T204 有 A/B 实证）。
  // 被判方重展开 fix 推走 latestFix 只会切掉自己的证据（fail-closed 自伤），与闸门三用
  // earliest 防"重展开续命"方向互补——方向不对称是刻意的（F257/F270）。
  const candidate = resolveFeatureDirCandidate(entries, anchor.latestFixLineIndex);

  // F227 D：主候选磁盘不可用时的只读兜底——状态机（core 层）逐字不变，
  // 磁盘判据完全下沉到这里，且仅在 ambiguous 为假、且 candidate.path 不可用时才介入。
  //
  // **单调性不变量（本兜底的正确性根据，改动时必须逐条保住）**：兜底解析只可能把
  // "改动前阻断"转为"改动后放行"，绝不可能把"改动前放行"转为"改动后阻断"。逐分支论证：
  //   - ambiguous === true → 兜底完全不介入（连 usable() 探针都不调用），
  //     F224 的 fail-open 降级通道（下方 FR-004 收窄段 → transcriptDiagnostics
  //     feature-dir-unresolvable → runHook 见诊断即 exit 0）逐字保持；
  //   - ambiguous === false 且主候选可用 → 循环体不执行，resolvedPath === candidate.path，
  //     本函数剩余部分与改动前逐字等价；
  //   - ambiguous === false 且主候选不可用 → 改动前必然是"特性目录/诊断报告缺失"类 exit 2 阻断，
  //     兜底后要么仍阻断（missing 原因可能不同，仍是 exit 2），要么转为放行。
  // 反面教训（必须保留此约束的原因）：若允许 ambiguous === true 时也兜底，被选中的历史候选
  // 可能 usable（有 fix-report.md）却不足以通过完整合规判定（本仓库 48 个含 fix-report.md 的
  // 历史 NNN-fix-* 目录中有 21 个没有 verification/verification-report.md），
  // 于是 featureDirUndetermined 由真变假 → 不再早退 → compliant:false → routeBlock → exit 2，
  // 把今天的 exit 0 放行反转为新增误阻断，正是本次要修的那类缺陷。
  //
  // 限界三（范围说明）：本次修复只覆盖"主候选被幽灵路径覆写、指向磁盘上不存在的目录"这一支。
  // 由 transcript 中伪造的 `mv` 文本导致 ambiguous=true 从而落入 F224 fail-open 的另一支
  // **不在本次范围**（介入它必然引入新的误阻断），已另开独立跟进项。
  const usable = (dir) => dir !== null && readArtifactFile(projectRoot, `${dir}/fix-report.md`).exists;
  let resolvedPath = candidate.path;
  // 🔴 声明位置是承重的：必须与 resolvedPath 同级，**不得**放进下方的 `if` 块内。
  // 放进块内会让下方 judgeCompliance 的消费点抛 ReferenceError，而 main() 顶层 catch（FR-013）
  // 会把它静默转成 exit 0 放行——本次修复会被自己反转成一条新的 fail-open。
  let witnessAbsent = false;
  if (candidate.ambiguous === false && !usable(resolvedPath)) {
    const history = Array.isArray(candidate.candidates) ? candidate.candidates : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (usable(history[i])) {
        resolvedPath = history[i];
        break;
      }
    }
    // 循环内一个都没命中 → resolvedPath 保持初值 candidate.path（含 null）：完全回落现状

    // F256 盲区 1：上面的候选历史兜底仍未命中 + 原始主候选是明确的 specs/NNN-fix-<short> 形态时，
    // 按 short-name 在磁盘上重新枚举——覆盖 Feature 编号被复合命令（`cd … && git mv A B && …`）
    // 重编、而 F231 刻意不跟随复合命令改名事件的场景：候选于是永久停在已从磁盘消失的旧编号路径，
    // transcript 侧再无重锚定手段，判定器拿死路径撞核验，把"目录改了名"误判成"目录不存在"。
    //
    // 安全边界：仅当 candidate.path !== null 时才取 short-name——这确保 short-name 来自 transcript
    // 中一个明确被提名过的具体候选，而非从 ambiguous 状态或空候选反推，维持与 F227 相同的
    // "提名≠判据，磁盘核验才采信"原则；short-name 要求**完全相等**，不做模糊匹配，候选无法漂移到
    // 无关特性；采信前仍过同一个 usable() 谓词（须含 fix-report.md）。
    //
    // 单调性（与上方 F227 论证同一套不变量，逐条复核）：ambiguous===true 时外层 if 就不进入；
    // 主候选可用或历史兜底已命中时 !usable(resolvedPath) 为假、本段不执行；只有"主候选不可用 +
    // 历史兜底未命中 + 短名磁盘命中制品齐全目录"这一狭窄交集才改变 resolvedPath，且只可能把
    // "改动前阻断"转为"改动后放行"，不产生新的误阻断。
    //
    // F257 缺陷 1 收口（方案 A′ · 写入见证门槛）：F256 原实现的采信闸门只有 usable()，
    // 而 usable() 是**制品存在性**判据、不是**会话归属**判据。二者都不蕴含归属，于是本会话零产出时，
    // 判定器会静默改用磁盘上同 short-name 的另一编号旧目录完成合规判定 → compliant:true →
    // 合规早退（发生在任何 appendAuditEvent 之前）→ exit 0 且事后零审计线索。
    //
    // F256 原注释把这条判为"被接受限界的边际扩大，因为冒用者原本直接提名目标目录即可"——
    // 该理由**只对主动冒用成立**。真正的失效模式是**无意**的：本会话老实提名了自己的新编号目录、
    // 磁盘上恰好存在同 short-name 的历史目录，判定器就静默采信了别人的产物，被判方全程没有任何
    // 冒用动作。故追加一维证据：磁盘重锚定必须有本会话对该 short-name 家族制品的**成功写入见证**。
    //
    // 🔴🔴 承重前提（第 3 轮红队实证，破坏它即复活一条零审计 fail-open）：
    // **见证的制品类必须与本段采信谓词 `usable()` 严格同源**。当前 `usable()` 只查 fix-report.md，
    // 故 `ANCHORED_ARTIFACT_PATH_REGEX` 也只收 fix-report.md。二者一旦脱钩就会出现「拿到了见证但
    // 不 usable」的目录：上方 F227 历史兜底只挑 usable 的历史候选故不选它 → 控制流照旧落进本段 →
    // witnessedShortNames 命中 → 重锚定到本会话从未触碰的旧目录 → compliant:true → 合规早退 → exit 0。
    // 红队实跑链（第 2 轮实现把 verification/verification-report.md 也算见证时成立）：零真实产出 +
    // 两次廉价 Agent 委派 + Write 一份 1 字节的 verification-report.md 到全新编号目录 → exit 0。
    // 后人放宽任一侧（加回见证制品类 / 放宽 usable）都必须同步另一侧并补回归用例。
    //
    // ⚠️ 第 2 轮此处那段「(a) 同编号版本采信正支结构性不可达」的演绎证明**已被上述实证证伪**，
    // 故删除，不得再作为放宽依据：该证明从「见证集合 ⊆ 提名集合 ⟹ 被见证目录必进 candidateHistory」
    // 推出「F227 兜底先手命中」，但**「进 candidateHistory」不蕴含「usable」**——兜底循环只挑
    // usable 的历史候选。同轮"576 组排列穷举 0 命中"的穷举集合也没覆盖该形态，不构成反证。
    //
    // 🔴 为何比较是 **short-name 家族级**而不是"见证目录与重锚定目标同编号"——这是本判据的命门，
    // 后人"优化"回同编号会静默删除整个 F256：F256 的真实场景里被见证的是**旧**目录
    // （`specs/251-fix-foo`，已被 git mv 移走故不可用，F227 兜底不命中），而重锚定目标是磁盘上的
    // `specs/254-fix-foo`，short-name 同为 `foo` ⟹ 见证成立 ⟹ 正支可达，F256 正向用例仍 exit 0。
    // 同编号写法下该正支不可达（见证目录不在磁盘上），F256 的修复会被整段抵消。
    //
    // 安全下界没有被家族级放宽：伪造见证仍须真的 Write 一份同 short-name 目录的 fix-report.md 并拿到
    // harness 的成功回执。放宽的只是"哪个编号"，没有放宽"是否真写过"。
    //
    // 方向仍是收窄（fail-closed）：只可能把"改动前放行"转为"改动后阻断"，不新增任何放行出口。
    //
    // 新增误阻断类 X（如实登记，非回归）：本会话对该 short-name 家族**任一**目录都没有成功写入过
    // fix-report.md，却期望采信磁盘上同 short-name 的目录 → 阻断。补救成本极低（对家族内任一目录的
    // fix-report.md 做一次 Write/Edit 即恢复放行），且 BLOCK_LIMIT=2 保证最坏两次阻断后降级放行，
    // 会话不会卡死。
    //
    // 🔴 类 X 的**三种**典型形态（第 4 轮审查补登记形态 2、第 5 轮补登记形态 3——前身注释只写了
    // 形态 1，漏登记会让后人把它们当回归"修"回去，即放宽见证判据、复活零审计 fail-open）：
    //   形态 1 · 子代理写制品：制品全部由子代理在 sidechain 内写入，主 transcript 不可见。
    //   形态 2 · **制品经 Bash 写入**：本判据的提名侧与见证侧在**两个维度上不对称**——
    //     · 工具集：提名侧 `resolveFeatureDirCandidate` 接受 Bash 写入（`hasBashWriteIndicator`
    //       即 `>` / `>>` / `<<` / `tee` + `ARTIFACT_PATH_REGEX`），见证侧只接受 `Write` / `Edit`；
    //     · 制品类：提名侧的 `ARTIFACT_PATH_REGEX` 还收 `verification/verification-report.md`，
    //       见证侧的 `ANCHORED_ARTIFACT_PATH_REGEX` 只收 `fix-report.md`（与 `usable()` 同源，见上）。
    //     第 4 轮实跑复现：`cat > specs/251-fix-bar/fix-report.md <<'EOF'` 写制品 → 委派齐全 →
    //     复合命令 `git mv` 重编到 254 → 磁盘 254 制品齐备，结果由 `compliant:true` 翻转为
    //     `compliant:false, missing:[feature-dir, fix-report.md], diagnostics:[feature-dir-witness-absent]`。
    //     该流程完全无恶意，却被阻断。
    //   🔴 这是**取舍不是 bug，不要为它放宽见证判据**：把 Bash 收进见证侧会让 `cat X > /dev/null`
    //     之类零成本命令即可发证（正是 F227「已知限界一」的形态），见证从"证据"退化为"格式"；
    //     把 verification-report.md 收进见证侧则会直接复活第 3 轮红队实证的绕过链（见上方
    //     ANCHORED_ARTIFACT_PATH_REGEX 的承重不变量）。两条放宽都换不回等价的安全下界。
    //     形态 2 的补救与形态 1 相同：对家族内任一目录的 fix-report.md 做一次 Write/Edit 即恢复。
    //   形态 3 · **会话中途重新展开 fix skill**（第 5 轮审查补登记；F270 P2 更新窗口基线）：
    //     见证窗口的下界 F270 起用 `anchor.latestFixLineIndex`（**最晚一次 fix 展开**，非「最晚
    //     任意展开」的 anchorLineIndex——后者会被尾部一次 doc 展开推走，把 fix 阶段见证整段切到
    //     窗外，即病根 iv 的误伤面）。与闸门三取 `earliestFixLineIndex`（**最早** fix 展开）作基线
    //     的方向相反（见 countAssistantEntriesSinceEarliestFixExpansion 的 JSDoc）。于是同一会话
    //     中途再次 `Skill(spec-driver-fix)` 展开时，之前对制品的**合法** Write 会落到新窗口之外 →
    //     见证清空 → `feature-dir-witness-absent` 阻断。
    //     🔴 这个方向不对称是**刻意的、且两侧各自 fail-closed**，不是需要"对齐"的 bug：见证窗口用
    //     最晚 fix 展开 ⟹ 重展开 fix 只会**收窄**见证（更难放行）；闸门三用最早 fix 展开 ⟹ 重展开
    //     无法把计数清零（更难推迟）。两侧都取"重展开不能让被判方获益"的那一端。若把见证窗口也改成
    //     最早展开，会让锚点前的陈旧写入事件重新计入见证，放宽的是**放行**方向，与本收口相反。
    //     补救与形态 1/2 相同：重展开后对家族内任一目录的 fix-report.md 再做一次 Write/Edit 即恢复。
    //
    // 本次**不**消除的两条既有面（禁止读成"已消除"）：
    //   1. F227「已知限界一」——不经过本兜底、直接提名磁盘上完好的旧目录并用 `cat X > /dev/null`
    //      满足 BASH_WRITE_INDICATOR_REGEX 仍可放行。本收口的价值在于消除**无意**的静默采信，
    //      而非阻止主动冒用。
    //   2. **见证不绑定终态**（红队形态 W1 已实证，收窄制品类不消除它）：`Write .../fix-report.md`
    //      拿到成功回执后立刻回滚，磁盘零变化而见证仍成立——判据看 transcript 历史、制品判据看磁盘
    //      终态，二者时间解耦（F227「终态存在性 ≠ 历史事件是否发生」的镜像）。第 2 轮把它记作边角
    //      限界是低估，现按**承重逃逸面**登记：它是本判据下唯一成本可控的伪造路径。仍接受的理由是
    //      伪造者必须真的执行一次写入并拿到 harness 回执（成本高于第 1 条），且事件留痕可事后审计；
    //      真正闭合需把见证与磁盘终态做交叉核验，属独立跟进项。
    if (!usable(resolvedPath) && candidate.path !== null) {
      const shortName = extractFixShortName(candidate.path);
      if (shortName !== null) {
        // 见证集合按 short-name 归约后比较（家族级；理由见上方「为何比较是 short-name 家族级」一段）
        const witnessedShortNames = new Set(
          [...collectArtifactWriteWitnessDirs(entries, anchor.latestFixLineIndex, projectRoot)]
            .map(extractFixShortName)
            .filter((s) => s !== null),
        );
        // `.filter(usable)` 是承重判据而非防御性冗余：磁盘上同 short-name 的目录里完全可能存在
        // 编号更大的**空壳**（重编时先建新目录、制品尚未迁入，或撞号后被弃用的空目录）。
        // 不过滤就会选中空壳、把"制品其实齐备"错判成"缺少诊断报告"——恰是 F256 要修的误报。
        const usableMatches = listFeatureDirCandidatesByShortName(projectRoot, shortName).filter(usable);
        if (witnessedShortNames.has(shortName)) {
          // 取编号最大的**可用**者 = 重编链末端里制品齐备的那个（枚举已按编号升序，见 io 层排序注释）
          if (usableMatches.length > 0) resolvedPath = usableMatches[usableMatches.length - 1];
        } else if (usableMatches.length > 0) {
          // 磁盘上确有可采信的同名目录、但本会话没写过这个家族的任何制品 → 拒绝重锚定并留下归因线索，
          // 否则事后只看到 missing:[feature-dir]，与"根本没建目录"不可区分
          witnessAbsent = true;
        }
      }
    }
  }

  // F224 FR-004/FR-005：候选目录确已失效但新位置无法机械定位（如改名到非 NNN-fix-<name> 目录）。
  // 这只让**特性目录这一个维度**变得不确定，绝不意味着其余判据也无从判断——
  // 因此这里只记标记，不早退：委派抽取与 judgeCompliance 必须照常跑完（见下方 FR-004 收窄段）。
  const featureDirUndetermined = resolvedPath === null && candidate.ambiguous === true;

  // F270 P4 · 委派证据主源换代（D-1 方向 X）：账本作 transcript 委派的**补充**（只增不减）。
  //
  // 语义澄清（P4 对抗 WARNING-1 修订：此前注释谎称"矛盾交叉取严"，实际是纯补充——门禁 over-claim
  // 是承重面上的假话，已改如实）：本实现**不做**"以账本替代 transcript + 矛盾取严"（FR-008 的强形态），
  // 而是 D-1 下更保守的**补充语义**——transcript 因异步滞后尾部缺委派时，账本（实时采集）补上其
  // 未覆盖的 roleClass；账本有而 transcript 无的角色，方向是**减少误阻断**（帮合规用户），不引入
  // "可写载体压过 harness 背书"的替代逻辑。
  //   - 账本缺席（LEDGER_ABSENT）/ 窗口未定（windowUndetermined，latestFix 无 timestamp）
  //     → 空补充 → 纯 transcript（FR-009 回退等价）。窗口未定绝不退回"全会话账本回流"（WARNING-2）。
  //   - 窗口过滤：hookTs >= latestFix 展开的 transcript timestamp（FR-013 归属窗口）。
  //   🔴 安全下界如实登记（对抗 A / 必答①）：账本条目被判方可写，委派下界从 harness 背书降到
  //     hook 记录+可改写——蓄意者可 echo 一行 JSON 伪造委派，成本从"篡改 harness 制品"降到"写一行"。
  //     这是 D-1 方向 X **用户拍板接受**的下界（只防疏忽不防蓄意）。**补充事件如实落诊断**
  //     （ledger-supplemented-role），使"账本补了 transcript 没有的角色"这一唯一有安全意义的事件
  //     可事后审计——不阻断（补充方向是帮合规用户），但不再零留痕。
  const transcriptDelegations = extractDelegationsAfter(entries, anchor.latestFixLineIndex);
  const ledgerResult = sessionId
    ? readLedgerDelegations(projectRoot, sessionId, { sinceTs: anchor.latestFixTimestamp ?? null })
    : { state: LEDGER_ABSENT, delegations: [], corruptCount: 0, diagnostics: [], windowUndetermined: false };
  const ledgerDiagnostics = [...(ledgerResult.diagnostics || [])];
  // 补充：transcript 委派为主体，账本补其未覆盖的 roleClass（按 roleClass 去重，不重复计数）。
  const transcriptRoles = new Set(transcriptDelegations.map((d) => d.roleClass));
  const ledgerSupplement = ledgerResult.delegations.filter((d) => !transcriptRoles.has(d.roleClass));
  const delegations = [...transcriptDelegations, ...ledgerSupplement];
  // WARNING-1 收口：补充非空即落诊断（账本补了 transcript 没有的角色=唯一有安全意义的事件）
  if (ledgerSupplement.length > 0) ledgerDiagnostics.push(LEDGER_SUPPLEMENTED_ROLE);
  const featureDirCheck = checkFeatureDirOnDisk(projectRoot, resolvedPath);
  const fixReport = resolvedPath
    ? readArtifactFile(projectRoot, `${resolvedPath}/fix-report.md`)
    : { exists: false, content: null, nonEmpty: false };
  const verificationReport = resolvedPath
    ? readArtifactFile(projectRoot, `${resolvedPath}/verification/verification-report.md`)
    : { exists: false, content: null, nonEmpty: false };

  // F216：只分类一次 closure（AD-4 正交结构），据 hasNoopAnchor 决定是否提取执行证据，
  // 并把 closure 透传 judgeCompliance 避免 evaluate/judge 重复分类（plan I8）。
  const closure = fixReport.exists
    ? classifyClosureForm(fixReport.content)
    : { closureForm: 'undetermined', hasRepairAnchor: false, hasNoopAnchor: false };
  // no-op 锚点分支才配对 fix 锚点后窗口的 Bash 执行证据；纯 repair（hasNoopAnchor=false）零介入（FR-007）
  const executionRecords = closure.hasNoopAnchor
    ? extractExecutionRecordsAfter(entries, anchor.latestFixLineIndex)
    : [];

  const verdict = judgeCompliance({
    delegations,
    featureDir: { path: resolvedPath, existsOnDisk: featureDirCheck.existsOnDisk },
    fixReport: { exists: fixReport.exists, content: fixReport.content },
    verificationReport: { exists: verificationReport.exists, nonEmpty: verificationReport.nonEmpty },
    closure,
    executionRecords,
    enforcement,
    configDegraded,
    // F257 O1：见证缺席时追加可归因诊断码。judgeCompliance 对 diagnostics 是**纯透传**、不据此改判，
    // 经 buildAuditEvent 进审计事件。
    // 🔴 绝不可放进 transcriptDiagnostics —— 该数组非空即触发 runHook 的 FR-013 fail-open 放行，
    // 会把本次收口反转成一条新的静默放行通道。
    diagnostics: witnessAbsent ? [...configDiagnostics, 'feature-dir-witness-absent'] : configDiagnostics,
  });

  // F224 CRITICAL 收窄（Phase 5 后修复轮）：fail-open 必须**按维度**生效，不得整体短路（沿用不变）。
  // 早前实现在 judge 之前直接 return，等于用"目录无法定位"一并赦免了与目录解析无关的委派证据要求，
  // 于是只要多敲一条 `git mv <候选> <非规范名>`，零委派的坍塌会话也能把 exit 2 变成 exit 0——
  // 直接击穿 F208 设立本门禁的目的。
  //
  // F230 CRITICAL 第 2 层收窄：降级下界不得取「repair 合同」与「no-op 合同」两种收口形态各自要求的
  // **并集**（F224 原判据 implement>0 || verify>0），而须取**交集**——repair 合同要求
  // counts.verify ≥ 1、no-op 合同要求 noopVerifyCount ≥ 1，二者都不满足时，无论制品落在哪个目录，
  // 该会话都不可能合规收口，故拒绝降级不会冤枉任何本可合规的会话。
  // 只查 roleClass==='verify' 不够——canonical no-op 委派文案「交叉核实无需改动判定」只命中
  // NOOP_VERIFY_ROLE_REGEX（含"核实"/"确认"）、不命中更窄的 VERIFY_ROLE_REGEX，
  // 故必须显式补 `d.noopVerify === true` 分支，否则会误伤合法 no-op 收口。
  //
  // 谓词的下界必须**被合规合同蕴含**：凡 judgeCompliance 可能判合规的委派构成，降级都必须放行，
  // 否则会出现「目录可定位时判合规、目录改名后却拒绝降级」的状态依赖不一致。judgeCompliance 的
  // no-op 分支只看 `noopVerify === true`（不看 roleClass），故这里也只能取 repair 合同（verify ≥ 1）
  // 与 no-op 合同（noopVerify ≥ 1）各自要求的并集形式，不得附加 roleClass 排除项。
  // NOOP_VERIFY_ROLE_REGEX 偏宽（含「确认」「核实」，实测 description='确认无需代码修复' 会同时
  // 得到 roleClass='implement' 与 noopVerify=true）是**既有 no-op 合同**的判据宽度；收紧它属独立取舍，
  // 应连同 judgeCompliance 的 no-op 分支一起改，不在本次范围。
  const hasVerifyClassDelegation = delegations.some(
    (d) => d && (d.roleClass === 'verify' || d.noopVerify === true),
  );
  if (featureDirUndetermined && hasVerifyClassDelegation) {
    // 🔴 必须透传 ledgerDiagnostics（对抗 D CRITICAL-2）：`hasVerifyClassDelegation` 算的是
    // `delegations` ＝ transcript **＋账本补充**，故账本一条 verify 就能把本谓词从 false 翻成
    // true，进而走这条 exit 0 的降级放行。它与「合规」是账本翻转裁决的**两条**路径，此前只有
    // 合规那条补了留痕，本条仍无痕 → 伪造通过与诚实降级在审计流里逐字节相同。
    return {
      enforcement, configDegraded, isFix: true, mode: anchor.mode,
      transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null,
      assistantEntriesSinceEarliestFix, ledgerDiagnostics,
    };
  }

  // F256 盲区 2：复用已解析的 entries/锚点求"在途委派"（零额外磁盘/transcript 读取）。
  // 本字段只描述事实（锚点后是否还有未回收的在途工作），不参与 verdict 本身；
  // 如何使用它（推迟裁决）由 runHook 决定。
  const inFlightDelegations = extractInFlightDelegationsAfter(entries, anchor.latestFixLineIndex);

  return {
    enforcement, configDegraded, isFix: true, mode: anchor.mode,
    transcriptDiagnostics: [], verdict, inFlightDelegations, assistantEntriesSinceEarliestFix,
    ledgerDiagnostics,   // F270 P4：账本读取诊断（ledger-entry-conflict 等），透传进 runHook 审计
    storageUnavailableFeedbackCount,   // F276 卡 C：`!saved.ok` 分支的上界计量源（事实字段透传）
  };
}

// ────────────────────────────────────────
// FR-010 反馈文本机械拼装（core 常量拼装，非自由生成）
// ────────────────────────────────────────

/**
 * 由 missing 枚举拼装反馈文本：稳定动作行 + 双路径指引。
 * @param {string[]} missing
 * @param {{ degraded?:boolean, diagnostics?:string[] }} [opts]
 */
export function buildFeedbackText(missing, opts = {}) {
  const actionLines = (Array.isArray(missing) ? missing : [])
    .map((key) => MISSING_ACTION_TEXT[key])
    .filter(Boolean);
  const segments = [];
  if (opts.degraded) segments.push(GATE_DEGRADED_PREFIX_LINE);
  segments.push(...actionLines);
  segments.push('', DUAL_PATH_GUIDANCE);
  if (Array.isArray(opts.diagnostics) && opts.diagnostics.length > 0) {
    segments.push('', `诊断: ${opts.diagnostics.join(', ')}`);
  }
  return segments.join('\n');
}

// ────────────────────────────────────────
// 审计事件构造（contracts/fix-compliance-verdict-event.schema.json）
// ────────────────────────────────────────

function buildAuditEvent({ sessionId, enforcement, verdict, blockCount, degraded, extraDiagnostics }) {
  const diag = new Set([
    ...((verdict && verdict.diagnostics) || []),
    ...(extraDiagnostics || []),
  ]);
  return {
    schemaVersion: 1,
    eventType: 'fix-compliance-verdict',
    recordedAt: new Date().toISOString(),
    sessionId,
    enforcement,
    closureForm: verdict ? verdict.closureForm : 'undetermined',
    compliant: verdict ? verdict.compliant : null,
    missing: verdict ? verdict.missing : [],
    blockCount: enforcement === 'block' ? (typeof blockCount === 'number' ? blockCount : null) : null,
    degraded: Boolean(degraded),
    diagnostics: [...diag],
  };
}

// ────────────────────────────────────────
// hook 模式路由（阻断 / 警告 / 降级放行）
// ────────────────────────────────────────

/**
 * 处理不合规 + block 档：阻断计数路由（FR-006 有界化）。
 * @param {string[]} [extraDiagnostics] - 上游路由追加的诊断码（如在途预算耗尽）
 * @param {{ storageUnavailableFeedbackCount?:number }} [counts] - F276 卡 C：`!saved.ok` 分支的上界计量源。
 *
 *   🔴 why 有默认值、且非有限数字按 **0** 处理（IW-1 修正，与 F238「required 化」纪律的方向相反）：
 *   本文件的 `main` 顶层 `catch { return 0 }` 是 FR-013 fail-open 兜底——解构无默认值时"忘传"抛出的
 *   TypeError 会被它**兜成 exit 0 静默放行**（完全绕过），而不是像 F238 场景那样炸给开发者看。
 *   即"忘传即炸"在本调用链上等价于"忘传即放行"，方向反了。故这里改成 fail-closed 归一：
 *   忘传 / 传 null / 传非有限数 ⟹ 计数按 0 ⟹ 永不触顶 ⟹ **一律阻断**。
 *   代价（如实登记）：真出现忘传时存储故障用户会被 brick，但那是 loud 的可被用户报告的故障，
 *   而静默放行是不可观测的安全失效——两害相权取可观测者。
 * @returns {number} 退出码
 */
function routeBlock(projectRoot, sessionId, verdict, extraDiagnostics = [], counts = {}) {
  const rawFeedbackCount = counts ? counts.storageUnavailableFeedbackCount : undefined;
  const storageUnavailableFeedbackCount = Number.isFinite(rawFeedbackCount) ? rawFeedbackCount : 0;
  const loaded = loadBlockState(projectRoot, sessionId);
  const count = loaded.blockCount;

  if (count < BLOCK_LIMIT) {
    // 未达上限：尝试持久化 N+1 → 成功则硬阻断；失败（两级存储不可用）不再等同「已达上限」放行——
    // F276：该映射被实测为两条 mkdir 即可自诱发的 0 成本绕过，改走 routeStorageUnavailable（fail-closed + 反馈计数上界）
    const nextCount = count + 1;
    const saved = saveBlockState(projectRoot, sessionId, {
      blockCount: nextCount,
      degradedRecorded: loaded.degradedRecorded,
      // saveBlockState 是整体覆写：本路径不改在途预算与解锁计时器，必须原样带回，否则会被抹平为 0
      // （F270 P3 自查抓到的漏带即清零：三处旧调用点都要补两新字段——见 io normalizeState 注释）
      inFlightDeferCount: loaded.inFlightDeferCount,
      nonBlockStopCount: loaded.nonBlockStopCount,
    });
    if (saved.ok) {
      appendAuditEvent(projectRoot, buildAuditEvent({
        sessionId, enforcement: 'block', verdict, blockCount: nextCount, degraded: false, extraDiagnostics,
      }));
      process.stderr.write(`${PREFIX_BLOCK} ${buildFeedbackText(verdict.missing)}\n`);
      return 2;
    }
    // 存储不可用 → 不再无条件降级放行（F276 卡 C 方向反转），改走 fail-closed + 反馈计数上界
    return routeStorageUnavailable(projectRoot, sessionId, verdict, {
      feedbackCount: storageUnavailableFeedbackCount,
      errors: saved.errors,
      extraDiagnostics,
      inFlightDeferCount: loaded.inFlightDeferCount,
      nonBlockStopCount: loaded.nonBlockStopCount,
    });
  }

  // 已达上限（count >= 2）→ 降级放行
  return releaseDegraded(projectRoot, sessionId, verdict, {
    alreadyRecorded: loaded.degradedRecorded,
    storageUnavailable: false,
    inFlightDeferCount: loaded.inFlightDeferCount,
    nonBlockStopCount: loaded.nonBlockStopCount,
    extraDiagnostics,
  });
}

/**
 * F276 卡 C · 两级状态存储都写不进时的路由（取代原先的无条件 `releaseDegraded`）。
 *
 * why 方向反转：原实现在 `!saved.ok` 时直接降级放行，而两级默认状态路径
 * （`.specify/runs/.fix-compliance-state` 与 `$TMPDIR/spec-driver-fix-compliance`）**都在被判方写域**——
 * `touch` 出两个同名文件占位即可拿到 **0 次往返**的放行，且不需要任何 env 注入。这是本卡要关的那张口。
 *
 * 🔴 **本函数只有两个闸门，且都不看 errno**。按 errno 分流的两种形态均已实测被击穿：
 *   - 黑名单（"这些码是自诱发的 ⟹ 阻断，其余放行"）：漏一个可诱发码就直接送出 0 次绕过；
 *   - 白名单（"环境性码 ⟹ 放行"）：`ln -s /` 让 `writeFileSync` 跟随软链写进只读卷，
 *     两条软链即可让两级同为环境性码 ⟹ 白名单放行 ⟹ 0 成本绕过原样复活。
 *   「环境性错误码带内不可诱发」这条前提**已被证伪**——软链跟随让错误码变成**被判方可选的输入**。
 * 故 `saved.errors` 只进 stderr 渲染与审计可观测性，**判定侧不读它的任何字段**（回归钉：E-p 源码守卫）。
 *
 * 上界（护栏 R-11：任何不计数的裁决必须同时规定放行路径）：唯一上界是 storage-free 的反馈计数——
 * 数 harness 回灌进 transcript 的含 token 条目，达 `BLOCK_LIMIT` 即走既有 `releaseDegraded` 终态。
 * 地板形态：**同段 fix 展开内首次触顶前 2 次 Stop 往返，其后回合 0 次**；会话总代价
 * = 2 × fix 展开段数（× compaction 次数），不是全局常数 2。
 *
 * 残余（如实登记，不追加防线）：
 *   1. 存储与 transcript 回灌通道**同时**失效时计数器永不累加 ⟹ 上界变成"用户动作"而非计数
 *      （修好路径 / 改 enforcement / 重启带 env）——三条补救口已按生效即时性写进 stderr。
 *   2. **同段内该预算不随存储恢复复位**：反馈条目留在窗口里永久有效，故被判方付满 2 次往返后，
 *      在该 fix 展开段的余下部分对本分支持有可复用的免检权（窗口只由"重展开 fix"这个自伤动作推进）。
 *   3. **自注册 Stop hook 可投喂计数器**（对抗审查已用真 CLI 端到端跑通）：harness 代写前缀、
 *      hook 命令串由注册方自选 ⟹ 谓词四条件可被凑齐。成本论据（"hook 配置是启动快照"）已被质疑
 *      且未澄清，见 countStorageUnavailableBlockFeedback 的 JSDoc。本卡不追加防线，按残余移交设计层。
 *
 * @param {{ feedbackCount:number, errors:{path:string|null,stage:string|null,code:string|null}[]|undefined,
 *           extraDiagnostics:string[], inFlightDeferCount:number, nonBlockStopCount:number }} opts
 * @returns {number} 退出码（0 = 上界耗尽降级放行；2 = fail-closed 阻断）
 */
function routeStorageUnavailable(projectRoot, sessionId, verdict, {
  feedbackCount, errors, extraDiagnostics, inFlightDeferCount, nonBlockStopCount,
}) {
  // 闸门 1（唯一上界）：反馈计数触顶 → 既有降级放行终态，形态不改，只多一个 trigger 码。
  if (feedbackCount >= BLOCK_LIMIT) {
    return releaseDegraded(projectRoot, sessionId, verdict, {
      alreadyRecorded: false,
      storageUnavailable: true,
      inFlightDeferCount,
      nonBlockStopCount,
      // 🔴 合并须保留上游：硬编码单元素数组会把上游诊断码（如在途预算耗尽）整个丢掉
      extraDiagnostics: [...new Set([...extraDiagnostics, 'storage-unavailable-block-budget-exhausted'])],
    });
  }

  // 闸门 2（否则一律 fail-closed）：按本次裁决自身语义阻断。
  const mergedDiagnostics = [...new Set([...extraDiagnostics, 'state-storage-unavailable'])];
  try {
    appendAuditEvent(projectRoot, buildAuditEvent({
      sessionId, enforcement: 'block', verdict,
      // 计数写不进去 ⟹ 本次处在第几次阻断**不可知**，报 null 而不是编一个数字
      blockCount: null, degraded: false, extraDiagnostics: mergedDiagnostics,
    }));
  } catch {
    // 审计与状态同在 `.specify/runs/` 下、同生共死：诚实故障时它必然一起失效，
    // 但判定不因审计缺席而改变、进程也不得崩（E-j 实测钉）。
  }
  process.stderr.write(buildStorageUnavailableFeedback(projectRoot, verdict, errors, mergedDiagnostics));
  return 2;
}

/**
 * F276 卡 C · 存储不可用阻断的 stderr 文本。
 *
 * 🔴 **主消费者是模型，不是人**：若动作行与双路径指引全指向"补制品"，模型会把预算烧光在一个它
 * 结构上修不了的问题上，而人不知情。故「这不是制品问题、模型无法修复」并进**首行**、与 token 同一行——
 * 单独成行会被只读首行的消费者漏掉。
 *
 * 🔴 补救口按 **生效即时性** 排序：① 修好路径（下一次 Stop 立即生效）→ ② 配置降级门禁（配置每次 Stop
 * 重读，下一次 Stop 生效）→ ③ 环境变量（**须重启会话**——hook 进程 env 取自 CC 启动快照，
 * 会话内 `export` 到不了）。把须重启的那条当唯一补救口就是**假补救口**。
 *
 * 🔴 ① 的 code 对应表是**纯渲染映射，零判定消费**，且**静态映射只保留两条**：
 * `EEXIST|ENOTDIR` ⟹ 删除 `@` 后那一个文件、`EACCES` ⟹ `chmod u+w` 父目录；其余码一律
 * 「请向用户报告该错误码」。不为任何环境性码单列动作行——写进模板的 errno 明文与源码守卫 E-p 互斥，
 * 会逼着实现期去削弱 E-p、给 errno 白名单留回流口。运行时 `err.code` 照原样渲染（取到什么打什么）。
 *
 * 🔴 ① 的删除对象由路径行的「挡路对象:」括注指定（IW-2/IM-1 修正）：`@ <err.path>` 是**被创建的目标**，
 * `ENOTDIR`（`.specify/runs` 本身被占成文件）下它根本不存在，而旧措辞「删 `@` 后那一个文件、
 * 且勿删 `.specify/runs`」恰好把**唯一正确的动作**禁掉了——自相矛盾即等于没有补救口。
 * 现由 io 侧沿祖先链探出真正的挡路物单独渲染；防「`rm -rf` 毁证据」的护栏改为
 * 「只删它这一个文件、勿删任何目录」+ 明写挡路对象若就是 `.specify/runs`，删该**文件**后目录会自动重建。
 *
 * 🔴 ② 措辞取「追加/合并进该文件」而非「写入」（IM-4）：后者在文件已存在时有**整份覆写**歧义，
 * 会诱导模型把用户既有配置抹掉；故同时明写「已有 `fix_compliance` 段时只改其 `enforcement` 值」。
 *
 * 🔴 ② 必须给出**文件名 + 嵌套层级**，且正文是**两行字面量**（第二行缩进两空格）：
 * 转写成自然语言会丢缩进 ⟹ 模型写出无缩进两行 ⟹ YAML 解析成 `fix_compliance: null` + 顶层
 * `enforcement` ⟹ 回到 `undefined ⟹ block` 且**零诊断**，正是这条补救口要关的那张口。
 * 措辞取「**由用户决定是否**」的用户动作式而非对模型的操作指令——⚠️ 这只降低诱导性，
 * **不构成防线**：该配置开关既有、已公开文档化、落在被判方写域（配置面 1 次往返已登记移交）。
 */
/**
 * 渲染进 stderr 的路径段消毒：把控制字符与不可见/双向控制字符折成可见转义形，并施加长度上限。
 *
 * why：`err.path` 是本条 stderr 里**唯一内容形态不受任何守卫约束**的自由段（`sessionId` 已被
 * `sanitizeSessionId` 收到 `[A-Za-z0-9._-]`，`stage` / `code` 来自 Node 的固定取值域）。它逐字进单行渲染，
 * 路径里一个换行就能长出一整行伪造文本——对抗审查实测可冒充 `GATE_DEGRADED_PREFIX_LINE` 这类 core
 * 常量行；而这条 stderr 随后会被 harness 回灌进 transcript，伪造行同时进入人与模型的视野。
 *
 * 🔴 **可达性如实登记**：该段当前只来自 `projectRoot` 与启动快照 env（`TMPDIR` /
 * `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP`），被判方在会话内够不到 ⟹ 本函数是**把隐含前提显式钉住**，
 * 不是在关一条已可达的口。折成转义形也顺带让含控制字符的诚实路径可读（否则消息整段错位）。
 */
const PATH_SEGMENT_RENDER_LIMIT = 512;

/**
 * 消毒集（IL-1 扩充）。刻意写成 `\u` 转义而非直接嵌不可见字符：源码里的裸 LS/RLO/BOM 自身就会让
 * 本文件在编辑器与 diff 里错位显示，改动反而不可见。
 *
 * - `\u0000-\u001F`：C0（含 LF/CR/TAB，原有）
 * - `\u007F-\u009F`：DEL + C1（其中 NEL `\u0085` 被部分终端与文本管线按换行处理，等价换行注入）
 * - `\u2028\u2029`：LS / PS（JS 与多数日志/JSON 管线视作行分隔）
 * - `\u200B-\u200F`：零宽空格/连接符 + LRM/RLM（可把 token 掰成"看着像但不是"的形状）
 * - `\u202A-\u202E`：双向控制（RLO 让渲染顺序与真实字节序相反，误导人眼判断该删哪个对象）
 * - `\uFEFF`：BOM / 零宽不换行空格
 */
const PATH_SEGMENT_UNSAFE_RE =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\uFEFF]/g;

function renderPathSegment(value) {
  if (typeof value !== 'string' || value.length === 0) return '未知路径';
  const escaped = value.replace(PATH_SEGMENT_UNSAFE_RE, (ch) => {
    const code = ch.charCodeAt(0);
    // 单字节码位保持既有 `\xNN` 形（E-q 的换行钉按此形断言）；多字节码位用 `\uNNNN`
    return code <= 0xFF
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`;
  });
  // 长度上限（当前不可达，钉住隐含前提）：路径本身无长度约束，而这条 stderr 会被回灌进 transcript，
  // 超长段可把后面的有效补救口挤出模型的注意窗口。截断只损可读性，零判定消费。
  return escaped.slice(0, PATH_SEGMENT_RENDER_LIMIT);
}

function buildStorageUnavailableFeedback(projectRoot, verdict, errors, mergedDiagnostics) {
  const levels = ['主路径', '回落'];
  const rendered = levels.map((label, i) => {
    const e = (Array.isArray(errors) && errors[i]) || {};
    // IW-2/IM-1：`err.path` 是**被创建的目标**，ENOTDIR 下它本身不存在；真正该删的是 io 侧沿祖先链
    // 探出的 blocker。探不到（如 EACCES：第一个存在节点就是目录）时不加括注，保持原措辞。
    const blocker = (typeof e.blocker === 'string' && e.blocker.length > 0)
      ? `（挡路对象: ${renderPathSegment(e.blocker)}）`
      : '';
    return `${label}: ${e.stage || '未知阶段'} ${e.code || '未知错误码'} @ ${renderPathSegment(e.path)}${blocker}`;
  }).join('；');

  return [
    `${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 阻断计数无法持久化，本次按裁决自身语义阻断（连续 ${BLOCK_LIMIT} 次后降级放行）；⚠️ 这不是制品问题，模型无法修复：请向用户报告下方路径不可写，勿反复重试补制品`,
    rendered,
    '补救（按生效快慢）：① 修好上述路径 —— 下一次 Stop 立即生效；按上行的 code 对应处置：EEXIST|ENOTDIR ⟹ 删除上行「挡路对象:」标出的那一个文件（未标出时以 @ 后的路径为准）；⚠️ 只删它这一个文件、勿删任何目录；若挡路对象就是 .specify/runs 本身，说明该路径被占成了文件，删掉这个文件后目录会自动重建；EACCES ⟹ chmod u+w 其父目录；其余 code ⟹ 请向用户报告该错误码',
    `② 由用户决定是否降级门禁：把下面两行追加/合并进 ${projectRoot}/spec-driver.config.yaml（或 ${projectRoot}/.specify/spec-driver.config.yaml）—— 该文件已有 fix_compliance 段时只改其 enforcement 值、勿整份覆写；配置每次 Stop 重读，下一次 Stop 即生效`,
    'fix_compliance:',
    '  enforcement: warn',
    '③ SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<可写目录> claude —— ⚠️ 须重启会话（hook 进程 env 取自启动快照，会话内 export 无效）',
    buildFeedbackText(verdict.missing, { diagnostics: mergedDiagnostics }),
  ].join('\n') + '\n';
}

/**
 * 降级放行：exit 0 + [GATE-DEGRADED] reason + 幂等终态双写（首次）或轻量审计（重复）。
 * @returns {number} 恒 0
 */
function releaseDegraded(projectRoot, sessionId, verdict, {
  alreadyRecorded, storageUnavailable, inFlightDeferCount = 0,
  // F270 P3：整体覆写须原样带回。刻意**无默认值**（F238 教训）：新调用点忘传时这里
  // undefined 会被 saveBlockState 归一为 0/null 抹平——归一层已兜底不炸，但 required 化
  // 让 lint/review 面能看见"忘传"，而默认值会把抹平静默化。
  nonBlockStopCount,
  extraDiagnostics: upstreamDiagnostics = [],
}) {
  const extraDiagnostics = [
    ...upstreamDiagnostics,
    ...(storageUnavailable ? ['state-storage-unavailable'] : []),
  ];
  const blockCount = BLOCK_LIMIT;
  // 存储不可用无法读写幂等标记 → 允许重复终态（宁可可审计不可静默丢失，research.md D2/D4）
  const shouldWriteTerminal = storageUnavailable || !alreadyRecorded;

  if (shouldWriteTerminal) {
    try {
      recordWorkflowRun({
        projectRoot,
        workflowId: 'spec-driver-fix',
        runId: sessionId,
        result: 'failed',
        warnings: [`${PREFIX_DEGRADED} fix 会话在 ${BLOCK_LIMIT + 1} 次不合规尝试后降级放行，缺失: ${verdict.missing.join(', ')}`],
        complianceVerdict: {
          closureForm: verdict.closureForm,
          compliant: verdict.compliant,
          missing: verdict.missing,
          degraded: true,
          blockCount,
        },
      });
    } catch {
      // 终态写入失败不得让降级路由崩溃（FR-013 精神）
    }
    // 首次降级成功后置幂等标记（存储可用时才有意义）
    if (!storageUnavailable) {
      // 同样是整体覆写：在途预算须原样带回（见 saveBlockState JSDoc）
      saveBlockState(projectRoot, sessionId, {
        blockCount, degradedRecorded: true, inFlightDeferCount,
        nonBlockStopCount,   // F270 P3：原样带回，防抹平
      });
    }
  }

  appendAuditEvent(projectRoot, buildAuditEvent({
    sessionId, enforcement: 'block', verdict, blockCount, degraded: true, extraDiagnostics,
  }));
  process.stderr.write(`${PREFIX_DEGRADED} ${buildFeedbackText(verdict.missing, { degraded: true, diagnostics: extraDiagnostics })}\n`);
  return 0;
}

/**
 * 推迟成功时的终态记录（F257 缺陷 2 · 审计可见性提档）。
 *
 * why：改造前推迟只 `appendAuditEvent`（`degraded:false`）+ `[WARN]` stderr，**不写** `record-workflow-run`
 * 终态；于是事后审计里推迟通道是零终态痕迹的，看起来就是"还有子代理在跑"。降级放行则有终态记录。
 * 两条放行路径的可见性不对等，恰好让更安静的那条成为首选绕过面。
 *
 * why `paused` 而非 `failed`：与"降级放行 = failed"区分，事后可分辨两类放行
 * （`VALID_RESULTS = success|partial|paused|failed`）。审计事件的 `degraded` 仍为 `false`，
 * contract 既有区分语义不变。
 *
 * 🔴 why 刻意**不设幂等标记**：幂等标记若存在于可被删除的状态文件里，正是缺陷 2 的根因。不设标记时
 * "状态被删"的后果是**多写**终态记录（审计更多，方向安全）。
 * ⚠️ 数量论证必须与残余同真：**不是**"单会话最多 3 条"——被判方每轮删状态时闸门二恒放行，每轮都会
 * 写一条终态，真实上界是"闸门三阈值内能塞下多少次 stop"。方向是多写审计（安全），数量受闸门三约束。
 *
 * ⚠️ 已知副作用（第 4 轮审查补登记，**本轮刻意不修**）：**`runId` 与 fix skill 不同源，会污染
 * adoption 指标。** 这里的 `runId = sessionId`，而 `skills/spec-driver-fix/SKILL.md` 收尾调用
 * `record-workflow-run` 时用的是 `--run-id "{branch_name}"`；`scripts/generate-adoption-insights.mjs`
 * 的 `dedupeRunEvents` 按 `(workflowId, runId)` 去重 ⟹ 两者落在**不同 key**，于是每个发生过推迟的
 * fix 会话会额外贡献一条独立的 `paused` run（同会话内多次推迟被 dedupe 折叠为 1 条，取最晚者），
 * 使 `totalRuns` 上浮、`successRate`（`success / totalRuns`）被下压。
 * 注：`releaseDegraded`（F208）早有同样写法，**不是本次新引入的模式**；但降级放行罕见、推迟是常规
 * 路径，量级不同，故在此显式登记。
 * 本轮不改 `runId` 的理由：改它要同时动 adoption 脚本与 skill 的 `--run-id` 契约，超出本次范围，
 * 且与既有 F208 写法保持一致更利于后续一次性收口。
 * 闭合方向（独立跟进项，二选一）：① `runId` 与 skill 对齐（判定器改用 branch_name 之类同源标识）；
 * ② 在 adoption 侧排除判定器写入的合成终态（如按 `warnings` 前缀或新增来源字段过滤）。
 *
 * 整段 try/catch（与 releaseDegraded 同规格）：终态写入失败不得让推迟路由崩溃（FR-013 精神）。
 */
function recordDeferTerminal(projectRoot, sessionId, verdict, entryCount) {
  try {
    recordWorkflowRun({
      projectRoot,
      workflowId: 'spec-driver-fix',
      runId: sessionId,
      result: 'paused',
      warnings: [`${PREFIX_WARN} fix 会话因在途委派推迟裁决（最早 fix 展开后 assistant entry=${entryCount}），缺失: ${verdict.missing.join(', ')}`],
      complianceVerdict: {
        closureForm: verdict.closureForm,
        compliant: verdict.compliant,
        missing: verdict.missing,
        degraded: false,
        blockCount: null,
      },
    });
  } catch {
    // 终态写入失败不得让推迟路由崩溃
  }
}

/**
 * FR-013 fail-open 的 loud 半边：判定能力失效时 best-effort 落盘 degraded 诊断事件，
 * 使"漏拦"在事后审计中可被发现而非彻底隐没。写入自身失败不得影响放行（双重兜底）。
 */
function tryAppendFailOpenEvent(projectRoot, sessionId, enforcement, diagnostics, configDiagnostics = []) {
  try {
    // 合并配置层诊断（如 config-degraded）——配置非法与判定异常同时发生时两类信息都不得丢失
    // （codex implement 审查 W-2，FR-015 可追溯性）
    const merged = [...new Set([
      ...(Array.isArray(configDiagnostics) ? configDiagnostics : []),
      ...(Array.isArray(diagnostics) ? diagnostics : []),
    ])];
    appendAuditEvent(projectRoot, {
      schemaVersion: 1,
      eventType: 'fix-compliance-verdict',
      recordedAt: new Date().toISOString(),
      sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : 'unknown',
      enforcement: enforcement === 'warn' ? 'warn' : 'block',
      closureForm: 'undetermined',
      compliant: null,
      missing: [],
      blockCount: null,
      degraded: true,
      diagnostics: merged,
    });
  } catch {
    // 诊断落盘失败不得让 fail-open 路径崩溃
  }
}

/**
 * hook 模式主路由。
 * @returns {number} 退出码
 */
function runHook(projectRoot, payload) {
  // FR-015 判定顺序：(1) 非抛出式配置解析 →(2) off 立即零接触退出（在任何 transcript 读取之前）
  const cfg = findAndParseConfig(projectRoot);
  if (cfg.enforcement === 'off') return 0;

  const result = evaluate(projectRoot, payload.transcript_path, cfg, payload.session_id);

  // transcript 不可用/超限 → FR-013 fail-open 放行 + loud 诊断落盘（合并配置层诊断）
  if (result.transcriptDiagnostics.length > 0) {
    // 账本诊断并入：本路径亦可由账本补充触发（见 evaluate 的 featureDirUndetermined 早退）
    tryAppendFailOpenEvent(
      projectRoot, payload.session_id, cfg.enforcement,
      [...result.transcriptDiagnostics, ...(result.ledgerDiagnostics || [])],
      cfg.diagnostics,
    );
    return 0;
  }
  // 非 fix 会话 → 零接触放行（US5：健康路径不产生任何落盘），不 reset 保持零落盘语义
  if (!result.isFix || !result.verdict) return 0;
  // 合规 → 重置该 session 阻断状态（补救成功清零转移，FR-006 增补）后静默放行。
  // 无条件调用（不区分 block/warn）：warn 档从不 bump 计数、其状态文件本就不存在，
  // reset 对其为空操作；off 档已在函数入口短路，永不触达此分支。
  if (result.verdict.compliant) {
    resetBlockState(projectRoot, payload.session_id);
    // F270 P2b（FR-024 修订版 / R-2 收口）：曾 fix 展开的会话，**合规裁决也必须留痕**。
    // 原实现此处零落盘——与 !isFix 早退共同构成"事后完全不可见"的审计黑洞（F257 遗留，
    // A-3 点名的两条中真正一直漏的这条）。落盘失败不得影响放行（try 包裹，与 fail-open
    // 路径同纪律）。US5 不受影响：能走到这里 isFix 必为 true（曾 fix 展开），非健康路径。
    try {
      appendAuditEvent(projectRoot, buildAuditEvent({
        sessionId: payload.session_id,
        enforcement: cfg.enforcement,
        verdict: result.verdict,
        blockCount: null,
        degraded: false,
        // 🔴 集成 review CRITICAL-3：账本补充把裁决翻成合规，正是 D-1 下界（账本可写、只防
        // 疏忽）的**唯一**补偿控制点，必须留痕。此前该早退不传 extraDiagnostics，导致
        // `ledger-supplemented-role` 恰好在唯一有安全意义的路径上丢失——补充没改变结论时留痕、
        // 补充翻成放行时反而无痕，可见性与重要性完全反相关；伪造通过与诚实通过在审计流里
        // 逐字节相同。judge:474-481 声称的「不再零留痕」由这一行兑现。
        extraDiagnostics: result.ledgerDiagnostics || [],
      }));
    } catch {
      // 审计落盘失败不得让合规放行崩溃
    }
    return 0;
  }

  const sessionId = payload.session_id;

  // F270 P3 · 必答③重入语义（P3 对抗 CRITICAL-1 修订：**撤销提前放行**）。
  // 初版把 `stop_hook_active===true` 接成"不得阻断、必放行"（走一条独立的解锁计时器路由），
  // 对抗实跑证伪：
  //   - 它把最短完全绕过从「2 次 exit 2 + failed 终态」砍到「1 次 exit 2 + 零终态零 stderr」——
  //     惩罚动作（exit 2）本身生成豁免（下一次 Stop 即重入），是最坏形态的 self-inducible；
  //   - 它唯一声称的收益（防阻断死循环）在既有 BLOCK_LIMIT=2 下**本就不存在**——exit 2 已被
  //     有界化为 2 次，第 3 次走 releaseDegraded 放行，循环天然终止。收益为零、净损一格预算。
  //   ⚠️ 诚实登记：spec.md 的必答③ 自初始 docs commit 起、直到本卡六个 Phase 全部落地为止
  //   **一字未改**，仍写着「`stop_hook_active===true` 时判定器不得再次产生阻断、必须放行」+
  //   「计入 `nonBlockStopCount`」，与本实现（纯诊断、照常阻断、不计任何计数）**相反**。
  //   该矛盾已在集成 review 中补记进 spec.md 的 §0-pre 偏离登记（"以实现为准"）。
  //   FR-029「重入不计 blockCount」同样未实现，属后续卡范围。
  // 终版语义：重入**不改变任何路由**——裁决/预算/终态与非重入逐字一致（=改动前行为），仅把
  // `stop-hook-reentry` 诊断码如实并入本次审计（新增纯可观测性）。非布尔取值同样只影响该码的
  // 缺席，不影响裁决（对上游序列化行为的假设不成立时不做任何判定分支）。
  const reentryDiagnostics = payload.stop_hook_active === true ? ['stop-hook-reentry'] : [];

  // F256 盲区 2：判定时机未到——存在在途委派时**有界地**推迟裁决，不消耗阻断预算。
  //
  // 放行=推迟而非豁免，但这一语义**只在推迟有界时成立**。第 1 轮实现曾论证"每个在途委派最终都会
  // 回收完成通知，届时在途集合已空"，该前提已被实测证伪（202 次后台派发中 43 次、21.3% 的通知
  // 从未到达，见 IN_FLIGHT_DEFER_LIMIT 的 JSDoc）。故推迟由两道闸门共同约束：
  //   闸门一（可推迟性 / isDeferrableMissingSet）：缺口必须**全部**是在途工作有可能关闭的类型。
  //     feature-dir、fix-report.md 是主线程自己该产出的制品，子代理回收再多次也不会补上它们，
  //     对这类缺口推迟纯属延误（实测 174 个不合规会话中 9 个、5.2% 曾因此被静默推迟）。
  //   闸门二（次数预算 / IN_FLIGHT_DEFER_LIMIT）：与 blockCount 分列的独立计数，
  //     耗尽后恢复正常裁决并在审计事件里留 delegation-in-flight-budget-exhausted。
  //   闸门三（会话长度预算 / EARLIEST_FIX_ENTRY_DEFER_LIMIT，F257 缺陷 2）：自**最早**一次 fix 展开
  //     之后的 assistant entry 总数。闸门二的计数寄存在 projectRoot 下、被 gitignore 的状态文件里，
  //     每轮 stop 前 `rm -rf` 该目录即可让它永久归零（实测 10 轮全 exit 0、零终态记录），
  //     故闸门二**单独不构成上界**；闸门三的计量源派生自 transcript，被判方不经手写入、只增不减。
  //
  // 🔴 三道闸门取**合取（AND）**：任一不满足即不推迟。绝不能写成 `||`——那等于两道预算互相赦免，
  // 缺陷 2 原样存活（变异 M-5 专钉这一点）。
  //
  // 四条不推迟的出口都**方向一致地落回正常裁决**（fail-closed）：缺口不可推迟 / 次数预算耗尽 /
  // 会话长度预算耗尽 / 计数持久化失败。其中持久化失败必须不推迟——维持不了计数就不能开推迟通道，
  // 与 routeBlock 里"存储不可用即等同已达上限"的既有取舍同源。
  //
  // 如实登记（禁止读成"消除"）：闸门三**不消除**"删状态文件绕过闸门二"这一手法本身，只给它加了一条
  // 抹不掉的天花板——把「永久免于裁决」降级为「约 140 轮内免于裁决」。
  //
  // 插入点在 compliant 早退之后、warn 分支之前，对 block/warn 两档一视同仁：warn 档本就 exit 0，
  // 但若落在其后会把"时机未到"误记为"真实不合规"审计事件。两档退出码语义均不变，仅审计更准确。
  // F270 P3（FR-014/015 三态）：在途判定优先用 harness 权威字段 `background_tasks`（P-12 真实
  // Stop 直证：非空⟺真有在途，Gw 过滤器只收 running/pending）。三态处置：
  //   in-flight    → 确证在途（并入诊断码，进入既有三闸门推迟逻辑——闸门/预算照旧，FR-016/019：
  //                  推迟消耗 inFlightDeferCount 不动 blockCount，delta C-2 裁决）
  //   no-in-flight → 权威确证**无**在途 → 不推迟，按正常收口判据裁决（US2-AS2；transcript 派生的
  //                  "未见回收"让位于 harness 实时事实——21.3% 通知不达正是 transcript 派生的假在途源）
  //   undetermined → 键缺席/形状异常（老版本 harness、Codex、toolUseContext 缺席）→ **退回既有
  //                  transcript 派生判定**（向后兼容，C-2：探测不到≠确证无在途，坍缩即恢复误 block）
  const inFlightVerdict = classifyInFlightFromPayload(payload);
  let hasInFlight;
  if (inFlightVerdict.state === IN_FLIGHT_STATES.IN_FLIGHT) {
    hasInFlight = true;
  } else if (inFlightVerdict.state === IN_FLIGHT_STATES.NO_IN_FLIGHT) {
    hasInFlight = false;
  } else {
    hasInFlight = Array.isArray(result.inFlightDelegations) && result.inFlightDelegations.length > 0;
  }
  const deferExtraDiagnostics = [...reentryDiagnostics, ...(result.ledgerDiagnostics || [])];
  // 三态诊断码的可见面收窄（P3 对抗 B-必答④）：`buildFeedbackText` 会把 diagnostics 渲染进
  // 用户可见 stderr——无条件 push 会让每次 warn/降级都带"诊断: in-flight-none"类内部码噪声。
  // 只有 undetermined（探测异常态）值得进 warn/block 文案；in-flight 态的码走推迟成功审计
  // （那条审计单独写 extraDiagnostics）；no-in-flight 是平凡态，不进文案。
  if (inFlightVerdict.state === IN_FLIGHT_STATES.UNDETERMINED) {
    deferExtraDiagnostics.push(inFlightVerdict.diagnostic);
  }
  if (hasInFlight && isDeferrableMissingSet(result.verdict.missing)) {
    const loaded = loadBlockState(projectRoot, sessionId);
    const entryCount = typeof result.assistantEntriesSinceEarliestFix === 'number'
      ? result.assistantEntriesSinceEarliestFix
      : Number.POSITIVE_INFINITY;                    // 计量缺席 → 视同预算耗尽（fail-closed）
    const countBudgetLeft = loaded.inFlightDeferCount < IN_FLIGHT_DEFER_LIMIT;  // 闸门二（可被抹除）
    const entryBudgetLeft = entryCount < EARLIEST_FIX_ENTRY_DEFER_LIMIT;         // 闸门三（单调，抹不掉）
    if (countBudgetLeft && entryBudgetLeft) {
      // 先持久化再推迟：计数写不进去就等于没有上界，此时宁可照常裁决
      const saved = saveBlockState(projectRoot, sessionId, {
        blockCount: loaded.blockCount,               // 推迟不动阻断预算（整体覆写，须原样带回）
        degradedRecorded: loaded.degradedRecorded,
        inFlightDeferCount: loaded.inFlightDeferCount + 1,
        nonBlockStopCount: loaded.nonBlockStopCount,             // F270 P3：原样带回，防抹平
      });
      if (saved.ok) {
        // 审计提档：推迟不再是零终态痕迹的静默通道（F257 缺陷 2）
        recordDeferTerminal(projectRoot, sessionId, result.verdict, entryCount);
        appendAuditEvent(projectRoot, buildAuditEvent({
          sessionId, enforcement: result.enforcement, verdict: result.verdict,
          blockCount: null, degraded: false,
          // 账本诊断并入（对抗 E WARNING-4）：推迟同时写 `paused` 终态，会话若就此结束，
          // 账本对该次裁决的影响将永不落账——与合规/降级两条路径同一立论。
          extraDiagnostics: ['delegation-in-flight', inFlightVerdict.diagnostic, ...(result.ledgerDiagnostics || [])],
        }));
        process.stderr.write(`${PREFIX_WARN} ${buildFeedbackText(result.verdict.missing, { diagnostics: ['delegation-in-flight'] })}\n`);
        return 0;
      }
      deferExtraDiagnostics.push('state-storage-unavailable');
    } else {
      // 两道预算分别给码：事后可区分"次数用尽"与"会话过长"，两者可同时出现
      if (!countBudgetLeft) deferExtraDiagnostics.push('delegation-in-flight-budget-exhausted');
      if (!entryBudgetLeft) deferExtraDiagnostics.push('delegation-in-flight-entry-budget-exhausted');
    }
  }

  if (result.enforcement === 'warn') {
    appendAuditEvent(projectRoot, buildAuditEvent({
      sessionId, enforcement: 'warn', verdict: result.verdict, blockCount: null, degraded: false,
      extraDiagnostics: deferExtraDiagnostics,
    }));
    process.stderr.write(`${PREFIX_WARN} ${buildFeedbackText(result.verdict.missing)}\n`);
    return 0;
  }

  // enforcement=block
  return routeBlock(projectRoot, sessionId, result.verdict, deferExtraDiagnostics, {
    // F276 卡 C：`!saved.ok` 分支的上界计量源。routeBlock 侧对「缺席 / 非有限数」做 fail-closed 归一
    // （按 0 记 ⟹ 一律阻断），why 不用「忘传即炸」见其 JSDoc（IW-1：顶层 catch 会把 TypeError 兜成放行）。
    storageUnavailableFeedbackCount: result.storageUnavailableFeedbackCount,
  });
}

// ────────────────────────────────────────
// report 模式（只读，恒 exit 0，仅 stdout verdict JSON）
// ────────────────────────────────────────

function runReport(projectRoot, transcriptPath, reportSessionId = null) {
  const result = evaluate(projectRoot, transcriptPath, null, reportSessionId);
  const out = {
    mode: result.mode,
    fixSession: result.isFix,
    enforcement: result.enforcement,
    configDegraded: result.configDegraded,
    transcriptDiagnostics: result.transcriptDiagnostics,
    // 账本诊断进 report（对抗 D WARNING-3）：`inFlightDelegations` /
    // `assistantEntriesSinceEarliestFix` 已按「事实字段透传」先例入 report，账本是否补充过
    // 委派同属事实，缺它则账本翻转裁决在离线复核路径上完全不可见。
    ledgerDiagnostics: result.ledgerDiagnostics || [],
    // F256 盲区 2：在途委派事实透传，供 --mode report 端到端复现与事后审计核对
    inFlightDelegations: result.inFlightDelegations || [],
    // F257 缺陷 2：闸门三的计量源透传。与 inFlightDelegations 同为**事实字段**——
    // report 模式不施加任何闸门、不落盘，故该值大于阈值**不**等于本次会被阻断。
    assistantEntriesSinceEarliestFix: typeof result.assistantEntriesSinceEarliestFix === 'number'
      ? result.assistantEntriesSinceEarliestFix
      : null,
    ...(result.verdict || {}),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

// ────────────────────────────────────────
// main（顶层 try/catch 兜底 FR-013）
// ────────────────────────────────────────

export function main(argv, stdinRaw) {
  const args = parseArgs(argv);
  try {
    if (args.mode === 'report') {
      // report 优先用 --transcript-path，缺省时回落 stdin payload
      let transcriptPath = args.transcriptPath;
      let reportSessionId = null;
      // F270 P4：report 模式也从 stdin payload 取 session_id（账本按 session 分文件），
      // 便于端到端复现账本委派接入；仅 --transcript-path 无 payload 时账本按缺席处理。
      {
        const parsed = readHookPayload(stdinRaw);
        if (parsed.ok) {
          if (!transcriptPath) transcriptPath = parsed.payload.transcript_path;
          reportSessionId = typeof parsed.payload.session_id === 'string' ? parsed.payload.session_id : null;
        }
      }
      return runReport(args.projectRoot, transcriptPath, reportSessionId);
    }
    // hook 模式：stdin payload 必需
    const parsed = readHookPayload(stdinRaw);
    if (!parsed.ok) {
      // payload 非法 → FR-013 fail-open 放行 + loud 诊断落盘（off 档除外，维持零接触）
      const cfg = findAndParseConfig(args.projectRoot);
      if (cfg.enforcement !== 'off') {
        tryAppendFailOpenEvent(args.projectRoot, null, cfg.enforcement, ['payload-invalid'], cfg.diagnostics);
      }
      return 0;
    }
    return runHook(args.projectRoot, parsed.payload);
  } catch {
    // 任何未预期异常 → fail-open 放行（FR-013）+ best-effort loud 诊断（自身再失败则彻底静默放行）
    try {
      const cfg = findAndParseConfig(args.projectRoot);
      if (cfg.enforcement !== 'off') {
        tryAppendFailOpenEvent(args.projectRoot, null, cfg.enforcement, ['internal-error'], cfg.diagnostics);
      }
    } catch {
      // 连诊断都写不了 → 仍然放行
    }
    return 0;
  }
}

// 仅作为入口脚本直接运行时执行（被 import 时不触发，便于单测）
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const argv = process.argv.slice(2);
  const stdinRaw = readStdinSync();
  const code = main(argv, stdinRaw);
  process.exit(code);
}
