/**
 * codex-hooks-list-probe.mjs
 * Feature 275 / plan §3.2b — 独立探针 helper：驱动一次 `codex app-server` 的 `hooks/list`
 * RPC，识别我方插件在 Codex 原生注册路径下的真实 `trustStatus`。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 为什么是一个独立文件，而不是把逻辑写进 `codex-runtime-doctor-io.mjs`（plan §4.1/§4.2）
 *
 * Phase 0 实测证明：合法拿到 `hooks/list` 数据必须**异步持有 stdin** 直到 `id:2` 响应
 * 到达（同步的「写完即视为 EOF」写法会在响应产生前就关闭管道，拿不到数据）。这要求
 * 监听 `child` 上原始 stdout 数据事件的写法 —— 而这恰好是三个既有生产文件（core/io/cli）
 * 的静态守卫零容忍的写法。因此本文件是唯一允许出现这段代码的地方，且该代码段被一对
 * 全文件唯一的标记注释包裹（见下方 `readAppServerResponse` 函数体内、紧贴该数据事件
 * 监听逻辑处），供 `codex-runtime-doctor-redaction.test.ts` 的静态守卫精确豁免（而不是
 * 放宽三个既有生产文件的守卫范围）。**本段说明文字刻意不重复该标记的字面量**，
 * 以保证标记对在全文件中严格出现且仅出现一次（守卫测试断言之一）。
 *
 * 🔴 本文件恒以退出码 0 结束（`main` 的 try/catch 兜底 + 恒 `process.exit(0)`）——
 * 失败信息编码进返回值的 `outcome`/`errorClass`，不用非零退出码表达，因为非零退出会让
 * `io.mjs` 的 `runCommand` catch 分支把"探测到了一个失败态"误判为"探测彻底失败"。
 *
 * 🔴 `deriveResult` 只读结构化字段做布尔/枚举判断，从不把 `sourcePath`/`pluginId`/
 * `command`/`key` 等自由文本字段写进返回值（FR-012 值级 typed schema 原则在本文件的延续）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 F275 对抗审查后修订（终版裁决表，2026-08-31）
 *
 * - A1：挂 `child.on('close', …)`。子进程秒退且尚未 settle（既没拿到 id:2，也没走 error/
 *   timeout 分支）→ `exited-early`，按退出码区分 `non-zero-exit` / `rpc-error`。缺失该监听器
 *   时，子进程静默退出会让 helper 一直等到硬 deadline 才落 `timeout`，白白等满整个窗口且
 *   误报成"超时"而非"进程提前退出"（M1/W-1/I1）。
 * - A2：区分 JSON-RPC 的成功响应与错误响应。`-32601`（Method not found）在 Codex 语境下等价
 *   于"这个版本的 app-server 根本没有 `hooks/list` 方法" —— 与"二进制缺失"同一处置方向
 *   （`not-executable`，回退合并器判据），其余错误码保守按 `error/rpc-error` 处理（C-3）。
 * - A3：spawn 失败的 errno 类别透传（不再把 EACCES 之类压成 `unknown`），供 core 层 tie-break
 *   使用真实 errno 而不是被抹平的 `unknown`（W-2/C4）。
 * - A4：`deriveResult` 的 cwd 匹配收窄——单条数据直接取用（本探针恒发单 cwd 请求），
 *   多条按精确 cwd 匹配，匹配不到或形状不对 → `error/parse-failed`，不再静默落 `absent`
 *   （`absent` 收窄为"结构完好、确证我方条目为 0"这一种事实，M2/W1/I-1）。
 * - A5：我方条目数为 0 时，若响应的 `warnings`/`errors` 提及 `spec-driver`，说明 Codex
 *   自己报告了我方 hook 的加载问题，不能被静默读成"确证没有"（C1/W-4）。
 * - A6：`isOwnPluginHookEntry` 按 `source` 分层——`source==='plugin'` 只认 `pluginId`/
 *   `sourcePath` 两个结构化字段，不再看 `command`（避免第三方插件的 command 提及我方路径
 *   被误认领，C2）；其余 source（`user`/`project` 等，`pluginId` 恒为 `null`）保留
 *   `command` 层判据（否则合并器/项目级我方条目认不出，C3）。
 * - A7：stdout 缓冲区 1MB 硬上限，超限即视为不可解析。
 * - A8：`process.stdout.write` 用回调确保 flush 后再 `process.exit(0)`，避免管道截断。
 *
 * 运行相关测试：
 *   npx vitest run tests/unit/codex-hooks-list-probe.test.ts
 *   npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { isOwnedEntry } from './codex-hooks-schema.mjs';
import { isInvokedDirectly } from './is-invoked-directly.mjs';

/** helper 内部等待 `id:2` 的 deadline（plan §4.5 推导：3000ms 的 2 倍余量） */
export const HOOKS_LIST_DEADLINE_MS = 6000;

