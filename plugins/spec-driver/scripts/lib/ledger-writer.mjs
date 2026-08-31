/**
 * ledger-writer.mjs
 * F270 P1 — 会话证据账本采集器（PostToolUse 侧写入）
 *
 * 职责边界（plan §4a）：读 payload → 裁剪 → appendFileSync 一行 JSONL → 恒成功退出。
 * 不判定、不读回、不阻断；判定链在 Stop 侧（P4 接入 ledger-reader）。
 *
 * 承重设计前提（research/harness-field-probe.md，全部本机实测）：
 * - P-7：`appendFileSync`（O_APPEND）多进程并发对常规文件原子（8 进程 × 60KB 零撕裂），
 *   故单条一次写完即可，**刻意不加锁**——锁是为不存在的问题引入新失败面。
 *   ⚠️ 该保证限本地文件系统；NFS/FUSE 上可能出残缺行，读取侧（P4）按行独立解析坏行跳过兜底。
 * - P-8/P-11：payload 单条可达 102KB（`tool_response.prompt` 携子代理完整 prompt）——
 *   **绝不整存 tool_response / tool_input**，只取判定所需字段（见 buildLedgerEntry）。
 * - C-1：payload 无任何时间戳字段，`hookTs` 由本进程生成，语义是「hook 执行时刻」
 *   而非「工具调用时刻」，两者偏差不可消除（FR-003 要求显式声明，即此注释）。
 * - C-10（P-4 实测）：PostToolUse 返回非零不阻断工具，但会向 agent 上下文注入
 *   `hook blocking error` 噪声——故 CLI 形态**任何路径恒 exit 0，零 stdout/stderr**；
 *   失败详情只进同目录 `.ledger-selfdiag.jsonl`（它自己失败则彻底静默）。
 * - C-12：Codex 会读插件 hooks.json，其 payload 形状与 Claude 不同——缺
 *   `session_id`/`tool_use_id` 的一律按方言静默跳过（记 selfdiag dialect-skip）。
 *
 * 体积上限（FR-011）：写前 stat，≥ LEDGER_MAX_BYTES 不再追加、记 selfdiag oversize。
 * 超限语义由读取侧（P4）按「证据不完整 → 回退 transcript」处理，采集侧不在账本内做标记。
 *
 * 活性哨兵（FR-043/044 的 P1 侧）：某 session 首建账本文件时先写一条
 * `{type:"ledger-open"}`。使读取侧能区分「文件存在+有哨兵+锚点后无委派条目 =
 * 采集器活着、本段确实无委派」与「文件不存在 = 缺席（可能没装/没生效）」。
 * 并发首建下可能出现双哨兵（exists 检查与两次 append 非原子）——可接受，
 * 读取侧对哨兵幂等；数据条不受影响（各自独立 append）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSessionId } from './fix-compliance-io.mjs';
import { isInvokedDirectly } from './is-invoked-directly.mjs';

/** 账本目录（相对 projectRoot），与状态目录 `.fix-compliance-state` 同族并列 */
export const LEDGER_SUBDIR = ['.specify', 'runs', '.fix-compliance-ledger'];

/** 账本单文件体积上限：1MB（SC-011 建议值；超限按证据不完整处理，FR-011） */
export const LEDGER_MAX_BYTES = 1_048_576;

/** 自诊断文件名（与账本同目录；点前缀避开数据文件通配） */
const SELFDIAG_BASENAME = '.ledger-selfdiag.jsonl';

/** 委派类工具名：从 tool_input 提取 subagent_type 全值（FR-048 去重键需全值不截断） */
const DELEGATION_TOOL_NAMES = new Set(['Agent', 'Task']);

/** 账本数据文件绝对路径 */
export function ledgerPathFor(projectRoot, sessionId) {
  return path.join(projectRoot, ...LEDGER_SUBDIR, `${sanitizeSessionId(sessionId)}.jsonl`);
}

function selfdiagPath(projectRoot) {
  return path.join(projectRoot, ...LEDGER_SUBDIR, SELFDIAG_BASENAME);
}

/** 自诊断追加：自身任何失败彻底静默（最后一道兜底不能再有兜底） */
function appendSelfdiag(projectRoot, record) {
  try {
    // 🔴 自诊断同样受 US5 闸门约束（对抗 E CRITICAL-2 向量①）：本函数自己 mkdirSync，
    // 而 `main()` 的 payload 解析失败分支直接调它、**不经过** appendLedgerEntry 的闸门 →
    // 一次畸形 stdin 就在无关项目建出 `.specify/runs/`，把「目录里有别的条目」型判据翻成永真。
    // 兜底路径不能比主路径宽。
    if (!isSpecDriverProject(projectRoot)) return;
    const dir = path.join(projectRoot, ...LEDGER_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      selfdiagPath(projectRoot),
      `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`
    );
  } catch {
    /* 彻底静默 */
  }
}

