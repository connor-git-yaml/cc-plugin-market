/**
 * F241 E1 — KB no-hit 治理记录器（FR-013 / FR-014）
 *
 * 三个 KB 查询入口（kb_search / kb_api_lookup / scaffold-kb query）在零命中时调用
 * `recordNoHit`，落一条 `.specify/kb-nohit/nohit-<YYYYMMDD>.jsonl` 记录，供 coverage-gap 聚合。
 *
 * 三条硬约束：
 * 1. **默认关闭**：开关钉死为单一环境变量 `SPECTRA_KB_NOHIT_TELEMETRY`（值 = 落盘目录），
 *    未设或为空即关闭；三个入口共用 `resolveNoHitTelemetryDir()`，禁止各自读 env（P-W3）。
 * 2. **不落整串**：只落 redaction 后再切词去重的 `terms` 与不可逆的 `normalizedQueryHash`，
 *    既不存新增的整串字段，也不存 redaction 后的完整串（FR-013 / D5）。
 *    如实声明的残余：查询本身就是单个 token 时，该 token 即等于原串（D5 已接受，见 B2-5）。
 * 3. **绝不影响主链路**：任何失败（目录只读 / 磁盘满 / 路径被占位 / 入参畸形 / 路径 thunk 抛错）
 *    一律静默 no-op（EC-20 / RG-009）。
 */

import { createHash } from 'node:crypto';
import { closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { NOHIT_RETENTION_DAYS } from './governance-constants.js';
import { redactQuery } from './query-redaction.js';
import { normalizeForEquivalence, tokenize } from './tokenizer.js';

/** 采集开关的**唯一** env（FR-014 钉死，不引入 config 字段、不引入布尔+路径双变量） */
const NOHIT_TELEMETRY_ENV = 'SPECTRA_KB_NOHIT_TELEMETRY';

/** 落盘文件名形态，也是滚动清理的作用域边界（不碰目录内其他文件） */
const NOHIT_FILE_PATTERN = /^nohit-\d{8}\.jsonl$/;

/** hash 截断长度：64 bit 十六进制，仅用于计数去重，不用于还原 */
const HASH_HEX_LENGTH = 16;

export type NoHitTool = 'kb_search' | 'kb_api_lookup' | 'scaffold_kb_query';

/**
 * `tool` 的**运行时** allowlist。
 *
 * `NoHitTool` 只在编译期约束；本模块是导出边界，声称对任何输入都是 total 函数，
 * 就不能假设调用方一定传字面量——`tool` 未经校验即序列化，等于开了一条绕过 redaction
 * 把任意串落盘的通道（F241 B2-8）。
 */
const ALLOWED_TOOLS: ReadonlySet<string> = new Set<NoHitTool>(['kb_search', 'kb_api_lookup', 'scaffold_kb_query']);

export interface RecordNoHitInput {
  tool: NoHitTool;
  /** 原始查询串；本函数内部先 redaction 再切词，调用方**不需要**预处理 */
  rawQuery: string;
  /**
   * 被查询库的路径（多库时可用分隔符拼接）；只落其 hash，不落路径本身。
   *
   * 允许传 thunk：路径计算（如遍历 handle 读 `dbPath` getter）会在本函数的 try 内求值，
   * 从而纳入「绝不影响主链路」的保护边界。挂点在保护边界**外**先算好路径，
   * 会让计算过程中的异常直接穿透到 KB 查询主链（F241 B2-9）。
   */
  dbPath: string | (() => string);
}

/**
 * 解析 no-hit 采集目录。**全仓唯一**读取 `SPECTRA_KB_NOHIT_TELEMETRY` 的地方。
 *
 * @returns 目录路径；未设置 / 空串 / 纯空白 → `null`（= 采集关闭）
 */
export function resolveNoHitTelemetryDir(): string | null {
  const raw = process.env[NOHIT_TELEMETRY_ENV];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_HEX_LENGTH);
}

/**
 * 清理超过保留期的历史文件；单个文件失败不影响其余（best-effort）。
 *
 * 用 `lstatSync` 而非 `statSync`，且只清理**常规文件**：`statSync` 会跟随符号链接，
 * 于是目录内一个名叫 `nohit-<日期>.jsonl` 的链接就能让清理逻辑按链接目标的 mtime
 * 判定、并 unlink 掉指向目录外的用户文件（F241 B2-2）。
 * 不跟随链接后，符号链接自身的 mtime 参与判定、被删的也只是链接本身。
 */