/** stdout 缓冲区硬上限（字节近似值，防御异常大响应/无限增长，A7） */
const HOOKS_LIST_BUFFER_LIMIT_BYTES = 1024 * 1024;

/**
 * `hooks/list` 报告的 `trustStatus` 原始值闭集（plan §2 / F275 §1.3）。
 * 命中的我方条目若其值不在此闭集内 → 协议漂移，`deriveResult` 整体判 `error`。
 *
 * 🔴 D4：本数组的字面量文本须与 `codex-runtime-doctor-io.mjs`（`RAW_NATIVE_TRUST_VALUES`）、
 * `codex-runtime-doctor-core.mjs`（`NATIVE_TRUST_VALUE_SET`）逐字一致——三处各自维护同一份
 * 四值闭集，漂移会导致某一层悄悄放行/拒绝一个其余两层不认的值。一致性由
 * `codex-runtime-doctor-redaction.test.ts` 的跨文件字面量测试守护，不要手改其中一处。
 */
const NATIVE_TRUST_VALUES = Object.freeze(['managed', 'untrusted', 'trusted', 'modified']);

/**
 * 我方 `sourcePath` 的形态锚点（§1.3 第 3 层判据）：
 * `.../plugins/cache/<任意 marketplace>/spec-driver/<任意版本>/hooks/hooks.json`
 */
const OWN_SOURCE_PATH_RE = /\/plugins\/cache\/[^/]+\/spec-driver\/[^/]+\/hooks\/hooks\.json$/;

/** spawn 失败时保真透传的 errno 类别（A3）：均映射为 `not-executable`（"二进制不可用"这一大类） */
const SPAWN_ERRNO_CLASSES = Object.freeze(['ENOENT', 'EACCES', 'ENOTDIR', 'ELOOP']);

/**
 * 构造两行 NDJSON 请求（plan §4.6，逐字沿用 Phase 0 已确认的协议内容）。
 * 不加 `jsonrpc` 字段、不加 `notifications/initialized` 通知行。
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function buildHooksListRequest(projectRoot) {
  return [
    JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'codex-runtime-doctor', version: '1' } },
    }),
    JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [projectRoot] } }),
    '',
  ].join('\n');
}

/**
 * 判定 hooks/list 条目是否为我方插件条目（F275 对抗审查后修订，A6）。
 *
 * 🔴 `source==='plugin'` 只认**结构化**两层（`pluginId` / `sourcePath`），不看 `command`——
 * 第三方插件的 command 字符串提及我方脚本路径（如 `echo /x/spec-driver/hooks/stop-task-check.sh`）
 * 曾被旧版误认领（假阴 C2）。非 `plugin` source（`user`/`project` 等，Codex 协议合同里
 * `pluginId` 恒为 `null`）没有结构化归属字段可用，保留 `command` 层 `isOwnedEntry` 判据——
 * 否则合并器写入路径 / 项目级我方条目会永远认不出（假阴 C3）。
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isOwnPluginHookEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return false;
  if (entry.source === 'plugin') {
    if (
      entry.pluginId === 'spec-driver' ||
      (typeof entry.pluginId === 'string' && entry.pluginId.startsWith('spec-driver@'))
    ) {
      return true;
    }
    if (typeof entry.sourcePath === 'string' && OWN_SOURCE_PATH_RE.test(entry.sourcePath)) return true;
    return false;
  }
  return isOwnedEntry(entry.command);
}

/** 该值是否为 warnings/errors 字符串数组中提及我方插件的项（A5，只做布尔判断，不回传原文） */
function mentionsOwnPlugin(list) {
  if (!Array.isArray(list)) return false;
  return list.some((item) => typeof item === 'string' && item.includes('spec-driver'));
}