/**
 * 从 tool_response 保守提取布尔成败信号。
 * ⚠️ **非承重字段**：委派判定（P4）不依赖它——`Agent` 的 tool_response 是派发回执
 * （async_launched）而非完成回执（P-11），"成功"只表示"调用被受理"。拿不准一律 true。
 */
function deriveOk(toolResponse) {
  if (toolResponse === null || typeof toolResponse !== 'object') return true;
  if (toolResponse.is_error === true) return false;
  if (toolResponse.interrupted === true) return false;
  return true;
}

/**
 * 裁剪 payload → 账本条目（纯函数，不触盘）。
 * 字段合同（FR-002）：v/tool_use_id/tool_name/prompt_id/session_id/hookTs/ok 恒有；
 * agent_id/agent_type 仅 payload 提供时透传（缺席即缺席——主线程判据是键缺席，C-4）；
 * subagent_type 仅委派类工具且 tool_input 有值时存全值。
 */
export function buildLedgerEntry(payload) {
  const entry = {
    v: 1,
    tool_use_id: payload.tool_use_id,
    tool_name: payload.tool_name,
    prompt_id: typeof payload.prompt_id === 'string' ? payload.prompt_id : null,
    session_id: payload.session_id,
    hookTs: new Date().toISOString(),
    ok: deriveOk(payload.tool_response),
  };
  // 🔴 与 reader 的归属判据**必须同为键存在性**（对抗 E CRITICAL-1）。初版这里是值判定
  // `typeof === 'string'`，于是 `agent_id: null/0/false/{}` 的条目**键被抹掉**，reader 那侧
  // 再怎么按 `Object.hasOwn` 加固也见不到它们 → 判为主线程 → CRITICAL-1 病灶对这些上游形态
  // 完整复活，且翻转诊断（挂"命中数==总数"）在一条都没命中时结构性不响。消费侧单独加固
  // 无效：谓词不对称时，**严的那侧被松的那侧决定**。
  // `undefined` 归一为 null：JSON.stringify 会丢掉值为 undefined 的键，那会把"键存在"这一
  // 承重事实在落盘时抹掉。
  if (Object.hasOwn(payload, 'agent_id')) {
    entry.agent_id = payload.agent_id === undefined ? null : payload.agent_id;
  }
  if (typeof payload.agent_type === 'string') entry.agent_type = payload.agent_type;
  if (DELEGATION_TOOL_NAMES.has(payload.tool_name)) {
    const st = payload.tool_input?.subagent_type;
    if (typeof st === 'string' && st.length > 0) entry.subagent_type = st;
  }
  return entry;
}

/** payload 是否具备 Claude PostToolUse 最小形状；否则按 Codex 等方言静默跳过（C-12） */
function isClaudeShape(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof payload.session_id === 'string' &&
    payload.session_id.length > 0 &&
    typeof payload.tool_use_id === 'string' &&
    typeof payload.tool_name === 'string'
  );
}

/**
 * 追加一条账本记录。
 * @returns {{ok: true} | {ok: false, reason: string}} —— 仅供测试/调用方观察，
 * CLI 形态无论返回什么都 exit 0（C-10）。
 */
/**
 * 是否**跑过 spec-driver 流程**的项目（US5 闸门判据）。
 *
 * 🔴 判据不能是「`.specify/` 存在」（初版如此，被对抗 D CRITICAL-1 实证击穿）：
 * `scripts/postinstall.sh:40` 在 SessionStart（`hooks.json` 里 matcher 为空＝**每个项目、
 * 每次会话**）无条件 `mkdir -p "$PROJECT_DIR/.specify"` 并写入 `.spec-driver-path`。
 * SessionStart 必然早于任何 PostToolUse，故该判据在装了插件的**任何**项目里恒为真，
 * 闸门对它要拦的病灶零效力。
 *
 * 也不能是「`.specify/` 里除那枚路径指针外还有别的条目」（第二版如此，被对抗 E CRITICAL-2
 * 实证**自举打开**）：`runs/` 由判定器 fail-open 审计与本采集器自诊断建，`.DS_Store` 由 Finder
 * 建——任一出现即让判据永真，且**不可逆**（第一次落盘就把闸门焊死在开）。
 *
 * 故取**白名单**：只认 `spec-driver init` / 流程本身产出的标志物，运行态目录一律不算。
 *
 * 判不出来一律按「否」：采集器宁可不记（判定器退回纯 transcript ＝ F270 之前的基线，
 * 上界已实证有界），也不在无关项目里落任何东西。
 */