function pruneExpired(dir: string, nowMs: number): void {
  const cutoff = nowMs - NOHIT_RETENTION_DAYS * 86_400_000;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!NOHIT_FILE_PATTERN.test(name)) continue;
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (!st.isFile()) continue; // symlink / FIFO / 目录 / 设备：不是我们写的，不碰
      if (st.mtimeMs < cutoff) unlinkSync(p);
    } catch {
      /* 单文件清理失败不影响写入 */
    }
  }
}

/**
 * 追加一行到 `path`，**只接受常规文件**。
 *
 * `appendFileSync` 有两个在治理层不可接受的性质（F241 B2-2）：
 * - 跟随符号链接：目录里预置一个同名链接就能把治理记录写到目录外（乃至 `/dev/stdout`，
 *   污染 MCP stdio）；
 * - 打开无 reader 的 FIFO 会**无限阻塞**——挂点在 KB 查询的同步返回路径上，
 *   外层 try/catch 对"永不返回"毫无办法。
 *
 * 因此改为 `openSync` 显式控制打开语义：
 * - `O_NOFOLLOW` → 末段是符号链接直接 ELOOP 失败（由调用方的 try 静默吞掉）；
 * - `O_NONBLOCK` → 打开 FIFO 立即失败/返回而不是挂住（对常规文件按 POSIX 无副作用），
 *   这是 `isFile()` 校验能被执行到的前提；
 * - 打开后再 `fstatSync(fd)` 确认是常规文件，否则放弃写入（静默降级，不抛）。
 */
function appendLineToRegularFile(path: string, line: string): void {
  const flags =
    fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const fd = openSync(path, flags, 0o600);
  try {
    if (!fstatSync(fd).isFile()) return; // FIFO / 设备 / 其他非常规文件 → 放弃这条记录
    const buf = Buffer.from(line, 'utf-8');
    // O_APPEND 下每次 write 都定位到末尾；循环处理短写，保证整行落盘（行内无裸换行 → 并发安全）
    let written = 0;
    while (written < buf.length) {
      written += writeSync(fd, buf, written, buf.length - written);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * 记录一次零命中事件。采集关闭时**全程零 I/O**。
 *
 * **total 函数契约**：整个函数体在 try 内，对任何输入、任何环境都不抛异常、无返回值（EC-20 / RG-009）。
 * 三处挂点因此**不需要**各自包 try-catch——那样只会产生三段永不可达的死分支。
 * 契约由 `tests/kb/nohit-recorder.test.ts` 的「任何输入都不抛」用例守护，改动本函数必须保持整体 try 包裹。
 *
 * 「不抛」不等于「照单全收」：入参先过运行时校验（B2-8），任何不合法字段一律
 * **直接 no-op**——不落半条记录、不落任何未经 redaction 的字段。
 */
export function recordNoHit(input: RecordNoHitInput): void {
  try {
    const dir = resolveNoHitTelemetryDir();
    if (dir === null) return; // 默认关闭：提前返回，不触碰 fs、不求值 dbPath thunk

    // 运行时入参校验（B2-8）：类型只在编译期生效，导出边界必须自己守
    if (input === null || typeof input !== 'object') return;
    if (!ALLOWED_TOOLS.has(input.tool)) return;
    if (typeof input.rawQuery !== 'string') return;
    // dbPath thunk 在此求值 —— 位于本函数 try 内，抛错走静默降级而非穿透主链（B2-9）
    const dbPath = typeof input.dbPath === 'function' ? input.dbPath() : input.dbPath;
    if (typeof dbPath !== 'string') return;

    const { redacted, tags } = redactQuery(input.rawQuery);
    const terms = [...new Set(tokenize(redacted))];
    const timestamp = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      timestamp,
      tool: input.tool,
      terms,
      // 等价类归一化（NFKC + 切词 + case-fold + 去重）后再 hash：
      // 大小写/全角变体收敛为同一 hash，否则 `retry alpha` / `retry Alpha` 会被
      // coverage-gap 当成两个不同查询顶过阈值（B2-6）。不可逆、只用于计数去重。
      normalizedQueryHash: shortHash(normalizeForEquivalence(redacted)),
      redactionTags: tags,
      resultCount: 0,
      dbPathHash: shortHash(dbPath),
    };
    mkdirSync(dir, { recursive: true });
    pruneExpired(dir, Date.parse(timestamp));
    // 单次写完整一行（含结尾换行），行内无裸换行 → 并发写安全，不引锁（EC-19）
    appendLineToRegularFile(
      join(dir, `nohit-${timestamp.slice(0, 10).replace(/-/g, '')}.jsonl`),
      `${JSON.stringify(record)}\n`,
    );
  } catch {
    /* EC-20：治理层绝不影响 KB 查询主链路 */
  }
}