/**
 * 从 spawn 失败的错误对象中保真提取 errno 类别（A3）。不在 `SPAWN_ERRNO_CLASSES` 闭集内的
 * 一律归 `unknown`，绝不把未知错误码原样透传（FR-012 值级 typed schema 原则）。
 *
 * @param {unknown} err
 * @returns {string}
 */
function classifySpawnErrno(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  return typeof code === 'string' && SPAWN_ERRNO_CLASSES.includes(code) ? code : 'unknown';
}

/**
 * 唯一允许触碰真实子进程原始输出流的函数。异步驱动一次 `codex app-server` 的
 * `hooks/list` RPC：写入请求后**不主动关闭 stdin**（Phase 0 变体 A 已证实"写完就指望
 * 自然退出"会让响应来不及产生），持续监听 stdout 数据，逐行按 `id` 匹配（不假设行序，
 * 响应流固定夹杂 `configWarning`/`remoteControl/status/changed` 等无关通知），命中
 * `id===2` 或到达 `deadlineMs` 后主动 `kill('SIGKILL')`（硬约束 2，F268 教训：`SIGTERM`
 * 可能被忽略而穿透超时）。
 *
 * 🔴 硬约束 1（F269 教训）：必须挂 `child.on('error', …)` 监听器 —— 缺失时 ENOENT 会抛
 * 未捕获异常且 `'close'` 事件永不来，导致本函数返回的 Promise 永不 resolve（挂死）。
 *
 * 🔴 A1（M1/W-1/I1）：同样必须挂 `child.on('close', …)`——子进程秒退（既非 spawn 失败也未
 * 写出任何可解析的 `id:2` 响应）时，若无此监听器，本函数会一直等到 `deadlineMs` 才落
 * `timeout`，既白等满整个窗口，又把"进程提前退出"误报成"响应超时"，两者指向的排查方向
 * 完全不同。
 *
 * @param {typeof import('node:child_process').spawn} spawnFn 默认真实 `spawn`，可注入假实现
 * @param {string} projectRoot
 * @param {number} deadlineMs
 * @returns {Promise<
 *   | {kind:'ok', response: unknown}
 *   | {kind:'timeout'}
 *   | {kind:'spawn-error', errorClass: string}
 *   | {kind:'exited-early', exitCode: number|null}
 *   | {kind:'rpc-error-response', code: number|null}
 *   | {kind:'malformed-response'}
 *   | {kind:'buffer-overflow'}
 * >}
 */
export function readAppServerResponse(spawnFn, projectRoot, deadlineMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(result);
    };
    const killQuietly = (child) => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程可能已退出，静默忽略
      }
    };

    let child;
    try {
      child = spawnFn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      settle({ kind: 'spawn-error', errorClass: classifySpawnErrno(err) });
      return;
    }

    // 硬约束 1：缺失该监听器时 ENOENT 会抛未捕获异常且 'close' 永不来 → 本函数挂死
    child.on('error', (err) => {
      settle({ kind: 'spawn-error', errorClass: classifySpawnErrno(err) });
    });

    // A1：子进程秒退（未拿到 id:2、未触发 error/timeout）→ 按退出码区分归因，不留给 deadline
    child.on('close', (exitCode) => {
      settle({ kind: 'exited-early', exitCode: typeof exitCode === 'number' ? exitCode : null });
    });

    timer = setTimeout(() => {
      killQuietly(child);
      settle({ kind: 'timeout' });
    }, deadlineMs);

    /* RAW-IO-SITE-BEGIN */
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > HOOKS_LIST_BUFFER_LIMIT_BYTES) {
        killQuietly(child);
        settle({ kind: 'buffer-overflow' });
        return;
      }
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // 跳过不可解析的行，不假设行序
        }
        if (parsed && typeof parsed === 'object' && parsed.id === 2) {
          killQuietly(child);
          // A2：区分 JSON-RPC 错误响应与正常响应，不再把 `parsed.error` 误当成功数据消费
          if (parsed.error && typeof parsed.error === 'object') {
            const code = typeof parsed.error.code === 'number' ? parsed.error.code : null;
            settle({ kind: 'rpc-error-response', code });
          } else if (Object.prototype.hasOwnProperty.call(parsed, 'result')) {
            settle({ kind: 'ok', response: parsed.result });
          } else {
            // 响应既无 `result` 又无 `error`：协议意外，不猜测兜底为原始 `parsed`
            settle({ kind: 'malformed-response' });
          }
          return;
        }
      }
    });
    /* RAW-IO-SITE-END */

    try {
      child.stdin.write(buildHooksListRequest(projectRoot));
    } catch {
      // 写入失败（子进程已提前退出等）：不在此处结束，交给上面的 error/timeout 兜底
    }
  });
}