/**
 * `spec-driver init` / 流程本身产出的结构性标志（**白名单**）。
 * 刻意不含 `runs/`（判定器审计与本采集器自诊断都会建它）、不含 `.spec-driver-path`
 * （postinstall 每个项目都写）——见下方 why。
 */
const SPEC_DRIVER_PROJECT_MARKERS = Object.freeze([
  'project-context.yaml',
  'project-context.md',
  'orchestration-overrides.yaml',
  'templates',
  'memory',
  'scripts',
]);

function isSpecDriverProject(projectRoot) {
  try {
    const entries = new Set(fs.readdirSync(path.join(projectRoot, '.specify')));
    return SPEC_DRIVER_PROJECT_MARKERS.some((m) => entries.has(m));
  } catch {
    return false;
  }
}

export function appendLedgerEntry(projectRoot, payload) {
  // 🔴 US5 闸门（集成 review CRITICAL-2，实跑复现）：非 spec-driver 项目**零落盘**。
  //
  // 病灶：hooks.json 的全量 matcher 让本采集器对每一次工具调用触发，而此处原先无任何项目
  // 判断 → 在一个从未用过 spec-driver 的空目录里跑单次 Read，即凭空创建
  // `.specify/runs/.fix-compliance-ledger/<sid>.jsonl`。装了插件的用户**每个项目、每次工具
  // 调用**都被写盘，纯问答会话也不例外。
  //
  // F270 spec.md:600 已警告全称落盘义务「会在无关用户项目里创建 .specify/」，但那次收窄只
  // 应用到了判定器的 FR-024，漏了同一张卡新增的采集器；F240/F208 US5 的既有守卫只跑
  // fix-compliance-judge.mjs，对本采集器结构性失明。
  //
  // 闸门置于**函数最前**（早于 isClaudeShape）：`appendSelfdiag` 自身也 mkdirSync，方言跳过
  // 与写失败两条兜底路径若在闸门之前就会穿透它。
  //
  // ⚠️ 如实登记（对抗 D）：本闸门只管采集器。判定器自身的 fail-open 路径（畸形 payload →
  // `payload-invalid` 审计）同样会在非 spec-driver 项目建 `.specify/`，那条不在本次范围内。
  // 采集器侧真正减污染的是本闸门 + matcher 收窄为 `Agent|Task` 两者叠加。
  if (!isSpecDriverProject(projectRoot)) {
    return { ok: false, reason: 'not-spec-driver-project' };
  }
  try {
    if (!isClaudeShape(payload)) {
      appendSelfdiag(projectRoot, { kind: 'dialect-skip' });
      return { ok: false, reason: 'dialect-skip' };
    }
    const filePath = ledgerPathFor(projectRoot, payload.session_id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let existingBytes = 0;
    let exists = false;
    try {
      existingBytes = fs.statSync(filePath).size;
      exists = true;
    } catch {
      /* 不存在 → 首写 */
    }
    if (existingBytes >= LEDGER_MAX_BYTES) {
      appendSelfdiag(projectRoot, {
        kind: 'oversize',
        session_id: sanitizeSessionId(payload.session_id),
        bytes: existingBytes,
      });
      return { ok: false, reason: 'oversize' };
    }
    if (!exists) {
      // 首建先落活性哨兵；并发首建可能双哨兵，读取侧幂等（见文件头注释）
      fs.appendFileSync(
        filePath,
        `${JSON.stringify({
          v: 1,
          type: 'ledger-open',
          session_id: sanitizeSessionId(payload.session_id),
          hookTs: new Date().toISOString(),
        })}\n`
      );
    }
    fs.appendFileSync(filePath, `${JSON.stringify(buildLedgerEntry(payload))}\n`);
    return { ok: true };
  } catch (err) {
    appendSelfdiag(projectRoot, {
      kind: 'write-error',
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'write-error' };
  }
}

// ────────────────────────────────────────
// CLI 形态（bash 薄壳对接）：stdin 读 payload → append → 恒 exit 0、零输出
// ────────────────────────────────────────

function parseProjectRoot(argv) {
  const i = argv.indexOf('--project-root');
  if (i !== -1 && typeof argv[i + 1] === 'string') return argv[i + 1];
  return process.cwd();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const projectRoot = parseProjectRoot(process.argv.slice(2));
  let raw = '';
  try {
    raw = await readStdin();
  } catch {
    process.exit(0);
  }
  if (raw.trim().length === 0) process.exit(0);
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    appendSelfdiag(projectRoot, { kind: 'payload-parse-error' });
    process.exit(0);
  }
  try {
    appendLedgerEntry(projectRoot, payload);
  } catch {
    /* appendLedgerEntry 自身已兜底，这里防未知抛出 */
  }
  process.exit(0);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch(() => process.exit(0));
}