/**
 * 从已解析的 `hooks/list` 响应中提取我方条目的 `trustStatus`，产出唯一受限形状。
 *
 * 🔴 只读结构化字段做布尔判断与枚举成员测试，从不把 `sourcePath`/`pluginId`/`command`/
 * `key` 等自由文本字段写进返回值。
 *
 * 🔴 A4（M2/W1/I-1）：cwd 匹配收窄。本探针恒对单个 `projectRoot` 发起请求，`data.length===1`
 * 时直接取该项（不强制比较 `cwd` 字面值——Codex 侧可能对路径做归一化，如末尾斜杠差异）；
 * `data.length>1` 时按精确 `cwd===projectRoot` 匹配；匹配不到、或目标的 `hooks` 不是数组
 * → `error/parse-failed`（不再静默落 `absent`——那会把"结构对不上"伪装成"确证没有"）。
 *
 * 🔴 A5（C1/W-4）：我方条目数为 0 时，若响应的 `warnings`/`errors` 提及 `spec-driver`，
 * 说明 Codex 自己报告了我方 hook 的加载问题，此时不得判 `absent`（那会把"报了错但没告诉你"
 * 读成"确证没有"），改判 `error/rpc-error`。该子串判断只影响 outcome，warnings/errors 的
 * 任何文本本身不进入返回值。
 *
 * @param {unknown} response `readAppServerResponse` 返回的 `{kind:'ok'}` 分支的 `response`
 * @param {string} projectRoot
 * @returns {{outcome: string, errorClass: string|null, entries: string[]}}
 */
export function deriveResult(response, projectRoot) {
  try {
    const dataList = response && typeof response === 'object' ? response.data : null;
    if (!Array.isArray(dataList)) {
      return { outcome: 'error', errorClass: 'parse-failed', entries: [] };
    }
    let target = null;
    if (dataList.length === 1) {
      target = dataList[0];
    } else {
      target = dataList.find((d) => d && typeof d === 'object' && d.cwd === projectRoot) ?? null;
    }
    if (!target || typeof target !== 'object' || !Array.isArray(target.hooks)) {
      return { outcome: 'error', errorClass: 'parse-failed', entries: [] };
    }
    const hooksList = target.hooks;
    const ownedEntries = hooksList.filter((entry) => isOwnPluginHookEntry(entry));
    if (ownedEntries.length === 0) {
      if (mentionsOwnPlugin(target.warnings) || mentionsOwnPlugin(target.errors)) {
        return { outcome: 'error', errorClass: 'rpc-error', entries: [] };
      }
      return { outcome: 'absent', errorClass: null, entries: [] };
    }
    const entries = [];
    for (const entry of ownedEntries) {
      const trustStatus = entry.trustStatus;
      if (typeof trustStatus !== 'string' || !NATIVE_TRUST_VALUES.includes(trustStatus)) {
        // 协议漂移：命中的我方条目 trustStatus 不在四值闭集内，不猜测聚合，整体判负
        return { outcome: 'error', errorClass: 'parse-failed', entries: [] };
      }
      entries.push(trustStatus);
    }
    return { outcome: 'found', errorClass: null, entries };
  } catch {
    return { outcome: 'error', errorClass: 'unknown', entries: [] };
  }
}

/**
 * 把 `readAppServerResponse` 的归约结果映射为最终受限形状。
 *
 * 🔴 导出仅用于**测试内省**（与 `deriveResult`/`isOwnPluginHookEntry` 同理）：本文件恒以
 * `main()` 调用它并落到 `process.stdout`，导出不改变生产路径行为。
 *
 * 🔴 ENOENT / EACCES / ENOTDIR / ELOOP（`codex` 二进制不可用的四类 errno，A3）统一映射为
 * `outcome:'not-executable'` 且 `errorClass` 保真透传——plan §2 优先级 3 明确要求"二进制
 * 不可用"并入"回退合并器"这一大类，而不是当作"RPC 明确失败"短路成不可判定：
 * `$CODEX_HOME/hooks.json` 这个动作不依赖 `codex` 二进制是否在 PATH 上，若把这类错误当作
 * 明确失败，会在"hooks.json 确实存在但当前 shell 环境恰好没有 codex"这种边缘但真实的场景
 * 下，把一个本该有意义的合并器结论错误地压成不可判定。
 *
 * 🔴 A1：`exited-early`（子进程秒退）按退出码区分——非零退出码是"进程真的失败了"
 * （`non-zero-exit`），退出码 0 但没产出可用响应是"进程正常退出但没干成事"（`rpc-error`，
 * 与"RPC 没谈成"同一处置方向）。
 *
 * 🔴 A2：JSON-RPC 层面的 `-32601`（Method not found）等价于"这个 Codex 版本没有 `hooks/list`
 * 方法"，与二进制缺失同一处置方向（`not-executable`）；其余 RPC 错误码保守按
 * `error/rpc-error` 处理。
 *
 * @param {ReturnType<typeof readAppServerResponse> extends Promise<infer T> ? T : never} readerOutcome
 * @param {string} projectRoot
 * @returns {{outcome: string, errorClass: string|null, entries: string[]}}
 */
export function mapReaderOutcome(readerOutcome, projectRoot) {
  if (readerOutcome.kind === 'ok') {
    return deriveResult(readerOutcome.response, projectRoot);
  }
  if (readerOutcome.kind === 'timeout') {
    return { outcome: 'error', errorClass: 'ETIMEDOUT', entries: [] };
  }
  if (readerOutcome.kind === 'malformed-response') {
    return { outcome: 'error', errorClass: 'parse-failed', entries: [] };
  }
  if (readerOutcome.kind === 'buffer-overflow') {
    return { outcome: 'error', errorClass: 'parse-failed', entries: [] };
  }
  if (readerOutcome.kind === 'exited-early') {
    return {
      outcome: 'error',
      errorClass: readerOutcome.exitCode === 0 ? 'rpc-error' : 'non-zero-exit',
      entries: [],
    };
  }
  if (readerOutcome.kind === 'rpc-error-response') {
    if (readerOutcome.code === -32601) {
      return { outcome: 'not-executable', errorClass: 'rpc-error', entries: [] };
    }
    return { outcome: 'error', errorClass: 'rpc-error', entries: [] };
  }
  // kind === 'spawn-error'
  if (SPAWN_ERRNO_CLASSES.includes(readerOutcome.errorClass)) {
    return { outcome: 'not-executable', errorClass: readerOutcome.errorClass, entries: [] };
  }
  return { outcome: 'error', errorClass: 'unknown', entries: [] };
}

/**
 * CLI 入口。解析 `argv[2]` 为 `projectRoot`；串起以上函数；`try/catch` 兜底任何未预期
 * 异常统一落 `{outcome:'error', errorClass:'unknown', entries:[]}`；恒以退出码 0 结束
 * （失败信息编码进返回值，不用非零退出码表达）。
 *
 * 🔴 A8：`process.stdout.write` 用回调确保 flush 完成后再 `process.exit(0)`——紧跟 write
 * 调用 exit 有管道被截断的风险（父进程可能来不及读完全部字节）。
 *
 * @param {string[]} argv 完整的 `process.argv`（不是已切片的 argv）
 * @returns {Promise<void>}
 */
export async function main(argv) {
  let result;
  try {
    const projectRoot = argv[2];
    if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
      result = { outcome: 'error', errorClass: 'unknown', entries: [] };
    } else {
      const readerOutcome = await readAppServerResponse(spawn, projectRoot, HOOKS_LIST_DEADLINE_MS);
      result = mapReaderOutcome(readerOutcome, projectRoot);
    }
  } catch {
    result = { outcome: 'error', errorClass: 'unknown', entries: [] };
  }
  process.stdout.write(JSON.stringify(result), () => {
    process.exit(0);
  });
}

if (isInvokedDirectly(import.meta.url)) {
  main(process.argv);
}
