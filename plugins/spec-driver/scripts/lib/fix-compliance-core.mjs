/**
 * fix-compliance-core.mjs
 * Feature 208 — fix 模式流程依从性判定核心（纯函数，零 I/O）
 *
 * 设计原则（research.md D3）：本模块全部函数为纯函数——不读文件、不碰 process.env、
 * 不调网络/LLM/子代理。transcript 已由 io 层解析为 TranscriptEntry 数组、配置已读为对象后传入，
 * core 只负责结构化判定。分层惯例参照 goal-loop-core.mjs（fail-loud + 类型守卫先例）。
 *
 * 反伪造硬化（research.md D1）：展开痕迹只认 user 消息 text 块、委派只认 assistant 消息
 * tool_use 块——这两类 envelope 由 harness 写入，模型无法在其中注入内容（模型输出落在
 * assistant text 块与 user 的 tool_result 块）。normalizeTranscriptEntry 在解析期即把
 * tool_result 排除出 textBlocks，从源头堵死"自导自演更新展开痕迹"的 Goodhart 洞。
 *
 * F218 拆分：F216 证据门纯函数与共享 fix-report 解析原语已下沉到
 * fix-compliance-execution-record.mjs（单向底层）。core 留守函数按需 import back，
 * 并在文件尾部统一 re-export 转发，保 judge.mjs / io.mjs / 测试的既有 import 面零改动。
 */

import {
  flattenToolResultContent,        // normalizeTranscriptEntry 复用
  computeFenceMask,                // extractSectionBody / stripReconSubblock / classifyClosureForm 复用
  computeFenceRegions,             // stripCodeRegions 复用（F228 R2-1：未闭合围栏不剥离）
  NOOP_JUDGMENT_HEADING_REGEX,     // classifyClosureForm / judgeCompliance 复用
  NOOP_RECON_HEADING_REGEX,        // stripReconSubblock 复用
  parseNoopReconLines,             // judgeCompliance 复用
  classifyReproEvidence,           // judgeCompliance 复用
  toSingleMatchProbe,              // 章节判据函数构造单次匹配探针（不 re-export，新符号无兼容约束）
} from './fix-compliance-execution-record.mjs';

// ────────────────────────────────────────
// 常量
// ────────────────────────────────────────

/** enforcement 三档合法值（FR-015） */
export const ENFORCEMENT_VALUES = new Set(['block', 'warn', 'off']);

/**
 * 技能展开痕迹正则（research.md D1）。harness 注入的 user 文本块形如：
 * `Base directory for this skill: <pluginPath>/skills/spec-driver-<mode>`
 * mode 限定小写字母，避免把路径尾随字符误并入 mode。全局匹配便于取"最晚一次"。
 *
 * ⚠️ 性能特征（F257 缺陷 2 修复轮如实登记，**勿**再写成"无回溯风险"）：
 * `([^\n]+?)` 是**惰性量词**，无嵌套量词故不存在指数级灾难性回溯，但这**不蕴含**线性。
 * 退化形态：同一**行**内重复出现 `Base directory for this skill:` 诱饵前缀、且该行内不含
 * `/skills/` 时，每个诱饵起点都要把 `[^\n]+?` 一路扩到行尾才放弃 → 整体 O(K×N)
 * （K=诱饵数，N=行长）。实测（K=12000、行长 ~1.3MB）单趟 ≈ 5s。
 * 判定器跑在**同步 Stop hook** 上，故本正则的扫描次数是承重指标：
 * 🔴 全链**只允许扫一趟**——`detectFixSkillExpansion` 已在同一趟里同时产出主锚点与
 * `earliestFixLineIndex`；任何新增消费方都必须复用它的返回值，不得再起第二遍全量扫描
 * （第 2 轮就是因为闸门三另扫一遍，把红队诱饵语料的耗时从 10188ms 翻倍到 19785ms）。
 * 本正则本身的线性化属独立跟进项，不在本轮范围。
 */
export const SKILL_EXPANSION_REGEX = /Base directory for this skill:\s*([^\n]+?)\/skills\/spec-driver-([a-z]+)/g;

/**
 * 特性目录提名正则（research.md D1 + codex implement 审查 C-2 硬化）：
 * 提名必须锚定**required artifact 路径**（fix-report.md / verification-report.md），
 * 而非任意目录字符串命中——否则当前会话仅在 Bash 里提及一个旧特性目录路径，
 * 就能把磁盘上前次会话的合规制品绑定为"本次收口的制品"，绕过 FR-007 判定窗口。
 * 提名≠判据，磁盘核验才采信。
 */
export const ARTIFACT_PATH_REGEX = /specs\/\d+-fix-[a-z0-9-]+\/(?:fix-report\.md|verification\/verification-report\.md)/g;

/** Bash 提名额外要求命令含写入指示符（重定向/heredoc/tee），排除 echo/cat 纯提及旧路径的读形态 */
export const BASH_WRITE_INDICATOR_REGEX = /(?:>>?|<<|\btee\b)/;

/**
 * 改名目标合法命名校验（F224 FR-001）：改名后的新目录必须仍满足 `specs/NNN-fix-<name>` 命名规范
 * 才能被采信为新候选。否则说明候选已被移动到无法机械识别的位置（改名到非规范目录），
 * 此时继续拿旧路径去撞磁盘核验只会产生误报，须转入 FR-004 降级路径。
 * 整串锚定并允许尾随斜杠，与 ARTIFACT_PATH_REGEX 的目录前缀语义同源。
 */
export const FIX_DIR_NAME_REGEX = /^specs\/\d+-fix-[a-z0-9-]+\/?$/;

/**
 * 从合法特性目录路径中抽取 short-name 段（F256 盲区 1：`specs/NNN-fix-<short>` 的 `<short>`）。
 *
 * 存在理由：Feature 编号被复合命令（`cd … && git mv specs/251-fix-foo specs/254-fix-foo && …`）
 * 重编时，F231 的光杆命令白名单刻意不跟随该形态，候选于是永久停在磁盘上已消失的旧编号路径。
 * short-name 是同一特性在重编前后**唯一不变的部分**，因此被选作磁盘侧重锚定的键。
 *
 * 判据与 FIX_DIR_NAME_REGEX 同源（整串锚定、容忍尾随斜杠）：不满足即返回 null，
 * 刻意不做模糊提取/启发式兜底——候选一旦能漂移到无关特性，本兜底就成了新的冒用面。
 * @param {string|null} dirPath
 * @returns {string|null}
 */
export function extractFixShortName(dirPath) {
  if (typeof dirPath !== 'string') return null;
  const match = /^specs\/\d+-fix-([a-z0-9-]+)\/?$/.exec(dirPath);
  return match ? match[1] : null;
}

/**
 * 「光杆改名命令」字面白名单的 token 化判据（F231 第 5 轮立判据 / 第 8 轮改线性实现）。
 *
 * 语义：整条 Bash 命令必须**就是**一条带字面路径操作数的 `mv` / `git mv`，多一个 token 都不认——
 * 等价形态 `^[ \t]*(git[ \t]+)?mv([ \t]+-OPT)*[ \t]+<PATH>[ \t]+<PATH>[ \t]*$`。
 * 判定实现见 `scanRenameCommandEvents`：首尾空白剥离 → 拒绝内部换行 → 按 `[ \t]+` 切 token →
 * 逐 token 锚定校验。**刻意不用单条大正则**：第 8 轮实测原正则里相邻空白量词
 * （`(?:[ \t]+-OPT)*[ \t]+…`）存在歧义切分，回溯空间随空白长度**平方**增长——
 * `mv` + 40 万空白 + `x` 耗时 61s，且「能匹配成功」的形态同样慢（20 万空白 15s）。
 * 本判定器跑在**同步 Stop hook** 上，一条含大段空白的 Bash 命令即可让门禁挂住数十秒 →
 * 门禁不可用 / 宿主超时 → 可能异常 fail-open（与 F227 候选历史 O(N²) 同类 DoS 面）。
 * token 化后每步都是锚定的常数级判定或单趟扫描，**无嵌套量词、无回溯**。
 * 回归锚点见 fix-compliance-core.test.mjs 的 F231 第 8 轮 perf 用例（禁止超线性）。
 *
 * 首尾空白（空格 / tab / LF，**不含 CR**——见 isShellWhitespace 第 9 轮订正）在判定前剥离（第 6 轮）：
 * 它不可能改变一条命令的 bash 语义（空行是 no-op），
 * 而真实 transcript 的 Bash `command` 很常带尾随换行，判其「非光杆」会白送一次 exit 2 误阻断。
 * 放宽**只**作用于首尾，不触碰「整条命令只有一条 mv」这一不变量：命令**内部**换行一律拒绝。
 * 剥离字符集必须与 bash 对齐、且与前导计数同源——见 isShellWhitespace 的教训记录。
 *
 * `mv -t DIR SRC` 这类位次错位形态虽 token 形状合法，仍由 `parseRenameOperands` 的带参 option
 * 判据整条拒绝（两道判据叠加，任一都不放宽）。
 */
/**
 * 严格 option 白名单（F231 第 9 轮 CRITICAL-2）——只接受**确定保持「真实改名」语义**的短 option
 * 捆绑：`-f` / `-v` / `-fv` / `-vf`（仅由 `f`、`v` 组成）。
 *
 * why 必须白名单而非 `-[A-Za-z-]+`：option 语义是**命令相关**的，宽泛放行会把「明确不改名」的
 * 命令当成真实改名 → 候选被带到非规范名 → 重开 F224 fail-open。实测反例：
 * - `git mv -n` / `git mv --dry-run`：git 保证**不改名**（dry-run 后目录仍是原名）；
 *   注意 `-n` 对 `mv` 与 `git mv` 语义**不同**（coreutils 是 `--no-clobber`，git 是 `--dry-run`）
 *   ——这正说明不能按「看起来像 flag」放行。
 * - `mv --definitely-invalid` / `mv -vt` / `mv -tfoo`：真实 mv 报 illegal option、非零退出、**无改名**；
 *   且后两者能骗过 `parseRenameOperands`「整 token 等于 `-t`/`-S` 才拒绝」的判据（捆绑与附参形态）。
 * 未列入者一律拒绝：`-n`、`--dry-run`、`--no-clobber`、`--`、未知长 option、`--opt=value`、
 * 含 `f`/`v` 之外字符的捆绑。方向 fail-closed（误阻断而非误放行）。
 */
const RENAME_SHORT_FLAG_TOKEN_REGEX = /^-[fv]+$/;

/**
 * 长选项白名单——**仅对 `git mv` 有效**（F231 第 10 轮 C4）。
 * why 必须按命令类型拆分：长选项是 GNU coreutils 专有，本机 Darwin `/bin/mv` 实测
 * `mv --force …` / `mv --verbose …` 均 `illegal option -- -`、rc=64、**无改名**；
 * 而 `git mv --force` / `git mv --verbose` 实测 rc=0 真实改名。共用一张表会让裸 `mv` 的这两条
 * 打开 fail-open。仓库无 GNU-only 平台合同，故裸 `mv` 一律不接受任何长选项（fail-closed）。
 */
const GIT_MV_LONG_FLAG_TOKENS = new Set(['--force', '--verbose']);

/**
 * option token 是否在白名单内（按命令类型分流，见 GIT_MV_LONG_FLAG_TOKENS）。
 * @param {string} token
 * @param {boolean} isGitMv
 * @returns {boolean}
 */
function isAcceptedRenameOption(token, isGitMv) {
  if (RENAME_SHORT_FLAG_TOKEN_REGEX.test(token)) return true;
  return isGitMv && GIT_MV_LONG_FLAG_TOKENS.has(token);
}

/** ASCII-only 小写折叠：刻意不用 toLocaleLowerCase（locale 相关，土耳其语 I 等会引入不可控行为） */
function asciiLowerCase(text) {
  return text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/**
 * 两个操作数是否构成一次**可信的 `SRC→DST` 改名**（F231 第 10 轮 C2/C3）。
 * 以下三类在真实文件系统上都**不产生** `SRC→DST`，但文本上看着像光杆改名，故整条拒绝：
 * - **同路径**（含仅大小写不同）：本机（大小写不敏感 FS）实测
 *   `mv specs/230-fix-x SPECS/230-fix-x` → rc=1、`-ef` 同一 inode、**无改名**，
 *   但 `SPECS/...` 不匹配小写 FIX_DIR_NAME_REGEX → 直接打开降级通道。
 *   大小写敏感 FS 上这最多造成可接受的误阻断（fail-closed 方向）。
 * - **dst 是 src 的祖先**：`mv specs/230-fix-x specs` 实测 rc=2 `are identical`、**无改名**。
 * - **dst 是 src 的后代**：`mv X X/child` 实测 rc=1 `Invalid argument`、**无改名**。
 * 前缀判定必须按 path segment 边界（`+ '/'`），裸 startsWith 会把
 * `specs/900-fix-x` 与 `specs/900-fix-xyz` 误判成父子。
 * @param {string} srcBody 已去尾随 `/`
 * @param {string} dstBody 已去尾随 `/`
 * @returns {boolean}
 */
function isDistinctRenameTarget(srcBody, dstBody) {
  const s = asciiLowerCase(srcBody);
  const d = asciiLowerCase(dstBody);
  if (s === d) return false;                       // 同路径（含仅大小写不同）
  if (s.startsWith(`${d}/`)) return false;         // dst 是 src 的祖先
  if (d.startsWith(`${s}/`)) return false;         // dst 是 src 的后代
  return true;
}

/**
 * 单个操作数 token 的合法字符集——**判据的必要组成、不可放宽**。
 * 排除空白、引号、`$`、反引号、`;` `|` `&` `(` `)` `{` `}` `<` `>` `#` `\` 与换行：
 * 若允许元字符进入操作数，`mv A B;` 会解析出 dst=`B;` → 不符合 `NNN-fix-<name>` → `ambiguous=true`
 * → 重开 F224 fail-open 降级通道。字符集本身就是防线。
 * 锚定单字符类 + 无嵌套量词 → 无回溯。
 */
const RENAME_PATH_TOKEN_REGEX = /^[A-Za-z0-9._/-]+$/;

/** token 分隔：一段连续的空格/tab（与 isShellWhitespace 同源语义，见其 JSDoc） */
const SHELL_TOKEN_SEPARATOR_REGEX = /[ \t]+/;

/**
 * 操作数的 path segment 合法性（F231 第 9 轮 CRITICAL-3）：按 `/` 切分后，任一 segment 为
 * `.`、`..` 或空串（`//`、绝对路径前导 `/`）即整条拒绝；允许**单个尾随斜杠**（`specs/X/`）。
 *
 * why：规范化后与源相同的 dst 意味着**实际没发生改名**——实测
 * `mv specs/230-fix-x specs/./230-fix-x` → rc=1 `Invalid argument`、目录未变（`-ef` 确认同一目录），
 * 但判定器会解析出 dst=`specs/./230-fix-x` → 不符合 `NNN-fix-<name>` → `ambiguous=true`
 * → 重开 fail-open。`specs//X`、`specs/../specs/X` 同类。
 * 选择「拒绝非规范 segment」而非「做 POSIX 规范化再比较」：前者简单、可人眼审计、方向 fail-closed，
 * 且真实特性目录 `specs/NNN-fix-<name>` 永远不含这些 segment。
 * 逐 segment 的常数级比较，无回溯。
 * @param {string} operand
 * @returns {boolean}
 */
function hasCanonicalPathSegments(operand) {
  const body = operand.endsWith('/') ? operand.slice(0, -1) : operand;
  if (body.length === 0) return false;                       // 操作数只是 `/`
  return body.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

/**
 * bash 的 token 分隔空白字符集——**只有**空格 / tab / LF（F231 第 7 轮定 + 第 9 轮订正）。
 *
 * ## 为何不含 `\r`（第 9 轮 CRITICAL-1）
 *
 * CR 在 bash 里**不是**分隔符，而是普通字符：`<CR>mv A B` 是一条名为 `$'\rmv'` 的命令
 * → 未找到命令、**mv 不执行**；`mv A B<CR><LF>` 则**确实执行**，但创建的目录名带 CR
 * （实测 `ls | cat -v` 显示 `901-fix-y^M`）——若把 CR 当空白剥掉，就会记录一个**并不存在**的路径。
 * 两个方向都错，故 CR 一律不剥离；它既不在本字符集、也不在操作数字符集内，
 * 含 CR 的命令因此整条不匹配（fail-closed，与 bash 语义一致）。
 *
 * ## 为何必须自定义、绝不能用 JS 内建的 Unicode 语义
 *
 * `String.prototype.trim()` 剥除**全部 Unicode 空白**（`\v` `\f` NBSP U+2028 BOM U+3000 …），
 * 正则 `\s` 同理。但 bash **不**把这些字符当 token 分隔符：`<VT>mv A B` 在真实 bash 里是一条名为
 * `$'\vmv'` 的命令 → **未找到命令、mv 从不执行**（GNU bash 5.3.9 实测，6 个字符逐条确认）。
 * 第 6 轮曾用 `raw.trim()` 做剥离、却用 `^[ \t\r\n]` 星号量词的正则计前导长度，两个字符集分叉，
 * 后果有两层：
 * 1. **误放行**：非分隔符的 Unicode 空白被剥掉后整条命令得以匹配光杆形态，凭空把 bash 根本不会
 *    执行的命令当成真实改名 → 候选被带到非规范名 → 重开 F224 fail-open 降级通道；
 * 2. **offset 错位**：`leading` 数不到被 `trim()` 剥掉的字符，offset 不再指向命令名，
 *    破坏 `resolveFeatureDirCandidate` 的按偏移归段与 F230 R3-C4 时序语义。
 *
 * ## 本 Feature 的重复教训（第 4 次同型缺陷）
 *
 * 本 Feature 已**四次**因「判定器的某个模型与 bash 真实语义分歧」而重开 fail-open：
 * (1) `$'…'` ANSI-C 引号配平（判定器按 POSIX `'…'` 建模，bash 在 `$'…'` 内把 `\'` 当字面引号）；
 * (2) heredoc 终止行被保留（引号定界词可含空格，终止行与真实 mv 命令同形）；
 * (3) `<<<` herestring 与注释内 `<<WORD` 的幽灵 heredoc；
 * (4) 空白字符集分歧（含第 9 轮订正的 `\r`）。
 * 故凡涉及「归一化 / 剥离 / 豁免」的字符集，必须与 bash 语义严格对齐，**不得**用 JS 内建的
 * Unicode 语义（`trim()` / `\s` / `\b`）近似 shell 语义；且「剥什么」与「数什么」必须由**同一个
 * 判定函数**决定，不能靠人记得两处同步。
 *
 * 实现为**字符判定函数**而非正则（第 8 轮 DoS）：`/[ \t\n]*$/` 这类未在串首锚定的尾随匹配，
 * 引擎会在每个起始位置重试并回溯整段空白 → O(n²)（400KB 空白实测 60s+）。
 * 双向线性扫描无此问题。
 * @param {string} ch
 * @returns {boolean}
 */
function isShellWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n';
}

/**
 * 其后紧跟独立参数的 option（`mv -t DIR SRC` / `mv -S SUFFIX SRC DST`）。
 * 这类形态下操作数位次与常规 `mv SRC DST` 错位，出现即整条跳过（保守化：宁可漏跟随，不可跟错）。
 */
const RENAME_ARG_TAKING_OPTIONS = new Set(['-t', '--target-directory', '-S', '--suffix']);

/** option token 数量上界：超界视为无法可靠解析的异常形态，整条跳过（与既有有界量词语义等价） */
const RENAME_MAX_OPTION_TOKENS = 8;

/**
 * 解析一段 `mv` 参数文本，仅在能**唯一确定** `<src> <dst>` 时返回二元组，否则返回 null（整条跳过）。
 * 保守化规则（F224 Codex 复审）：
 * - 非 option 操作数不恰好为 2 个 → null（覆盖 `mv A B C` 多操作数、含空格引号路径被拆散等形态）
 * - 出现带参数 option（`-t` / `-S` / `--target-directory` / `--suffix`）→ null（位次错位）
 * - option token 数超过上界 → null
 * 引号仅剥除"首尾成对且内部无引号"的简单包裹；specs/NNN-fix-<name> 命名规范本身不含空格，
 * 故刻意不解析 shell 转义/通配符——不匹配即退化为"不识别"，不会误跟随。
 * 注意：本函数只决定"命令形态能否被识别"，**不**放宽"仅当 src 精确等于当前已跟踪目录才采信"这一安全约束。
 * @param {string} segment
 * @returns {[string, string]|null}
 */
export function parseRenameOperands(segment) {
  const tokens = String(segment).trim().split(/\s+/).filter(Boolean);
  const operands = [];
  let optionCount = 0;
  let endOfOptions = false;
  for (const token of tokens) {
    if (!endOfOptions && token === '--') {
      endOfOptions = true;
      optionCount += 1;
      continue;
    }
    if (!endOfOptions && token.length > 1 && token.startsWith('-')) {
      if (RENAME_ARG_TAKING_OPTIONS.has(token.split('=')[0])) return null;
      optionCount += 1;
      continue;
    }
    operands.push(token);
  }
  if (optionCount > RENAME_MAX_OPTION_TOKENS) return null;
  if (operands.length !== 2) return null;
  const unquote = (t) => (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]
    && !t.slice(1, -1).includes(t[0])
    ? t.slice(1, -1)
    : t);
  return [unquote(operands[0]), unquote(operands[1])];
}

/**
 * 原地编辑命令识别（F224 FR-002/FR-003）：可追加的正则列表，当前覆盖 `sed -i` 与 `perl -i`。
 * 这一组正则只放宽"这条 Bash 命令要不要进入路径扫描"的**准入**，绝不放宽"扫描到什么才算写入"的
 * **判据**——命中后仍必须让命令文本完整匹配 ARTIFACT_PATH_REGEX 才会更新候选，避免把纯路径提及误判为写入。
 * `.{0,40}?` 为有界惰性量词（杜绝长命令下的灾难性回溯），兼容 `sed -i ''` / `sed -i.bak` / `perl -i -pe` 等变体。
 * FR-003 的可扩展性以"向本数组追加一条正则"这一最轻形式满足，不引入 handler 注册表或策略接口。
 */
export const INLINE_EDIT_INDICATOR_REGEXES = [
  /\bsed\b.{0,40}?-i\b/,
  /\bperl\b.{0,40}?-i\b/,
];

/** 修复收口制品必填章节锚点（既有 Phase 1 模板固有 Root Cause 行） */
export const ROOT_CAUSE_HEADING_REGEX = /Root Cause/i;

/**
 * 未替换花括号占位符探测（FR-012a 空壳判据）——代码区豁免（F228 剥离后文本上扫描）。
 * F229：锚点收窄为"存在**任何 ASCII U+007B**"，**不要求闭合**——闭合与否与"是否已替换为
 * 真实内容"无关，把 canonical 模板的成对形态写进判据等于公开一条删掉一个 `}` 即可通过的逃逸路径。
 * 措辞注意：本正则**不检查 Markdown 转义**（`\{` 同样命中），故不要表述为"未转义的起始标记"。
 *
 * 本常量有**两个消费点**（见 checkArtifactSection 的四段 OR，勿再写成"只作用于已剥离文本"）：
 * - 第 3 段：作用在 `stripCodeRegions` 之后的 `placeholderScanText` 上。真实代码的花括号已被结构性
 *   豁免清空，故这里可以退化为最朴素的 `/\{/`：剥完代码区还剩 `{`，就一定不是"作者引用的代码"。
 * - 第 4 段：作用在**未剥离**的 `proseBody` 上，与 `strippedChars <= MIN_SECTION_BODY_CHARS` 取合取
 *   （F228 R3-1 边界判据）。这一段不靠正则排除真实代码，靠"剥离后剩余散文量"作判别锚点。
 */
const PLACEHOLDER_OPEN_BRACE_REGEX = /\{/;

/**
 * canonical 模板占位符（形如 `{根本原因一句话总结}`）：含中日韩表意文字、且不含 ASCII 冒号（F228 R2-2，
 * 排除集收窄自协调方复审：ASCII 冒号才是"这是代码/JSON 字面量"的可靠标志——对象字面量与 JSON
 * 必然靠键值 `:` 表达结构；ASCII 引号不是可靠标志，canonical 中文占位符本身也可能含引号
 * （如 `{spec 文件列表，或"无需更新"}`），若继续排除引号会把这类合法占位符误判为代码而漏判）。
 * 这类占位符是本仓 no-op/repair 模板固有的纯中文描述短语，即便被作者包进反引号 code span 也不构成
 * 豁免理由——代码区豁免只应给"作者引用真实代码"的花括号（含 ASCII 冒号，或不含中文），
 * 故本判据直接在**剥离代码区之前**的 proseBody 上扫描（见 checkArtifactSection），不吃 stripCodeRegions 的豁免。
 * F229：闭合边界从"必须是 `}`"放宽为"`}` 或**行尾**"——不成对花括号同样是未替换的模板起始
 * 标记，不应因少一个 `}` 而豁免。判据由两个 alternation 分支组成，职责刻意分离：
 * - 分支 1 `\{(?=[^}]*[一-鿿])[^}:]*\}`：**成对**形态，与 F229 之前逐字一致（含跨行成对占位符，
 *   如 `{根本原因\n一句话总结}`），保证新判据是旧判据的严格超集，不削弱任何既有判别力。
 * - 分支 2 `\{(?=[^}\n]*[一-鿿])[^}:\n]*$`（配合 `/m`，`$` = 行尾）：**不成对**形态，两处字符类
 *   与 lookahead 都排除 `\n`，把匹配硬锚在**同一行**内。
 *
 * 分支 2 必须排除 `\n` 且必须带 `/m`（F229 R1 回归教训，勿合并回单分支的 `(?:\}|$)`）：不带 `/m` 时
 * `$` 是**整段章节末尾**而非行尾，加上 `[^}:]*` 本身能跨换行，未闭合的 `{` 会一路吞过闭合围栏、
 * 吞过段落，直到章节结束才判定——于是"合法 repair 报告引用一段被截断的代码（含未闭合 `{`）、
 * 围栏之后再写中文说明"会被误判为占位空壳，违反 F228 已确立的代码区豁免语义。
 *
 * 因本判据作用在**未剥离**的原文上，无法借结构性豁免排除真实代码，故 CJK 前置断言与 ASCII 冒号
 * 排除集两项判别力在**两个分支中都逐字保留**、不可删：例如 `{"claim":"症状已消除",...`
 * （含 CJK 也含 ASCII 冒号）在遇到 `:` 时字符类被迫停止、停止点既非 `}` 也非行尾，两分支均失败，
 * 放宽后依旧正确豁免。切勿按旧注释里"成对花括号"的措辞重新引入全局闭合要求。
 *
 * 但 ASCII 冒号排除**只是每个 `{` 起点的局部条件**，不是"整段文本含冒号即整体豁免"的全局性质——
 * 某个 `{` 失败后引擎会从**后续每一个 `{`** 重新起匹配。反例 `{"claim":"{症状已消除`：第一个 `{`
 * 被冒号挡住，第二个 `{` 之后是纯 CJK 直到行尾，不成对分支命中。可靠的 JSON 豁免仍靠 F216 的
 * stripReconSubblock 结构性剔除与 F228 的代码区剥离，不要把本判据的局部条件当作 JSON 豁免保证。
 */
const CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*\}|\{(?=[^}\n]*[一-鿿])[^}:\n]*$/m;

/** 章节正文非占位所需的最小非空白字符数（no-op-report-template.md 合同：> 20） */
const MIN_SECTION_BODY_CHARS = 20;

// 角色分类模式（research.md D6，双语窄模式，subagent_type 与 description 共用）
// 刻意不把裸"修复"纳入 implement——"规划修复方案"/"生成修复任务"含"修复"但非"代码修复"，
// 宽模式会把 plan/tasks 误判为 implement 造成假合规。
// 裸"实现"同样剔除（codex implement 审查 W-4）——"验证实现正确性"这类 verify 描述含"实现"，
// 会被误判为 implement 凑出假角色配额；canonical implement 文本"执行代码修复"由"代码修复"覆盖。
const IMPLEMENT_ROLE_REGEX = /implement|代码修复/i;
const VERIFY_ROLE_REGEX = /verify|quality-review|spec-review|review|验证|审查/i;
// no-op 交叉核实类（比 verify 更宽，额外含 核实/确认；codex plan 审查 W-2 堵廉价委派）
const NOOP_VERIFY_ROLE_REGEX = /verify|spec-review|quality-review|review|验证|审查|核实|确认/i;

/** 委派工具名白名单（Agent=当前 CLI 记录名，Task=历史/未来名，等价对待） */
const DELEGATION_TOOL_NAMES = new Set(['Agent', 'Task']);

/**
 * missing 枚举 → 固定 action 文案映射（contracts/fix-compliance-judge-cli.md）。
 * 放 core 便于 T011 CLI 机械拼装反馈文本；单测断言每枚举都有文案，防新增枚举漏配。
 */
export const MISSING_ACTION_TEXT = {
  'fix-report.md': '缺少诊断报告：请完成问题诊断并将 fix-report.md 写入 specs/NNN-fix-<name>/（含 Root Cause 章节）',
  'verification-report.md': '缺少验证报告：请委派 verify 子代理完成 Phase 4 验证闭环（产出 verification/verification-report.md）',
  'delegation:implement': '缺少 implement 类委派：代码修复必须经 Task 委派 implement 子代理执行（禁止编排器行内修改）',
  'delegation:verify': '缺少 verify 类委派：验证闭环必须经 Task 委派 verify/review 类子代理执行',
  'delegation:noop-verify': '缺少 no-op 交叉核实委派：请委派一次 verify 类子代理核实"确实无需改动"这一判断',
  'noop:judgment-section': 'no-op 判定记录不完整：fix-report.md 必须含"## 判定依据"章节且给出具体证据（非占位文本）',
  'artifact:placeholder': '制品为占位空壳：请把模板占位符替换为真实内容',
  'feature-dir': '未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品',
  // F216 · no-op 复现证据门 6 键 canonical 文案（plan §2 表格逐字落地；含 FR-015 断言骨架）
  'noop:repro-fields': 'no-op 判定依据缺结构化复现对账：请先产出并经 Bash 工具亲自执行每条复现命令（使其在主 transcript 留下 tool_use/tool_result 执行记录），再在 `## 判定依据 > ### 复现对账` 下每条 bullet 写单行合法 JSON，如 `{"claim":"症状已消除","command":"<复现命令>","expected":"PASS"}`，其中 command 须与你经 Bash 执行的命令逐字一致，命令内换行用 \\n',
  'noop:repro-command-mismatch': '缺可执行复现痕迹：报告声称的复现命令在主 transcript 无对应 Bash 执行——请先经 Bash 亲自执行该命令再据实收口。断言骨架：`<断言> && printf \'SPEC-DRIVER-REPRO: PASS\\n\' || printf \'SPEC-DRIVER-REPRO: FAIL\\n\'`（FR-015）',
  'noop:repro-result-missing': '复现命令有调用但无执行结果（transcript 截断/未完成）：请确认命令执行完成并在主 transcript 留下 tool_result',
  'noop:repro-tool-error': '复现命令工具级报错（is_error）：无法据此判断 bug 不存在，请修正命令使其可执行',
  'noop:repro-output-mismatch': '复现输出无约定 PASS 标记：命令末行须精确输出 `SPEC-DRIVER-REPRO: PASS`（整行、唯一、末行），否则判 INCONCLUSIVE',
  'noop:repro-contradiction': '复现声明与执行记录冲突：报告声称已修但执行输出为 FAIL/矛盾 sentinel，请复核根因或转真实修复',
};

/** 双路径收口指引（尾部固定文案，逐字来自 contracts/fix-compliance-judge-cli.md） */
export const DUAL_PATH_GUIDANCE = [
  '两条合法收口路径任选其一：',
  '(A) 完整修复路径：诊断(fix-report.md) → 委派 implement 修复 → 委派 verify 验证(verification-report.md)',
  '(B) 确认无需改动路径：先经 Bash 亲自执行复现命令(使其在主 transcript 留下执行记录) + fix-report.md 写入"## 判定依据"章节(含具体证据与逐字一致的"### 复现对账"对账行) + 委派 1 次 verify 类子代理交叉核实',
].join('\n');

/** 降级放行前置说明行（GATE-DEGRADED 场景在缺口清单前追加） */
export const GATE_DEGRADED_PREFIX_LINE = '已达阻断上限(2 次)，本次降级放行——以下缺口仍未补齐，已落盘降级审计记录：';

// ────────────────────────────────────────
// transcript envelope → TranscriptEntry（纯转换，io 层复用以保证同源）
// ────────────────────────────────────────
// 说明：flattenToolResultContent 已下沉到 fix-compliance-execution-record.mjs，
// 本层 import back 供 normalizeTranscriptEntry 复用。

/**
 * 把单条 transcript envelope 归一化为 TranscriptEntry（data-model.md §2 + F216 ExecutionRecord 扩展）。
 * @param {object|null} raw - JSON.parse 后的 envelope；parseError 时传 null
 * @param {number} lineIndex
 * @param {boolean} parseError
 * @returns {{ lineIndex:number, role:string|undefined, textBlocks:string[], toolUseBlocks:{name:string,input:object,id:string|null}[], toolResultBlocks:{toolUseId:string|null,isError:boolean,flattenedContent:string}[], parseError:boolean }}
 */
export function normalizeTranscriptEntry(raw, lineIndex, parseError = false) {
  if (parseError || !raw || typeof raw !== 'object') {
    return { lineIndex, role: undefined, textBlocks: [], toolUseBlocks: [], toolResultBlocks: [], parseError: true };
  }
  const role = typeof raw.type === 'string' ? raw.type : undefined;
  const content = raw.message && raw.message.content;
  const textBlocks = [];
  const toolUseBlocks = [];
  const toolResultBlocks = [];

  if (typeof content === 'string') {
    // 字符串 content 视为单一文本块（T001 结论 2）
    textBlocks.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        toolUseBlocks.push({
          name: block.name,
          input: (block.input && typeof block.input === 'object') ? block.input : {},
          id: typeof block.id === 'string' ? block.id : null,
        });
      } else if (block.type === 'tool_result') {
        // tool_result 收进独立字段：由 harness 写入的可信 envelope，作复现执行证据配对源（F216 AD-2）；
        // 刻意不并入 textBlocks/toolUseBlocks——展开痕迹只认 user text、委派只认 assistant tool_use，
        // 这两个判定输入不被 tool_result 污染，反伪造语义不回退。
        //
        // 🔴 `isError: block.is_error === true` —— **缺省字段按成功处理**，与真实 wire format 一致
        // （成功回执通常不带 is_error）。勿改成 `block.is_error === false`：那会把绝大多数真实成功
        // 写入判成"非成功"，让 collectArtifactWriteWitnessDirs 的见证大规模缺席 → 大规模误阻断。
        toolResultBlocks.push({
          toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : null,
          isError: block.is_error === true,
          flattenedContent: flattenToolResultContent(block.content),
        });
      }
      // 其余块型刻意忽略（噪声容错）
    }
  }
  // 非 user/assistant 顶层类型或缺 content → 空集（T001 补充结论 7），toolResultBlocks 恒带空数组
  return { lineIndex, role, textBlocks, toolUseBlocks, toolResultBlocks, parseError: false };
}

// ────────────────────────────────────────
// transcript 方言识别（F240 FR-004）
// ────────────────────────────────────────

/**
 * Claude transcript 顶层 `type` 的**已知**取值域，非穷尽（normalizeTranscriptEntry 存入 entry.role）。
 *
 * 来源与已知偏差（本机全量实扫 `~/.claude/projects` 2676 份 .jsonl 取证）：真实取值域还包含
 * attachment / last-prompt / queue-operation / custom-title / mode / permission-mode /
 * file-history-snapshot / ai-title / frame-link / agent-name 等会话元数据 envelope，且随
 * Claude Code 版本演进；`summary` 则在该次实扫中 0 次出现（属早期推测保留项）。
 *
 * 因此本清单**刻意不作为承重判据**：它只用于正向认领"这确实是 Claude"，绝不用于反证
 * "这不是 Claude"。零落盘不变量由 fix-compliance-judge.mjs 的"仅正向识别到 Codex 才落盘"
 * 谓词机械保证，不依赖本清单追平上游版本（见 detectTranscriptDialect 规则 4 说明）。
 */
export const CLAUDE_TRANSCRIPT_ROLES = Object.freeze(['user', 'assistant', 'system', 'summary']);
/**
 * Codex rollout wire format 顶层 `type` 的**已知**取值域，非闭合。
 * 来源：本机全量实扫 `~/.codex/sessions` 1167 份 rollout（每项括号内为出现该 type 的文件数）——
 * session_meta(1167) / event_msg(1167) / response_item(1154) / turn_context(1001) /
 * world_state(95) / inter_agent_communication_metadata(33) / compacted(31)。
 * 上游新增 type 时本清单会落后：漏项只会让相应 rollout 切片**少落一条诊断**（回落静默），
 * 不会反向影响 Claude 侧零落盘不变量。
 */
export const CODEX_ROLLOUT_ROLES = Object.freeze([
  'session_meta',
  'event_msg',
  'response_item',
  'turn_context',
  'world_state',
  'compacted',
  'inter_agent_communication_metadata',
]);

/**
 * 需要落 loud 诊断的方言 → 诊断码（消费方 fix-compliance-judge.mjs 只认本表，不做字符串拼接）。
 *
 * 表内只放**正向识别成功**的异构方言。`unknown` 刻意不在表内：它是开放世界的否定
 * （"我不认识这份 transcript"），不构成"这是异构格式"的肯定断言——把它当断言用，等于让
 * 一份需要跟随上游版本维护的 role 清单去承担零落盘不变量（实测会误伤真实 Claude 会话）。
 *
 * 🔴 新增条目时必须同步 specs/208 的 fix-compliance-verdict-event.schema.json 的
 * diagnostics enum；`fix-compliance-judge-cli.test.mjs` 的合同同步用例遍历本表守住这一点。
 */
export const FOREIGN_DIALECT_DIAGNOSTICS = Object.freeze({ 'codex-rollout': 'dialect:codex-rollout' });

/**
 * 判定一组已归一化 entries 属于哪种 transcript wire format。
 *
 * 用途仅限**可观测性**：让"判定器读到了自己解析不了的格式"这一事实能被落盘诊断捕获，
 * 而不是经非 fix 分支静默放行。本函数不参与、也不影响任何合规结论与放行/阻断决策。
 *
 * 判定必须是**正向识别**（按序求值，见 specs/240 plan §5.3(1)）：
 *   1. 无可用条目           → 'empty'
 *   2. 存在任一 Claude role → 'claude'
 *   3. 存在任一 Codex role  → 'codex-rollout'
 *   4. 其余                 → 'unknown'（**"我不认识"，不是"这是异构格式"**；
 *      因两个 role 清单都非穷尽，健康的 Claude 会话完全可能落到这里，故消费方
 *      MUST NOT 据此落盘——见 FOREIGN_DIALECT_DIAGNOSTICS）
 *
 * 🔴 MUST NOT 用"这不是 fix 会话"反推方言：那会让每个健康的 Claude 非 fix 会话都落盘诊断，
 * 摧毁 fix-compliance-judge.mjs 的"健康路径零落盘"不变量并淹没审计事件流。规则 2 就是这条禁令的机械实现。
 *
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @returns {'claude'|'codex-rollout'|'unknown'|'empty'}
 */
export function detectTranscriptDialect(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let usable = 0;
  let codexHits = 0;
  for (const entry of list) {
    if (!entry || entry.parseError) continue;
    usable += 1;
    // 规则 2 一旦命中即可短路：Claude 归属优先于 Codex（混合形态保守判 claude）
    if (CLAUDE_TRANSCRIPT_ROLES.includes(entry.role)) return 'claude';
    if (CODEX_ROLLOUT_ROLES.includes(entry.role)) codexHits += 1;
  }
  if (usable === 0) return 'empty';
  return codexHits > 0 ? 'codex-rollout' : 'unknown';
}

// ────────────────────────────────────────
// 判定窗口锚定（D1）
// ────────────────────────────────────────

/**
 * 单趟扫描全部 user 文本块，同时产出**最晚**一次 spec-driver 技能展开（主锚点）与**最早**一次
 * `spec-driver-fix` 展开的 lineIndex（闸门三专用基线）。
 *
 * 🔴 主锚点语义（`found` / `mode` / `anchorLineIndex`）**逐字不变**——F216/F227/F224 全链依赖它。
 * `earliestFixLineIndex` 是**纯增量**返回字段，既有调用方逐字不受影响。
 *
 * why 两个基线要合并在一趟里求（F257 缺陷 2 修复轮）：闸门三原先另跑一遍 `SKILL_EXPANSION_REGEX`
 * 求最早展开，把最坏耗时整整翻倍。红队 A/B（诱饵形态 transcript）：改动前 10188ms → 改动后 19785ms。
 * 退化来源是 `SKILL_EXPANSION_REGEX` 里的惰性量词 `([^\n]+?)\/skills\/`——同一**行**内重复出现
 * `Base directory for this skill:` 诱饵前缀且该行不含 `/skills/` 时，每个诱饵起点都要把 `[^\n]+?`
 * 一路扩到行尾才放弃，整体 O(K×N)。诱饵位于真展开**之前**时，任何"找到即 break"的早退都失效。
 * 合并后全链只扫一趟，最坏耗时回到单趟量级（详见 SKILL_EXPANSION_REGEX 上的性能登记）。
 *
 * 反伪造：两个基线都只接受 user 角色（harness 注入）的 text 块，排除 assistant / tool_result。
 * 若接受 assistant 侧文本，被判方在会话末尾自述一句展开语即可把最早基线推到末尾 → 闸门三计数归零。
 *
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @returns {{ found:boolean, mode:string|null, anchorLineIndex:number|null, earliestFixLineIndex:number|null }}
 */
export function detectFixSkillExpansion(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let latest = { found: false, mode: null, anchorLineIndex: null };
  // 最早一次 **fix** 展开：与主锚点取值规则刻意不同（主锚点每块只看最后一次匹配的 mode，
  // 本基线看该块内**任一**匹配是否为 fix），故必须在同一趟里各自累计，不能互相推导。
  let earliestFixLineIndex = null;
  for (const entry of list) {
    if (!entry || entry.role !== 'user') continue;
    for (const text of entry.textBlocks) {
      // 全局匹配取该块内最后一次（同块多痕迹时取最晚）
      let match;
      let lastMode = null;
      SKILL_EXPANSION_REGEX.lastIndex = 0;
      while ((match = SKILL_EXPANSION_REGEX.exec(text)) !== null) {
        lastMode = match[2];
        if (earliestFixLineIndex === null && match[2] === 'fix') earliestFixLineIndex = entry.lineIndex;
      }
      if (lastMode !== null) {
        latest = { found: true, mode: lastMode, anchorLineIndex: entry.lineIndex };
      }
    }
  }
  return { ...latest, earliestFixLineIndex };
}

// ────────────────────────────────────────
// 委派抽取与角色分类（D6）
// ────────────────────────────────────────

/** 对单个 pattern 做角色匹配，命中返回角色名，否则 null */
function matchRole(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // implement 优先于 verify：canonical 文本已精确切分，二者互斥，顺序仅为确定性
  if (IMPLEMENT_ROLE_REGEX.test(text)) return 'implement';
  if (VERIFY_ROLE_REGEX.test(text)) return 'verify';
  return null;
}

/**
 * 委派角色级联分类（D6）：subagent_type 权威优先，无角色信息回落 description。
 * @param {string|null} subagentType
 * @param {string|null} description
 * @returns {'implement'|'verify'|'other'}
 */
export function classifyDelegationRole(subagentType, description) {
  return matchRole(subagentType) ?? matchRole(description) ?? 'other';
}

/** 判定单条委派是否属 no-op 交叉核实类（级联，模式比 verify 宽） */
function isNoopVerifyDelegation(subagentType, description) {
  const hit = (t) => typeof t === 'string' && NOOP_VERIFY_ROLE_REGEX.test(t);
  return hit(subagentType) || hit(description);
}

/**
 * 抽取锚点之后的委派记录（只认 assistant tool_use，name ∈ {Agent,Task}）。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ lineIndex:number, toolName:string, subagentType:string|null, description:string|null, roleClass:string, noopVerify:boolean }[]}
 */
export function extractDelegationsAfter(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  const out = [];
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (!DELEGATION_TOOL_NAMES.has(block.name)) continue;
      const input = block.input || {};
      const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : null;
      const description = typeof input.description === 'string' ? input.description : null;
      out.push({
        lineIndex: entry.lineIndex,
        toolName: block.name,
        subagentType,
        description,
        roleClass: classifyDelegationRole(subagentType, description),
        noopVerify: isNoopVerifyDelegation(subagentType, description),
      });
    }
  }
  return out;
}

// ────────────────────────────────────────
// 在途委派判定（F256 盲区 2：判定时机未到）
// ────────────────────────────────────────

/**
 * SendMessage 恢复后台子代理的工具名（F256 盲区 2）。
 *
 * 刻意不并入 DELEGATION_TOOL_NAMES——"派了工"（SendMessage 触发恢复）与"收了工"（子代理完成收口）
 * 是两个不同断言，把它计入委派会让「派一条消息」直接顶替「验证闭环已完成」。本常量只用于识别
 * "在途"信号，不参与 judgeCompliance 的 delegationCounts。
 */
const SEND_MESSAGE_TOOL_NAME = 'SendMessage';

/**
 * `<task-notification>` 完成信号内 `<task-id>`/`<tool-use-id>` 配对提取。
 *
 * 实测 wire format 中两者恒相邻、恒同顺序，故单一锚定正则一次捕获两个分组即可，无需解析完整
 * XML-like 结构。只从 `role === 'user'` 的文本块中提取（harness 注入，模型无法伪造），
 * 与 detectFixSkillExpansion 的反伪造模型一致。
 * `[^<]+` 由下一个 `<` 天然止界，双分组单趟线性扫描，无嵌套量词、无回溯
 * （判定器跑在同步 Stop hook 上，F231 有灾难性回溯前科）。
 *
 * 捕获组**必须**再经 trim（见调用点）：`[^<]+` 会把标签内侧的换行与缩进一并吃进 id，
 * 于是 `<tool-use-id>\nbg\n</tool-use-id>` 捕出 `"\nbg\n"`，与真实 id `bg` 配不上 →
 * 已完成的委派被继续判在途 → 偏向放行，与在途判定的主风险同轴叠加。刻意不改用
 * `[^<\s]+` 收窄字符类：那样只是让含空白的 id 整条不匹配（同样偏向放行），
 * trim 才是"按 wire format 语义归一化"的修法。
 */
const TASK_NOTIFICATION_PAIR_REGEX = /<task-id>([^<]+)<\/task-id>\s*<tool-use-id>([^<]+)<\/tool-use-id>/g;

/**
 * 尾部未消费的同步委派。
 *
 * **只检查 entries 最后一条条目**，这是承重的安全边界而非权宜：同步 Agent/Task 会阻塞会话轮次
 * 直至 tool_result 返回——只要该调用之后还有任何后续条目，就足以证明它已经解决（否则会话不可能
 * 继续产生新条目）。故"真正在途"只可能发生在整个 transcript 的最后一条条目上。
 *
 * 🔴 不得放宽为"扫描任意位置的未配对调用"：本仓库既有 fixture 构造 `TOOL_USE('Agent', …)` 时
 * 从不附带 tool_result（委派抽取此前不需要它），放宽会把大量本该阻断的用例集体误判为在途 →
 * 一次隐蔽的大规模 fail-open。
 */
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

/**
 * 后台 Agent/Task（run_in_background===true）尚未收到匹配 `<tool-use-id>` 完成通知者。
 *
 * 有效性门槛（与 findPendingSendMessageResumptions **同一条**，不得只给其中一条规则设）：
 * 仅计入自身已获得**非错误 tool_result 回执**的派发。后台派发在 wire format 上会立刻拿到一条
 * ack 回执（"launched in the background…"），故这一门槛不影响任何真实在途派发；而它堵住的是
 * 最廉价的自助绕过——发起一次注定失败（`is_error:true`）或压根没被受理的后台派发，
 * 即可让 runHook 永久判"在途"、永不进入阻断路由。规则 2 缺这道门槛而规则 3 有，
 * 等于把两条等价的推迟入口只锁了一扇门。
 *
 * 通知先归约为 Set 再做 O(1) 查表，**不是可省的优化**：判定器跑在同步 Stop hook 上，
 * 两者规模都只受 20MB transcript 上限约束（各自可达 10^5 量级），逐条 `Array.some` 会构成
 * O(委派数 × 通知数) 的二次扫描——F227 已有 O(N²) 候选历史导致 11.8s 同步阻塞的前科。
 *
 * 🔴 残余限界（如实登记，由 judge 层的 IN_FLIGHT_DEFER_LIMIT 有界化兜住，不在本函数消除）：
 * 实扫本机 2466 份 transcript，202 次后台派发中 **43 次（21.3%）回执正常、完成通知却从未到达**。
 * 即"每个在途委派最终都会回收通知"在真实数据上不成立，故本函数返回非空**不足以**支撑无界推迟。
 */
function findPendingBackgroundDelegations(entries, anchor, notifications, resultByToolUseId) {
  const notifiedToolUseIds = new Set(notifications.map((n) => n.toolUseId));
  const pending = [];
  for (const entry of entries) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (!DELEGATION_TOOL_NAMES.has(block.name)) continue;
      if (!block.input || block.input.run_in_background !== true || !block.id) continue;
      const result = resultByToolUseId.get(block.id);
      if (!result || result.isError === true) continue; // 无回执/回执报错 → 不计入在途
      if (!notifiedToolUseIds.has(block.id)) pending.push({ kind: 'background', id: block.id, lineIndex: entry.lineIndex });
    }
  }
  return pending;
}

/**
 * SendMessage(to: A) 最后一次派发晚于 A 最后一次 `<task-id>` 通知者。
 *
 * 有效性门槛：仅计入**自身已获得非错误 tool_result 回执**的派发。若不设此门槛，向一个虚构 `to`
 * 反复发送 SendMessage 即可让 runHook 永久判"在途"、永不进入阻断路由——deferred 不是 exempted，
 * 这一门槛是该语义的必要组成。
 *
 * 残余限界（如实登记）：持续向一个真实存在但恒不产出响应的 agent 重复派发，仍可让本函数恒返回非空。
 * 该残余面**不再**由本函数承担——judge 层的 IN_FLIGHT_DEFER_LIMIT 给推迟设了硬预算，
 * 耗尽后恢复正常裁决，故"恒在途"最多推迟固定次数而非无限期。
 */
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
 * 抽取锚点之后的"在途委派"——判定时机未到的第三态。
 *
 * 存在理由：判定器原本把 stop 一律当作会话终态做二值判定（合规/不合规），但后台委派使 stop 成为
 * **中途停顿**——已派工、结果未回的会话被误分类为"零 verify 委派的烂尾"。本函数给出第三态所需的
 * 结构化事实：锚点之后是否还有未回收的在途工作。
 *
 * 三条规则见上方三个私有函数的 JSDoc（同步尾部未消费 / 后台无完成通知 / SendMessage 派发晚于通知）。
 * 本函数零 I/O，判定结论如何使用（推迟裁决）由 judge 层决定。
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
    // 通知与回执都锚在同一个窗口：本函数的全部消费者只查**锚点之后**发起的委派，
    // 而其回执/通知的 lineIndex 必然 ≥ 该委派自身的 lineIndex（> anchor），
    // 故加窗不改变任何配对结果，只是不再把上一轮展开周期的回执读进 Map（与 notifications 写法一致）。
    if (entry.lineIndex <= anchor) continue;
    if (entry.role === 'user') {
      for (const text of entry.textBlocks) {
        TASK_NOTIFICATION_PAIR_REGEX.lastIndex = 0;
        let m;
        while ((m = TASK_NOTIFICATION_PAIR_REGEX.exec(text)) !== null) {
          // trim 见 TASK_NOTIFICATION_PAIR_REGEX 的 JSDoc：标签内侧换行/缩进不属于 id
          const taskId = m[1].trim();
          const toolUseId = m[2].trim();
          if (taskId.length === 0 || toolUseId.length === 0) continue;
          notifications.push({ taskId, toolUseId, lineIndex: entry.lineIndex });
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
  items.push(...findPendingBackgroundDelegations(list, anchor, notifications, resultByToolUseId));
  items.push(...findPendingSendMessageResumptions(list, anchor, notifications, resultByToolUseId));
  return items;
}

/**
 * 可推迟缺口白名单（F256 第 2 轮 CRITICAL-1c）——只有**在途工作确实有可能关闭**的缺口才配推迟。
 *
 * 判定"在途"只说明"还有子代理没回收"，不说明"回收之后缺口会被补上"。实测本机 174 个不合规
 * fix 会话中有 9 个（5.2%）的 missing 是 `["feature-dir","fix-report.md"]` 却因存在在途委派而被
 * 静默推迟：这两项是**主线程自己**该产出的制品，任何子代理回收都不会改变它们，推迟纯属延误。
 *
 * 表内四项恰是"由子代理产出/由子代理构成"的缺口：三类委派计数会随该子代理被计入，
 * verification-report.md 则由 verify 子代理落盘。
 * 🔴 新增枚举到 MISSING_ACTION_TEXT 时须显式判断是否入表，默认**不入**（fail-closed）。
 */
export const DEFERRABLE_MISSING_KEYS = Object.freeze([
  'delegation:implement',
  'delegation:verify',
  'delegation:noop-verify',
  'verification-report.md',
]);

const DEFERRABLE_MISSING_SET = new Set(DEFERRABLE_MISSING_KEYS);

/**
 * 这组缺口是否**整体**可由在途工作关闭（全称判定，非存在判定）。
 *
 * 必须取全称：只要 missing 里混进一项子代理关不掉的缺口（如 feature-dir），推迟就不可能等到
 * 缺口自愈，那次 stop 该照常裁决。空 missing 返回 false 是防御性的——不合规必有缺口，
 * 空集出现即说明上游状态异常，此时不推迟（fail-closed）。
 * @param {string[]} missing
 * @returns {boolean}
 */
export function isDeferrableMissingSet(missing) {
  const list = Array.isArray(missing) ? missing : [];
  if (list.length === 0) return false;
  return list.every((key) => DEFERRABLE_MISSING_SET.has(key));
}

// ────────────────────────────────────────
// 会话写入见证（F257 缺陷 1 · 方案 A′）
// ────────────────────────────────────────

/**
 * 可作为「本会话写入见证」的写工具名——**唯一的放宽点**，改动即改变整条判据的安全下界。
 *
 * why 只收 Write / Edit：二者的成败由 harness 写回的 `tool_result` 背书，被判方伪造不了成功回执，
 * 而要真拿到成功回执就必须**真的写了那份制品**——伪造证据与满足合同同价。
 * why 不收 Read：读一份别人的制品零成本，"读过即算见证"等于没有门槛
 * （实测真实会话锚点后 Read 触及制品 15 次）。
 * why 不收 Bash：Bash 的写形态可被 `cat X > /dev/null` 之类满足（F227 已知限界一），下界弱得多。
 */
export const ARTIFACT_WRITER_TOOL_NAMES = Object.freeze(new Set(['Write', 'Edit']));

/**
 * 被核验制品的**锚定**路径正则：整串匹配，捕获组 1 = 规范特性目录。
 *
 * 🔴🔴 承重不变量（第 3 轮红队实证，改动即复活一条 fail-open）：
 * **本正则收的制品类必须与 judge 侧采信谓词 `usable(dir)` 同源**——目前 `usable()` 只查
 * `fix-report.md`，故本正则也只能收 `fix-report.md`。二者一旦脱钩，就会出现「拿到了见证但不 usable」
 * 的目录：judge 的 F227 历史兜底只挑 usable 的历史候选故不选它 → 控制流照旧落进短名分支 →
 * 见证成立 → 重锚定到磁盘上本会话从未触碰的旧目录 → compliant:true → 合规早退（在任何
 * `appendAuditEvent` 之前）→ exit 0 且事后零审计线索。
 *
 * 红队实跑的绕过链（第 2 轮实现收 `verification/verification-report.md` 时成立）：
 * 本会话零真实产出 → 两次廉价 `Agent` 委派 → `Write specs/999-fix-<short>/verification/verification-report.md`
 * （1 字节，拿到成功回执）→ stop → exit 0。
 *
 * ⚠️ 第 2 轮注释里那段演绎证明（「见证集合 ⊆ 提名集合 ⟹ 被见证目录必进 candidateHistory ⟹
 * F227 兜底先手命中 ⟹ 可用磁盘目录 ∩ 见证 = ∅」）**已被证伪**，勿再据此放宽：
 * 「进 candidateHistory」**不蕴含**「usable」，兜底循环只挑 usable 者。同轮所谓「576 组排列穷举
 * 0 命中」的穷举集合也没覆盖「用 verification-report.md 作见证」这一形态。
 * 后人若把 `verification/verification-report.md` 加回本正则、或放宽 `usable()` 去认别的制品，
 * 上述绕过立刻复活——两处必须同时改、同时配回归用例。
 *
 * 🔴 不变量二：目录只能由「整条写入路径全串匹配后**反取**前缀」得到，禁止任何目录级子串比较
 * （`String.prototype.includes` / 裸 `startsWith(dir)`）。红队实证：用 includes 实现时
 * `specs/254-fix-alpha-retry` 会命中 `specs/254-fix-alpha`。本写法结构性回避该风险——
 * `specs/254-fix-alpha-retry/fix-report.md` 只能产出 `specs/254-fix-alpha-retry`。
 * 尾随 `/`、`//`、大小写差异一律不匹配（方向 fail-closed）。
 * 量词 `\d+` 与 `[a-z0-9-]+` 各自后接固定字面分隔符，无嵌套量词、无灾难性回溯面（F231 前车之鉴）。
 */
const ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$/;

/**
 * 把 tool_use 的 `file_path` 归一化为仓库相对路径并锚定匹配，命中则返回其特性目录，否则 null。
 *
 * 归一化逐条（每条不满足即 fail-closed 返回 null）：
 *  1. 必须是非空字符串；
 *  2. 绝对路径必须以 `projectRoot + '/'` 为**分段级**前缀后剥离——禁止裸 `startsWith(projectRoot)`，
 *     否则 `/repo-backup/...` 会命中 `/repo`，跨仓写入即可为本仓目录背书；
 *  3. 去掉单个前导 `./`；
 *  4. 含 `..` 段一律跳过（core 零 I/O 契约下无法可靠 resolve，软链场景尤其不可靠）；
 *  5. 全串匹配锚定正则，取捕获组 1。
 *
 * 🔴 已知分歧（第 4 轮审查补登记，**不修**）：**符号链接层面的不同源会让见证恒空 → 误阻断。**
 * 本函数按 core 零 I/O 契约做**纯字符串**前缀剥离（`startsWith(rootPrefix)`），不做 `realpath`；
 * 而提名侧 `resolveFeatureDirCandidate` 走的是 `ARTIFACT_PATH_REGEX` **子串**匹配、完全不看根。
 * 于是当 hook 的 `projectRoot` 与 `file_path` 在软链层面不同源时——macOS 经典的
 * `/tmp` ↔ `/private/tmp`、`/var` ↔ `/private/var`，或项目本身挂在软链下——
 * **提名成立而见证恒空**，短名重锚定被拒 → `feature-dir-witness-absent` 误阻断。
 *
 * 为何不修：引入 `realpath` 即引入 fs I/O，直接破坏 core 的零 I/O 契约（该契约本身是承重的——
 * 判定器跑在**同步** Stop hook 上）。生产风险已被压低：`hooks/stop-fix-compliance-check.sh` 以
 * `--project-root "$(pwd)"` 调用，与会话 cwd 同源；代价也有界（`BLOCK_LIMIT = 2`，最坏两次阻断后
 * 降级放行，且补一次相对路径写入即恢复）。但语料中确有 `cwd=/private/var/folders/...` 形态的会话，
 * 故按已知分歧登记而非声称不存在。与 contract 的 R11 条同源，只是触发面从"判定根错位"扩到"软链不同源"。
 * @param {unknown} raw
 * @param {string|null} rootPrefix - 已带尾斜杠的 projectRoot 前缀；null 表示无从判断绝对路径归属
 * @returns {string|null}
 */
function normalizeArtifactWritePath(raw, rootPrefix) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let rel = raw;
  if (rel.startsWith('/')) {
    if (rootPrefix === null || !rel.startsWith(rootPrefix)) return null;
    rel = rel.slice(rootPrefix.length);
  }
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (rel.split('/').includes('..')) return null;
  const match = ANCHORED_ARTIFACT_PATH_REGEX.exec(rel);
  return match ? match[1] : null;
}

/**
 * 收集「本会话 fix 锚点之后被成功写入过 `fix-report.md`」的特性目录集合（F257 缺陷 1 的采信证据源）。
 *
 * 存在理由：F256 的 short-name 磁盘重锚定只用 `usable()`（目录含 fix-report.md）做采信闸门，
 * 而 `usable()` 是**制品存在性**判据、不是**会话归属**判据。本会话零产出时，判定器会静默改用磁盘上
 * 同 short-name 的另一编号旧目录完成合规判定 → compliant:true → 合规早退（发生在任何审计落盘之前）
 * → exit 0 且事后零线索。本函数提供缺失的那一维证据。
 *
 * 🔴 制品类**只认 `fix-report.md`**，与 judge 的 `usable()` 严格同源——理由与红队绕过链见
 * `ANCHORED_ARTIFACT_PATH_REGEX` 的承重不变量注释。放宽制品类而不同步 `usable()` 会直接复活
 * 一条零审计的 fail-open。
 *
 * 合同（充要）：`dir ∈ 返回集合` ⟺ 存在 entry `E` 与其 tool_use 块 `B` 同时满足
 *  1. `E.role === 'assistant'` 且 `E.lineIndex > anchorLineIndex`；
 *  2. `ARTIFACT_WRITER_TOOL_NAMES.has(B.name)` 且 `B.id` 为非空字符串；
 *  3. `B.input.file_path` 经 normalizeArtifactWritePath 归一化后命中，取其特性目录；
 *  4. **该 `B.id` 的全部 tool_result 回执均非 error**。
 *
 * 🔴 窗口下界刻意用**最晚**一次展开（调用方传入 `anchor.anchorLineIndex`），与闸门三的计量基线
 * （`countAssistantEntriesSinceEarliestFixExpansion` 用**最早**一次 fix 展开）**方向相反**——这是刻意的，
 * 不是两处该"对齐"的疏漏：两侧各自取"重新展开 fix skill 不能让被判方获益"的那一端。
 *   · 见证用最晚锚点 ⟹ 会话中途重展开只会**收窄**见证集合（更难放行）；
 *   · 闸门三用最早展开 ⟹ 重展开无法把计数清零（更难推迟）。
 * 代价如实登记：重展开会让此前对制品的**合法**写入落到窗口外 → 见证清空 → `feature-dir-witness-absent`
 * 误阻断（judge 侧「类 X 形态 3」）。方向是收窄（fail-closed），补一次 Write/Edit 即恢复。
 * ⚠️ 若把窗口下界也改成最早展开，锚点前的陈旧写入事件会重新计入见证——放宽的是**放行**方向，
 * 与本判据的收口意图相反，不得以"统一基线"为由这么改。
 *
 * 关于条 4 取全称而非存在：`tool_use.id` 可被复用。实测 `Write(目标制品, id='X')` 拿到
 * `is_error:true` 后，任意无关工具复用 `id='X'` 拿到成功回执，即可让"存在某条非 error 回执"成立
 * 而凭空发证。取"全部回执均非 error"堵掉该配对击穿面。无回执 = 不通过（transcript 被截断、
 * 写入未被受理、显式失败三种情形同向 fail-closed）。
 *
 * 配对表刻意**只从非 assistant envelope 建**（纵深防御）：`normalizeTranscriptEntry` 会把 assistant
 * 自带的 tool_result 块也收进 toolResultBlocks，实测该块型可发证；当前 wire format 下模型产不出它，
 * 但真实回执本就只落在 harness 写入的非 assistant envelope，收窄不损失任何真实见证。
 *
 * 🔴 **承重逃逸面（如实登记，收窄制品类并未消除它）：见证不绑定终态。**
 * 本判据看的是 transcript **历史**（写入事件是否发生过），而制品判据看的是磁盘**终态**——二者时间
 * 解耦。红队已实证形态 W1：`Write specs/NNN-fix-<short>/fix-report.md` 拿到成功回执后立刻
 * `git checkout` / 删除回滚，磁盘上该目录零痕迹，而见证仍成立。这是 F227「终态存在性 ≠ 历史事件
 * 是否发生」的镜像，第 2 轮把它写成"边角限界"是低估——它现在是本判据下**唯一成本可控**的伪造路径，
 * 应按承重逃逸面对待。之所以仍接受：伪造者必须真的执行一次对该 short-name 家族制品的写入并拿到
 * harness 回执（成本高于 F227 已知限界一的 `cat X > /dev/null`），且该写入事件本身留在 transcript
 * 里可被事后审计。要真正闭合它需要把见证与磁盘终态做交叉核验，属独立跟进项，不在本轮范围。
 *
 * 本函数零 I/O：`projectRoot` 只用于绝对路径的字符串前缀剥离，不做任何 fs 调用。
 * 复杂度 O(entries + toolUseBlocks + toolResultBlocks)，与 extractInFlightDelegationsAfter 同阶
 * （判定器跑在**同步** Stop hook 上，这是硬约束）。
 *
 * 返回**完整目录路径**而非 short-name：信息不丢失，如何比较由 judge 层决定（见其家族级比较注释）。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @param {string} projectRoot
 * @returns {Set<string>} 形如 'specs/254-fix-alpha' 的规范特性目录路径
 */
export function collectArtifactWriteWitnessDirs(entries, anchorLineIndex, projectRoot) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  const witnessed = new Set();

  // 第一趟：tool_use id → 回执聚合（anyError 为该 id 的**任一**回执失败）。
  // 不加锚点窗口：回执可能落在任意位置，而 id 由被判方无法伪造的 harness 侧配对，
  // 全量建表只会让判据更严（多看见一条 error 回执 = 更不容易发证）。
  const receiptByToolUseId = new Map();
  for (const entry of list) {
    if (!entry || entry.role === 'assistant') continue;
    for (const result of entry.toolResultBlocks) {
      if (typeof result.toolUseId !== 'string' || result.toolUseId.length === 0) continue;
      const prev = receiptByToolUseId.get(result.toolUseId);
      if (prev) prev.anyError = prev.anyError || result.isError === true;
      else receiptByToolUseId.set(result.toolUseId, { anyError: result.isError === true });
    }
  }

  const rootPrefix = typeof projectRoot === 'string' && projectRoot.length > 0
    ? `${projectRoot.replace(/\/+$/, '')}/`
    : null;

  // 第二趟：锚点后的 assistant 写入，逐块过四条合同
  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      if (!ARTIFACT_WRITER_TOOL_NAMES.has(block.name)) continue;
      if (typeof block.id !== 'string' || block.id.length === 0) continue;
      const receipt = receiptByToolUseId.get(block.id);
      if (!receipt || receipt.anyError) continue;
      const dir = normalizeArtifactWritePath(block.input && block.input.file_path, rootPrefix);
      if (dir !== null) witnessed.add(dir);
    }
  }
  return witnessed;
}

// ────────────────────────────────────────
// 会话长度计量（F257 缺陷 2 · 闸门三的单调计量源）
// ────────────────────────────────────────

/**
 * 自**最早**一次 `spec-driver-fix` 技能展开之后的 assistant 条目总数。
 *
 * 存在理由：在途推迟的唯一上界（`IN_FLIGHT_DEFER_LIMIT`）存放在
 * `.specify/runs/.fix-compliance-state/<sessionId>.json`——该目录位于 projectRoot 下、被 gitignore、
 * 属"本地运行态"，`loadBlockState` 对缺失/损坏一律静默回落 0。实测：每轮 stop 前先 `rm -rf` 该目录，
 * 10 轮全部 exit 0、审计 `degraded=false`、终态记录 0 条——一条比 blockCount 篡改更安静的静默通道。
 * 本函数提供一个**不落在 projectRoot 下、被判方不经手写入**的计量源，供 judge 层并联取严。
 *
 * 🔴 基线必须是「最早一次 fix 展开」，**绝不能**改用 `detectFixSkillExpansion` 的**主锚点**
 * （`anchorLineIndex`）——主锚点取的是**最晚**一次展开，agent 自己再调一次 `Skill(spec-driver-fix)`
 * 即可把它推到末尾、同时保持 `isFix=true`，令锚点后计数归零。对抗审查已实跑证伪：攻击组每轮重展开
 * → **30/30 全 exit 0**、锚点后计数恒 4；对照组（不重展开）则正常收敛为 `0 0 2 2 2 2 2 2`。
 * 以最早展开为基线后，重展开只是**追加**条目，基线不动，计数继续单调递增。
 *
 * 🔴 基线由**入参**给入而不再自行扫描（F257 缺陷 2 修复轮）：`SKILL_EXPANSION_REGEX` 含惰性量词，
 * 诱饵前缀语料下单趟即 O(K×N)（红队 A/B：多扫一趟把 10188ms 翻到 19785ms）。故基线改由
 * `detectFixSkillExpansion(entries).earliestFixLineIndex` 在**同一趟**里顺带产出，本函数只做计数。
 * ⚠️ 调用方**必须**传 `earliestFixLineIndex`，不得在此另起一遍展开扫描把第二趟加回来。
 *
 * ⚠️ 同样**不得**反过来去改 `detectFixSkillExpansion` 的主锚点语义（会牵动 F216/F227/F224 全链）：
 * `earliestFixLineIndex` 是纯增量返回字段，主锚点三字段逐字不变。
 *
 * 反伪造由基线的产出方保证：展开痕迹只认 `role === 'user'` 的文本块（harness 注入面）。
 * 若接受 assistant 侧文本，被判方在会话末尾自述一句展开语即可把基线推到末尾 → 计数归零。
 *
 * 单调性的边界（如实登记，非本函数消除）：会话 compaction 会重写 transcript，可能使计数回退；
 * 但 compaction 通常连 fix 展开痕迹一并吞掉 → `isFix=false` → 走的是另一条早退面，另案登记。
 *
 * 基线缺席（null / 未传 / 非数字）时取 -1（全量计数）——方向 fail-closed：更容易触顶，而不是更宽松。
 * 复杂度 O(entries)，单趟计数、不跑任何正则（判定器跑在**同步** Stop hook 上）。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} [earliestFixLineIndex] - 来自 detectFixSkillExpansion 的最早 fix 展开 lineIndex
 * @returns {number}
 */
export function countAssistantEntriesSinceEarliestFixExpansion(entries, earliestFixLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const baseline = typeof earliestFixLineIndex === 'number' ? earliestFixLineIndex : -1;
  let count = 0;
  for (const entry of list) {
    if (entry && entry.role === 'assistant' && entry.lineIndex > baseline) count += 1;
  }
  return count;
}

// ────────────────────────────────────────
// 特性目录提名（D1）
// ────────────────────────────────────────

/**
 * 段分隔符（F225）：`&&` / `||` / `;` / 换行。
 * alternation 中双字符 token 在前，落单的 `|` / `&` 不会被命中——裸管道与后台符刻意不作为分隔符
 * （`... | tee <path>` 语义上不是独立动作边界，切开会产生失真分段）。
 * 不带 `/g`：`String.prototype.split` 内部用带 `y` 的 species 克隆匹配，既不读也不写原正则的
 * lastIndex，`/g` 在此无作用且会让读者误以为该常量有跨调用状态。
 */
const SEGMENT_SPLIT_REGEX = /&&|\|\||;|\r?\n/;

/**
 * 行连接（line continuation）：反斜杠 + 换行。
 * alternation 第一支 `\\\\` 先吃掉成对的转义反斜杠，使 `\\`（字面反斜杠）后面的换行不会被
 * 误判为续行；第二支才是真正的续行序列。
 */
const LINE_CONTINUATION_REGEX = /\\\\|\\\r?\n/g;

/**
 * 消解 shell 行连接：`\` + 换行会被 shell 整体删除、两侧拼成同一条逻辑行，
 * 因此必须在切段**之前**还原，否则 `printf x > \<换行>specs/.../fix-report.md` 会被
 * 换行分隔符拆成「有写指示符无路径」+「有路径无写指示符」两段而漏提名（F225 R-1）。
 * 已知限界：不感知 quoted heredoc（`<<'EOF'`）——其 body 内的行尾反斜杠在真实 shell 中是字面量、
 * 不构成续行，这里仍会被消解，效果是把该 body 的两行并成一段（合并而非划分）。
 * @param {string} command
 * @returns {string}
 */
function unfoldLineContinuations(command) {
  return command.replace(LINE_CONTINUATION_REGEX, (match) => (match === '\\\\' ? match : ''));
}

/**
 * 把一条 Bash 命令切成保序的文本片段序列（F225）。
 * 只做字面分隔符切分，**不是**语法级解析：引号内、`$()` 内、heredoc body 内出现的 `;` / `&&`
 * 同样会被切开，所以片段不保证等价于真正的 Bash 子命令。这对本模块够用——切分是**划分**而非合并，
 * 只会让「写指示符与 artifact 路径共现」判据更严，不会新增劫持面（代价见「已知限界」测试用例）。
 * @param {string} command
 * @returns {string[]}
 */
function splitCommandTextSegments(command) {
  return unfoldLineContinuations(command).split(SEGMENT_SPLIT_REGEX);
}

/**
 * 单个子命令段是否含写入指示符（重定向/heredoc/tee，或 F224 的原地编辑 `sed -i` / `perl -i`）。
 * 写入形态判定收口为单一谓词：新形态并入此处的 OR 分支即可自动获得 F225 的「同段共现」语义，
 * 无需改动 resolveFeatureDirCandidate 的分段循环（F225 plan §合并预案指定的单点合并位）。
 * @param {string} segment
 * @returns {boolean}
 */
function hasBashWriteIndicator(segment) {
  return BASH_WRITE_INDICATOR_REGEX.test(segment)
    || INLINE_EDIT_INDICATOR_REGEXES.some((re) => re.test(segment));
}

/**
 * 从一条 Bash 命令中识别改名事件：**整条命令必须就是一条光杆 `mv` / `git mv`**（F231 第 5 轮）。
 *
 * 核心不变量（合同）：**产出改名事件 ⟺ 整条命令文本就是一条光杆改名**——首尾 shell 空白剥离后，
 * 按 `[ \t]+` 切 token，须为 `(git )?mv` + 白名单 option* + 恰好两个合法 `<PATH>` 操作数，
 * 且两操作数构成可信的 SRC→DST（见 isDistinctRenameTarget / dst 不得尾随 `/`）。
 * 满足则产出**恰好一条**事件，否则返回 `[]`（零事件 = 候选停在改名前目录 = 交既有严格判据裁决）。
 * 刻意**不做**行连接消解、**不做** heredoc 剥离——整条文本原样比对；判定为 token 化线性实现，无回溯。
 *
 * ## soundness 论证（为何这是可靠下界）
 *
 * 若整条命令就是一条带字面路径操作数的 `mv`/`git mv`，则它是该 Bash 调用中**唯一**的命令，
 * 必然被求值。于是判据**无需**推理执行可达性，也**无需**建模 heredoc / 引号 / 注释 / 内建 /
 * 重定向 / 赋值前缀 / 语法合法性：任何多命令、任何元字符、任何引用构造、任何语法错误都不再匹配。
 *
 * 这是把 soundness 从「穷举坏形态」（黑名单）或「模拟 bash 语法」（前四轮的简单命令序列白名单）
 * 改为「只认一个可人眼校验的字面形态」。前两种路线各自死于同一模式——每补一个缺口就暴露下一个：
 * 控制流分支 / `exit` 终止 / alias 展开 / heredoc 正文与终止行 / ANSI-C `$'…'` 引号模型分歧 /
 * 赋值前缀 `X=1 exit` / 重定向前缀 `>/dev/null exit` / 引号剥离 `'exit'` / `builtin`·`command`
 * 前缀 / 转义 `ex\it` / `readonly` 只读赋值 / `bash -n` 语法错误命令，全部只能靠继续加判据关闭，
 * 即「手写半个 bash 解析器」。本判据一次性关闭全部上述家族及其未知变体。
 *
 * `<PATH>` 字符集是判据的**必要组成**：若允许 `;` 等元字符进入操作数，`mv A B;` 会解析出
 * dst=`B;` → 不符合 `NNN-fix-<name>` → `ambiguous=true` → 重开 F224 fail-open 降级通道。
 *
 * ## 已知限界（方向刻意保守：误阻断而非误放行）
 *
 * 非光杆形态的**真实**改名一律不跟随：`prep && mv`、`mv A B; mv B C` 多跳、`|`/`&`/`|&` 串联、
 * `cat > 制品 <<EOF … EOF` 换行 `mv`（heredoc 后改名）、`mv A B # 注释`、含引号或变量的路径
 * （`mv "$OLD" "$NEW"`）、带重定向（`mv A B 2>&1`）、带前缀（`time mv` / `sudo mv`）、
 * `mv A B` 后跟 CR（`\r`，bash 会把 CR 计入目录名）、dst 尾随 `/`、src 与 dst 互为祖先/后代或仅大小写不同、
 * 裸 `mv` 的长选项（Darwin 上是 illegal option）。后果是候选停在旧路径、撞磁盘核验报「未建立特性目录」exit 2。
 * （**尾随 LF 例外**：`mv A B\n` 属首尾空白剥离范围，照常跟随——见第 6 轮。）
 * 缓解：把改名**单独写成一条** `git mv specs/old specs/new`（不与任何其他命令同处一次 Bash 调用）。
 * 刻意不为上述形态开例外——每一个例外都要重新引入被证否的 bash 语法建模。
 *
 * 返回值形状与调用方契约不变：`offset` 指向命令名（`git` 或 `mv`）起始处，供
 * `resolveFeatureDirCandidate` 按偏移归段（光杆命令只有一段，恒落在首段）；`paramText` 为命令名
 * 之后的剩余文本，仍交 `parseRenameOperands` 解析——后者的「多操作数 / 带参 option 整条拒绝」
 * 保守化合同继续叠加生效（如 `mv -t DIR SRC` 形状匹配但仍被拒）。
 * @param {string} command
 * @returns {{ offset:number, paramText:string }[]} 至多一条
 */
export function scanRenameCommandEvents(command) {
  const raw = String(command);
  // 首尾空白剥离与前导计数**共用** isShellWhitespace，字符集由构造保证一致；
  // 双向线性扫描（不用 `[ \t\n]*$` 之类未锚定尾随正则——那是 O(n²)，见 isShellWhitespace 的 DoS 说明）。
  let leading = 0;
  while (leading < raw.length && isShellWhitespace(raw[leading])) leading += 1;
  let end = raw.length;
  while (end > leading && isShellWhitespace(raw[end - 1])) end -= 1;
  const stripped = raw.slice(leading, end);
  // 内部换行 = 多命令形态；CR 不是 bash 分隔符（第 9 轮），两者出现即整条拒绝
  if (stripped.includes('\n') || stripped.includes('\r')) return [];

  const tokens = stripped.split(SHELL_TOKEN_SEPARATOR_REGEX);
  // 命令名：`mv` 或 `git mv`。nameEnd = 命令名在 stripped 中的结束下标，供切出逐字 paramText。
  let idx;
  let nameEnd;
  if (tokens[0] === 'mv') {
    idx = 1;
    nameEnd = 2;
  } else if (tokens[0] === 'git' && tokens[1] === 'mv') {
    let k = 3;                                             // 'git'.length
    while (k < stripped.length && (stripped[k] === ' ' || stripped[k] === '\t')) k += 1;
    idx = 2;
    nameEnd = k + 2;                                       // 跳过 'mv'
  } else {
    return [];
  }

  // 严格 option 白名单：只放行确定保持「真实改名」语义的 option（拒绝 dry-run / 非法 / 捆绑带参）；
  // 长选项按命令类型分流——裸 mv 在 Darwin 上 `--force` 即 illegal option（第 10 轮 C4）
  const isGitMv = idx === 2;
  while (idx < tokens.length && isAcceptedRenameOption(tokens[idx], isGitMv)) idx += 1;
  const operands = tokens.slice(idx);
  // 恰好两个操作数：多操作数（`mv A B C` 语义是"移入目录 C"）与单操作数均非改名，整条拒绝
  if (operands.length !== 2) return [];
  const [src, dst] = operands;
  if (!RENAME_PATH_TOKEN_REGEX.test(src) || !RENAME_PATH_TOKEN_REGEX.test(dst)) return [];
  // C1：**目标**操作数尾随 `/` 必然不是 SRC→DST——dst 已存在时真实落点是 `DST/basename(SRC)`
  // （本机实测：`mv specs/230-fix-x specs/renamed-nonstandard/` 落到
  // `specs/renamed-nonstandard/230-fix-x`，判定器却会记 dst=`specs/renamed-nonstandard`）。
  // 判定器无法知道 dst 是否已存在，故一律拒绝。**源**操作数尾随 `/` 保持允许（`mv SRC/ DST` 是真改名）。
  if (dst.endsWith('/')) return [];
  // 非规范 path segment（`.` / `..` / `//` / 绝对路径）→ 规范化后可能与源同路径 = 实际没发生改名
  if (!hasCanonicalPathSegments(src) || !hasCanonicalPathSegments(dst)) return [];
  // C2/C3：同路径（含仅大小写不同）、dst 是 src 的祖先或后代 → 实际不发生 SRC→DST
  if (!isDistinctRenameTarget(src.endsWith('/') ? src.slice(0, -1) : src, dst)) return [];

  // paramText 取 stripped 中命令名之后的**原始子串**（保留其空白形态与 flag 段），不用 join 重建
  // ——它要交 parseRenameOperands，且既有测试断言了其逐字值（如 tab 分隔形态）。
  // offset 必须是**原始**文本中命令名的下标：剥掉几个前导字符就补回几个（命令名在 stripped 中恒起于 0）。
  // resolveFeatureDirCandidate 按 offset 归段，偏移错位会破坏 F230 R3-C4 的提名/改名时序语义。
  return [{ offset: leading, paramText: stripped.slice(nameEnd) }];
}

/**
 * 与 `splitCommandTextSegments` 同源的分段，但额外给出每段在（行连接消解后）命令文本中的跨度。
 * 供 `resolveFeatureDirCandidate` 把改名事件按偏移归回**它所属的那一段**，
 * 从而在拥有完整命令词法上下文的同时，保持「逐段先提名、再改名」的原有执行时序
 * ——若改为「先跑完所有段的提名、再统一改名」，早于提名发生的改名会被倒灌到后来才出现的候选上。
 * @param {string} command
 * @returns {{ text:string, start:number, end:number }[]}
 */
function splitCommandTextSegmentSpans(command) {
  const text = unfoldLineContinuations(command);
  const spans = [];
  let cursor = 0;
  const splitter = new RegExp(SEGMENT_SPLIT_REGEX.source, 'g');
  let match;
  while ((match = splitter.exec(text)) !== null) {
    spans.push({ text: text.slice(cursor, match.index), start: cursor, end: match.index });
    cursor = match.index + match[0].length;
    if (match[0].length === 0) splitter.lastIndex += 1; // 防御空匹配死循环
  }
  spans.push({ text: text.slice(cursor), start: cursor, end: text.length });
  return spans;
}

/**
 * 从锚点后的制品写入痕迹提名特性目录候选，取最后出现者（codex implement 审查 C-2 硬化）：
 * - Write/Edit：`input.file_path` 必须命中 required artifact 路径（fix-report.md / verification-report.md）
 * - Bash：`input.command` 命中 artifact 路径 **且** 含写入指示符（重定向/heredoc/tee）——
 *   排除 `echo specs/301-fix-old` / `cat .../fix-report.md` 等纯提及旧路径的读形态
 * - Bash 同段共现（F225）：写入指示符与 artifact 路径必须落在**同一文本片段**（先消解 `\` 行连接，
 *   再按 `&&`/`||`/`;`/换行 切分）才提名；跨段命中不再互相背书——否则
 *   `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md`
 *   这类复合命令中，前段的无关写入会为后段纯读形态的历史合规目录背书，绕过 FR-007 判定窗口
 *   （见 specs/225-fix-compound-command-hijack/fix-report.md R2-R4）。
 * 提名后取 artifact 路径的目录前缀作为候选；提名≠判据——磁盘核验（io 层）才采信。
 * 说明：诚实流程的 fix-report.md 由编排器亲自（Phase 1 inline 豁免）经 Write 写入主 transcript，
 * 提名可靠；verification-report.md 由 verify 子代理在 sidechain 写入、主 transcript 可能不可见，
 * 但目录前缀由 fix-report.md 提名即可，verification-report 的存在性走磁盘核验。
 *
 * F224 在上述语义之上补两处解析盲区（判据不放宽，只放宽准入与跟随）：
 * - 盲区 A 改名跟随（FR-001）：`git mv`/`mv` 把已提名的候选目录搬走后，候选须跟随到新路径，
 *   否则拿已不存在的旧路径去撞磁盘核验必然误报"未建立特性目录"。改名识别刻意**不受**写指示符门禁约束
 *   （改名命令天然不含重定向符），但只在 src **精确等于**当前已知候选时才采信——不响应 transcript 中
 *   任意无关的 mv，天然维持 FR-007 的锚定语义；与写入提名不同，改名事件在整条命令上扫出、
 *   再按字符偏移归回所属段落（F230 第 3 轮，理由见 scanRenameCommandEvents 与 splitCommandTextSegmentSpans）。
 * - 盲区 B 原地编辑准入（FR-002）：`sed -i` / `perl -i` 这类不含重定向符但确实写入制品的命令，
 *   过去被写指示符门禁挡在扫描之外。现以 INLINE_EDIT_INDICATOR_REGEXES 拓宽门禁，命中后仍走同一条
 *   ARTIFACT_PATH_REGEX 判据，写入证据的认定标准与改动前逐字一致。
 *
 * `ambiguous` 仅在"制品目录已被改名搬走、但当前目录名不满足 NNN-fix-<name> 从而无法机械确定位置"时置真，
 * 供编排层转入 FR-004/FR-005 的 fail-open 降级 + 诊断留痕。刻意不为"只写了非制品文件"置真——
 * 目录路径已知时磁盘检查足以裁决，该情形应继续交既有严格判据硬阻断，不得借降级通道放行。
 *
 * 实现上分离两个状态（Codex 复审订正，FR-008）：`trackedDir` 无论命名是否规范都跟踪制品当前所在目录，
 * `candidate` 只在 trackedDir 命名规范时才等于它。故 `ambiguous` 是**可恢复**的——
 * `合法 → 非规范 → 合法` 的多跳改名链能一路续跟到最终态并恢复出确定候选，而不会停在中间态。
 * 若只用单一 candidate 变量，第一跳置 null 后 `src === candidate` 判断即失效，后续跳无法续跟。
 *
 * F227（方案 D）新增只读旁路字段 `candidates`——候选提名历史。**状态转移逻辑逐字不变**：
 * `candidates` 只是把状态机已经产生的序列旁路记录下来，供 judge 层在
 * "主候选磁盘不可用"时按需兜底消费，不参与、不影响本函数内部任何判定。
 *
 * **本函数不接受任何磁盘探针参数、不做任何 I/O**（F227 冻结契约）：`path`/`ambiguous` 的计算路径
 * 与取值只由 transcript 决定。F231 第 11 轮曾试图注入磁盘探针关闭「DST 已存在 → 嵌套搬入」形态，
 * 第 12 轮实测双向证伪（假阴 + 假阳）后整体回退，本契约恢复原状。
 * 不变量：
 * - `candidates` 中每个元素都曾在某一时刻满足 `FIX_DIR_NAME_REGEX`
 * - 顺序 = 最近一次被合法提名的先后顺序（move-to-end，非首次出现顺序）
 * - `path` 非 null 时，`path === candidates[candidates.length - 1]`
 * - `path` 为 null 时，`candidates` 仍保留此前全部合法提名历史，供调用方按需兜底
 *
 * 已知限界一（冒用已存在且制品齐全的历史特性目录）：用户已明确知情并接受。这在改动前已存在
 * （只需把该提名放在最后一条使其成为 last-writer-wins 的赢家）；方案 D 的效果是让它在**主候选不可用**
 * 这一分支里对提名位置不再敏感——不需要是最后一条，只要曾被合法提名过就可能被兜底选中。
 * 真实案例（会话写入自己的目录）与该攻击构造（会话写入他人的目录）在 transcript 文本上完全同构，
 * 判定器原理上无法区分意图；彻底关闭需要"制品确由本次会话创建"的带外证据（mtime/git 状态），
 * 而这类证据在 commit/rebase/worktree 重新检出后会失准，代价超出本次修复范围。
 *
 * 已知限界二（F224 fail-open 降级通道可被 transcript 中伪造的 `mv` 文本触发）：改动前既有缺陷
 * （编排器已在未修改源码 + 磁盘零目录场景下独立复现），方案 D **不引入、不修复、也不使其更易触发**——
 * 状态机零改动意味着可触发该降级通道的 transcript 输入集合与改动前逐字相同。已另开独立跟进项。
 * @param {ReturnType<typeof normalizeTranscriptEntry>[]} entries
 * @param {number|null} anchorLineIndex
 * @returns {{ path: string|null, ambiguous: boolean, candidates: string[] }}
 */
export function resolveFeatureDirCandidate(entries, anchorLineIndex) {
  const list = Array.isArray(entries) ? entries : [];
  const anchor = typeof anchorLineIndex === 'number' ? anchorLineIndex : -1;
  // trackedDir：制品当前实际所在目录，**无论命名是否规范**都持续跟踪，使多跳改名可续跟（FR-008）
  // candidate：对外暴露的合法候选，仅当 trackedDir 命中 FIX_DIR_NAME_REGEX 时才等于 trackedDir
  let trackedDir = null;
  let candidate = null;
  let ambiguous = false;
  // F227 D：候选历史只读旁路——move-to-end 去重，仅供 judge 层"主候选不可用时"兜底消费，
  // 不参与、不影响本函数内部任何状态转移判定（状态机逻辑与改动前逐字一致）。
  //
  // 容器必须是 Map 而非数组：Map 保证插入序，`delete` 后 `set` 即 O(1) 的 move-to-end。
  // **不要改回 `indexOf`+`splice` 的数组实现**——那是每次提名一次线性扫描、N 个不同候选累计 O(N²)。
  // 实测（单条 Bash 命令内 N 个互不相同的合法 artifact 路径，体积远低于 20MB transcript 上限）：
  //   数组版 N=20,000 → 3,034ms；N=40,000（1.26MB）→ 12,004ms；Map 版两者均为个位数 ms。
  // 本判定器跑在**同步** Stop hook 里，几 MB 的合法 transcript 就足以把门禁推到分钟级或宿主超时，
  // 导致门禁不可用或异常 fail-open。回归锚点见 fix-compliance-core.test.mjs 的 F227 性能用例。
  const candidateHistory = new Map();
  const pushCandidateHistory = (dir) => {
    candidateHistory.delete(dir); // 已存在则先移除，保证重新 set 落到末尾（move-to-end）
    candidateHistory.set(dir, true);
  };

  const stripTrailingSlash = (p) => p.replace(/\/+$/, '');

  /** 由当前 trackedDir 重算对外候选与降级标记（命名规范 ↔ 合法候选，非规范 ↔ ambiguous） */
  const syncCandidateFromTrackedDir = () => {
    if (trackedDir !== null && FIX_DIR_NAME_REGEX.test(trackedDir)) {
      candidate = trackedDir;
      ambiguous = false;
      pushCandidateHistory(trackedDir); // F227 D：只在合法命名时记入候选历史
    } else {
      // 目录确定已搬走但新位置无法机械确定 → 转降级路径，而非继续用旧路径撞磁盘核验产生误报
      candidate = null;
      ambiguous = true;
    }
  };

  const scanArtifactPath = (text) => {
    if (typeof text !== 'string') return;
    let match;
    ARTIFACT_PATH_REGEX.lastIndex = 0;
    while ((match = ARTIFACT_PATH_REGEX.exec(text)) !== null) {
      // 取 artifact 路径的特性目录前缀（specs/NNN-fix-<name>）
      trackedDir = match[0].replace(/\/(?:fix-report\.md|verification\/verification-report\.md)$/, '');
      syncCandidateFromTrackedDir();
    }
  };

  const applyRenameEvent = (paramText) => {
    if (trackedDir === null) return; // 尚无已跟踪目录时的改名与本次收口无关（FR-001 只跟随"已知"目录）
    const operands = parseRenameOperands(paramText);
    if (operands === null) return; // 异常形态整条跳过（保守化：不跟随、也不置 ambiguous）
    const src = stripTrailingSlash(operands[0]);
    if (src !== trackedDir) return;
    // 已知限界（F231 第 12 轮，经实测确认后如实保留）：`mv SRC DST` 在 DST **运行时已是目录**时，
    // 真实落点是 `DST/basename(SRC)` 而非 DST，命令文本与合法改名逐字相同、**静态不可判定**。
    // 第 11 轮曾引入「注入式磁盘探针」（探到 `DST/basename(SRC)` 就拒绝跟随），第 12 轮实测**双向证伪**：
    //   - 假阴：探针读的是**单一终态快照**，而终态同样在攻击者控制下——嵌套后再把痕迹搬走，
    //     探针即返回 false，fail-open 完全恢复。这正是 F227「终态快照 ≠ 历史事件序列」的教训，
    //     「否证方向」并不豁免（曾以为可以，实测不行）。
    //   - 假阳：合法 `A→B` 后若 A 原本含同名子目录 `A/A`，终态存在 `B/A` → 探针误判 → 真实改名被拒绝跟随。
    // 且该形态**不提供新能力**：劫持既有规范目录纯提名即可（不需要 mv，= F227 已知限界一，用户已接受）；
    // 打开 fail-open 用真实 `git mv SRC <不存在的非规范名>` 即可（= SC-005，F224 设计意图，须保住）。
    // 故不作探测，维持纯状态机语义。详见 specs/231-.../fix-report.md「第 12 轮」。
    trackedDir = stripTrailingSlash(operands[1]);
    syncCandidateFromTrackedDir();
  };

  for (const entry of list) {
    if (!entry || entry.role !== 'assistant' || entry.lineIndex <= anchor) continue;
    for (const block of entry.toolUseBlocks) {
      const input = block.input || {};
      if ((block.name === 'Write' || block.name === 'Edit') && typeof input.file_path === 'string') {
        scanArtifactPath(input.file_path);
      } else if (block.name === 'Bash' && typeof input.command === 'string') {
        // 写入提名逐段判定并按段顺序推进 candidate（不提前 return），保持「取最后出现者」语义；
        // 分段是 F225「写指示符与 artifact 路径须同段共现」判据的载体。
        // 改名事件在**整条命令**上扫出（需要完整的引号 / 转义 / 注释 / 重定向上下文），
        // 再按字符偏移归回所属段落——这样既有全命令词法上下文，又保持「段内先提名、再改名」的时序。
        const renameEvents = scanRenameCommandEvents(input.command);
        let eventCursor = 0;
        for (const span of splitCommandTextSegmentSpans(input.command)) {
          if (hasBashWriteIndicator(span.text)) scanArtifactPath(span.text);
          // 单指针归并：spans 与 renameEvents 均按偏移升序，避免每段重扫全部事件的二次方开销
          while (eventCursor < renameEvents.length && renameEvents[eventCursor].offset < span.end) {
            applyRenameEvent(renameEvents[eventCursor].paramText);
            eventCursor += 1;
          }
        }
      }
    }
  }
  return { path: candidate, ambiguous, candidates: Array.from(candidateHistory.keys()) };
}

// F216 C4 · fence-aware 标题/锚点识别原语 computeFenceMask 已下沉到
// fix-compliance-execution-record.mjs，本层 import back 供章节判据函数复用。

// ────────────────────────────────────────
// 制品章节判据（D6 / FR-012a）
// ────────────────────────────────────────

/**
 * 抽取 requiredHeading 命中处到下一个二级标题（或文件尾）之间的正文（F216 C1：终止符还原为 H1/H2 全局语义）。
 * heading 未命中 → 返回空字符串。fenced code 区内的行不参与 heading 定位/终止（F216 C4）。
 * 说明：合法 repair 报告常把证据放在 `### 直接原因` 等 H3 子节下，若以 H3 为终止符会把正文截空
 * 造成 placeholderResidue 误报——故终止符仅认 H1/H2；`### 复现对账` 子块的花括号误判改由
 * checkArtifactSection 定向剔除（stripReconSubblock），不牵动通用章节提取语义。
 */
function extractSectionBody(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const lines = text.split('\n');
  const fenceMask = computeFenceMask(lines);
  const probe = toSingleMatchProbe(requiredHeading);
  // 定位命中 heading 的行（跳过 fenced code 区）
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenceMask[i]) continue;
    // 逐行匹配 requiredHeading（对 /m 锚定的 `## 判定依据` 与内联 `Root Cause` 均适用）
    if (probe.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return '';
  // 正文起点包含"匹配行锚点之后的剩余文本"——修复形态 `**Root Cause**: <text>` 的证据与锚点同行，
  // no-op 形态 `## 判定依据` 的证据在后续行（同行剩余为空），二者统一处理。
  const headMatch = toSingleMatchProbe(requiredHeading).exec(lines[startLine]);
  const remainder = headMatch ? lines[startLine].slice(headMatch.index + headMatch[0].length) : lines[startLine];
  const body = [remainder];
  for (let i = startLine + 1; i < lines.length; i += 1) {
    // 下一个一/二级标题终止（H3 子节如 `### 直接原因` / `### 复现对账` 仍算章节正文的一部分，
    // 避免 H3 子节把 repair 证据截空造成 placeholderResidue 误报——F216 C1）；fenced code 区内的 `## ` 不算标题
    if (!fenceMask[i] && /^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * 从章节正文中剔除 `### 复现对账` 子块（F216 C1 定向剔除）。
 * 复现对账走 parseNoopReconLines/classifyReproEvidence 机械 JSON 判据，其单行 JSON 花括号
 * MUST 不参与判定依据散文的占位符扫描——先摘除该子块（标题行 + 其下至下一个 H1/H2/H3 的行），
 * 再评估散文实质性与花括号残留。仅剔除复现对账，`### 直接原因` 等其他 H3 子节保留。
 *
 * F228 R3-3：改用 `computeFenceRegions` 并对 `unclosedFrom` 之后的行强制视为未 fenced——
 * 与 `stripCodeRegions` 统一围栏语义。此前直接消费 `computeFenceMask` 时，若子块内出现
 * 未闭合围栏，该围栏会被当成"直到 EOF 都在代码区内"，导致子块下方任何本该终止子块的
 * H1/H2/H3 标题都被误判为"仍在 fenced 区、不算标题"，子块永不终止，把后续所有正文
 * （含标题与模板占位符）一并当作子块内容剔除——两姊妹函数各持一套围栏语义正是本次修复
 * 要消灭的根因模式，故收口为同一套。
 * @param {string} body
 * @returns {string}
 */
function stripReconSubblock(body) {
  const lines = String(body).split('\n');
  const { mask: rawFenceMask, unclosedFrom } = computeFenceRegions(lines);
  const fenceMask = rawFenceMask.map((v, i) => (unclosedFrom !== -1 && i >= unclosedFrom ? false : v));
  const out = [];
  let inRecon = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!fenceMask[i] && NOOP_RECON_HEADING_REGEX.test(lines[i])) { inRecon = true; continue; }
    if (inRecon) {
      // 子块在遇到下一个一/二/三级标题时结束（该标题行本身保留）
      if (!fenceMask[i] && /^#{1,3}\s/.test(lines[i])) { inRecon = false; out.push(lines[i]); continue; }
      continue; // 子块内行剔除
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * 单行「反引号 run 长度精确配对」扫描剥离（F228 Q2 算法，不导出，仅供 stripCodeRegions 使用）。
 *
 * 规则：从左到右扫描一行，遇到反引号即读出连续反引号 run 的长度 N；从该 run 结束处继续向右找
 * **长度恰好等于 N** 的下一个反引号 run（长度不符的 run 整体跳过、不消费、也不作为新的候选起点）；
 * 找到即判定为一对 code span 定界符，把「起始 run + 中间内容 + 结束 run」整体替换为**单个空格**
 * （不是删空，避免两侧文本被拼接出假匹配）；找不到则判定为未闭合，反引号字符原样保留，
 * 从该 run 结束处继续扫描下一段。
 *
 * 逐行独立扫描（不跨行缓冲）——与本文件既有 fence-aware 判据（extractSectionBody /
 * stripReconSubblock / classifyClosureForm）保持同一处理模型，架构一致。
 * 显式 non-goal（见 plan.md Q3）：不处理跨行 code span（反引号跨两行不闭合时，
 * 每一行各自独立判定，互不感知）。
 *
 * F228 R3-2：`\` 是 Markdown 转义反斜杠，`\\`` 使紧随的反引号变为字面量、根本不是 code span
 * 定界符——旧实现把它当定界符用，会误把该反引号包裹的散文当成"代码区"剥离掉（codex 第二轮
 * CRITICAL：转义反引号包一层模板占位符即可让占位符从扫描中消失）。判定规则：向左数该 run 起点
 * 前连续的反斜杠个数，奇数即该 run 被转义（`\\\\` 是转义反斜杠自身，其后的反引号仍是定界符，
 * 偶数个反斜杠不构成转义）。转义 run 按 run 级整体处理（不拆到单字符）——与本文件其余
 * fence-aware 判据一致的简化取舍，足以覆盖单反引号转义的常见形态，不引入跨行/字符级复杂度。
 * @param {string} line - 单行文本（调用方保证不含换行符）
 * @returns {string}
 */
function stripInlineCodeSpans(line) {
  const text = String(line);
  const runRegex = /`+/g;
  const runs = [];
  let match;
  while ((match = runRegex.exec(text)) !== null) {
    let backslashCount = 0;
    let k = match.index - 1;
    while (k >= 0 && text[k] === '\\') { backslashCount += 1; k -= 1; }
    runs.push({
      start: match.index,
      end: match.index + match[0].length,
      length: match[0].length,
      escaped: backslashCount % 2 === 1,
    });
  }
  if (runs.length === 0) return text;

  let result = '';
  let cursor = 0;
  let i = 0;
  while (i < runs.length) {
    const openRun = runs[i];
    if (openRun.escaped) {
      // 转义 run 不作为候选起点：原样保留在输出中（cursor 不推进，交由后续非转义 run 或
      // 循环结束时的尾部拼接统一带出），不参与开/闭配对
      i += 1;
      continue;
    }
    result += text.slice(cursor, openRun.start);
    // 向右找长度恰好等于 openRun.length 的下一个**非转义** run；长度不符或已转义的 run 整体跳过、不消费
    let closeIdx = -1;
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[j].escaped) continue;
      if (runs[j].length === openRun.length) { closeIdx = j; break; }
    }
    if (closeIdx === -1) {
      // 未闭合：反引号原样保留，从该 run 结束处继续扫描
      result += text.slice(openRun.start, openRun.end);
      cursor = openRun.end;
      i += 1;
      continue;
    }
    // 配对成功：起始 run + 中间内容 + 结束 run 整体替换为单个空格
    result += ' ';
    cursor = runs[closeIdx].end;
    i = closeIdx + 1;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * 从文本中剥离代码区（F228 语义收口：代码区不参与散文占位符扫描）——fenced code 块与行内
 * code span 均不再参与 `checkArtifactSection` 的花括号占位符判据。
 *
 * 语义边界（显式 non-goal，见 plan.md Q3，勿在此基础上扩展）：
 * - **闭合**的 fenced 代码块（``` / ~~~）整体清空（含开/闭围栏行本身），复用 `computeFenceRegions`
 *   （与 F216 C4 标题/锚点识别同一套 fence 语义，避免两套"什么算围栏"各自为政）
 * - 未闭合的围栏（开围栏行直到 EOF 都没有匹配闭合）不剥离——F228 R2-2 CRITICAL-2 修复：
 *   未闭合围栏在真实 markdown 渲染中不构成有效代码块，若仍整段清空，会把开围栏行之后**全部**
 *   正文（含后续 H2 标题与其下的模板占位符）一并吞掉，制造可主动触发的门禁绕过
 * - 非 fenced 行按 `stripInlineCodeSpans` 逐行剥离行内 code span，未闭合反引号原样保留
 * - **不处理**缩进代码块（4 空格）——`computeFenceMask` 本身也不识别缩进代码块，为其单独加
 *   特殊分支会制造"fence 识别"与"code-region 剥离"两套语义不一致，正是本次修复要消灭的根因模式
 * - **不处理**跨行 code span——逐行独立扫描，反引号跨行不闭合时各行互不感知
 * @param {string} text - 待剥离文本（通常是 `checkArtifactSection` 抽出的章节正文）
 * @returns {string}
 */
export function stripCodeRegions(text) {
  const value = typeof text === 'string' ? text : '';
  const lines = value.split('\n');
  const { mask: fenceMask, unclosedFrom } = computeFenceRegions(lines);
  const out = lines.map((line, i) => {
    // 未闭合围栏起点之后的行一律不剥离（原样保留，含开围栏行本身），使其中的花括号
    // 继续参与占位符扫描（F228 R2-2 CRITICAL-2）
    if (unclosedFrom !== -1 && i >= unclosedFrom) return line;
    return fenceMask[i] ? '' : stripInlineCodeSpans(line);
  });
  return out.join('\n');
}

/**
 * 机械校验制品章节（FR-012a）。
 *
 * F228 语义收口：长度判据与占位符判据的输入来源**不同**——长度判据（`bodyChars`）继续吃
 * `stripReconSubblock(body)`（即 `proseBody`）原文，逐字不变；占位符判据改吃「再剥离代码区」
 * 之后的 `placeholderScanText`（见 `stripCodeRegions`）。这一分离是刻意的：若长度判据也改用
 * 剥离后的文本，"散文简短但有实质 fenced code 证据"的合规章节会被误判为占位空壳，等于按下
 * 葫芦浮起瓢（详见 plan.md「为何长度判据必须留在未剥代码的文本上」）。
 *
 * F228 R2-2：占位符判据本身细分两段 OR——canonical 中文模板占位符（`CANONICAL_PLACEHOLDER_REGEX`）
 * 直接在剥离前的 `proseBody` 上扫描、代码区不豁免（堵 CRITICAL-1：模板占位符包一层反引号
 * 就能同时"贡献长度"又"从占位扫描中消失"的绕过）；通用花括号（`PLACEHOLDER_OPEN_BRACE_REGEX`）
 * 仍在剥离后的 `placeholderScanText` 上扫描、代码区豁免（保留"作者引用真实代码字面量"的既有合规行为）。
 *
 * F229：两条花括号判据均不再要求闭合——通用判据退化为"存在裸 `{`"，canonical 判据的闭合边界放宽为
 * "`}` 或**行尾**"（两个 alternation 分支：成对形态与不成对形态，后者锚定在同一行内、不跨行匹配，
 * 详见 `CANONICAL_PLACEHOLDER_REGEX` 上方注释）。占位符的语义标志是"存在未替换的模板起始标记"，
 * 与闭合无关；旧判据的闭合要求是
 * 从 canonical 模板正例形态反推出的多余约束，构成删一个 `}` 即可通过的门禁绕过。
 *
 * F228 R3-1：代码区豁免新增第 4 段边界判据——原文有花括号、但剥离代码区后实质散文不足阈值，
 * 说明这些花括号只是被代码区包着"充数"，整段正文实质就是包在代码里的占位符（而非"作者在实质
 * 散文之外另行引用代码"），此时豁免不成立，仍判占位空壳。这堵住 codex 第二轮对抗审查发现的三个
 * 绕过变体：中文占位符里塞 ASCII 冒号躲开 canonical 判据、纯 ASCII 模板字段（本就不含中文）、
 * 转义反引号（`\\\`` 在 Markdown 里不是 code span 定界符，见 stripInlineCodeSpans 的 R3-2 修复）
 * ——三者共同点都是"整段正文被代码区形态包裹、剥完之后所剩无几"，与"作者在长散文之外顺带引用
 * 一段代码"的合法形态在"剥离后剩余散文量"这一维度上截然不同，故用 strippedChars 作判别锚点。
 * @param {string} content - 制品文件内容
 * @param {RegExp} requiredHeading - 必填章节锚点正则
 * @returns {{ nonEmpty:boolean, hasRequiredSection:boolean, placeholderResidue:boolean }}
 */
export function checkArtifactSection(content, requiredHeading) {
  const text = typeof content === 'string' ? content : '';
  const nonEmpty = text.replace(/\s/g, '').length > 0;
  const headingProbe = toSingleMatchProbe(requiredHeading);
  const hasRequiredSection = headingProbe.test(text);
  if (!hasRequiredSection) {
    return { nonEmpty, hasRequiredSection: false, placeholderResidue: false };
  }
  const body = extractSectionBody(text, requiredHeading);
  // F216 C1：复现对账子块的单行 JSON 花括号不参与散文占位符扫描——先定向剔除该子块再评估
  const proseBody = stripReconSubblock(body);
  // 长度判据：输入逐字不变（仍是 proseBody），MIN_SECTION_BODY_CHARS 不被放宽
  const bodyChars = proseBody.replace(/\s/g, '').length;
  // 占位符判据：额外剥离代码区（fenced code + 行内 code span）后再扫花括号（F228）
  const placeholderScanText = stripCodeRegions(proseBody);
  const strippedChars = placeholderScanText.replace(/\s/g, '').length;
  // 占位空壳 = 散文正文过短（≤20 非空白字符），或 canonical 中文模板占位符残留（代码区不豁免，F228 R2-2），
  // 或残留未替换的通用花括号占位符（代码区豁免），或原文有花括号但剥离代码区后散文不足阈值（F228 R3-1：
  // 代码区豁免的边界——豁免只服务于"作者在实质散文之外引用代码"，不服务于"整段正文就是包在代码里的占位符"）
  const placeholderResidue = bodyChars <= MIN_SECTION_BODY_CHARS
    || CANONICAL_PLACEHOLDER_REGEX.test(proseBody)
    || PLACEHOLDER_OPEN_BRACE_REGEX.test(placeholderScanText)
    // 第 4 段：F229 后随 PLACEHOLDER_OPEN_BRACE_REGEX 的收口自动收紧（"原文含花括号"的判定由
    // "必须闭合"放宽为"存在裸 `{`"），判据结构本身无需任何额外分支——语义仍是"整段正文被代码区
    // 形态包裹、剥完所剩无几"，strippedChars 阈值门槛逐字不变。
    || (PLACEHOLDER_OPEN_BRACE_REGEX.test(proseBody) && strippedChars <= MIN_SECTION_BODY_CHARS);
  return { nonEmpty, hasRequiredSection: true, placeholderResidue };
}

/**
 * 按内容特征区分收口形态（no-op-report-template.md：两锚点集刻意互斥）。
 * 双锚点同时命中 → 按修复收口判据（取严，codex implement 审查 W-1）：若报告既声称
 * Root Cause 又带"## 判定依据"，不允许借 no-op 的更低门槛绕过 verification-report
 * 与 implement/verify 双角色要求。
 * F216 AD-4：返回正交结构 `{closureForm, hasRepairAnchor, hasNoopAnchor}`——双锚点时
 * closureForm 取严为 'repair'，但 hasNoopAnchor 仍保留 true，使 no-op 复现证据门与 repair
 * 合同并行判定（FR-018 可达），不再因塌缩为字符串 'repair' 而丢失 noop 锚点信息。
 * @param {string|null} fixReportContent
 * @returns {{ closureForm:'repair'|'no-op'|'undetermined', hasRepairAnchor:boolean, hasNoopAnchor:boolean }}
 */
export function classifyClosureForm(fixReportContent) {
  const text = typeof fixReportContent === 'string' ? fixReportContent : '';
  // F216 C4：fenced code 区内的 `## 判定依据` / `Root Cause` 是示例文本，不算真实锚点——
  // 逐行识别并跳过 fenced 行，防止合规 repair 报告的附录代码块被误判触发 no-op 证据门（FR-007）。
  const lines = text.split('\n');
  const fenceMask = computeFenceMask(lines);
  const noopProbe = toSingleMatchProbe(NOOP_JUDGMENT_HEADING_REGEX);
  const repairProbe = toSingleMatchProbe(ROOT_CAUSE_HEADING_REGEX);
  let hasNoopAnchor = false;
  let hasRepairAnchor = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenceMask[i]) continue;
    if (!hasNoopAnchor && noopProbe.test(lines[i])) hasNoopAnchor = true;
    if (!hasRepairAnchor && repairProbe.test(lines[i])) hasRepairAnchor = true;
  }
  let closureForm;
  if (hasNoopAnchor && hasRepairAnchor) closureForm = 'repair';
  else if (hasNoopAnchor) closureForm = 'no-op';
  else if (hasRepairAnchor) closureForm = 'repair';
  else closureForm = 'undetermined';
  return { closureForm, hasRepairAnchor, hasNoopAnchor };
}

// F216 · no-op 复现对账解析（NOOP_RECON_HEADING_REGEX / normalizeCommandConservative /
// parseNoopReconLines）与受控断言判定 + 执行证据配对（SENTINEL_PASS/FAIL /
// EXECUTION_OUTPUT_SUMMARY_LIMIT / deriveAssertionStatus / extractExecutionRecordsAfter /
// classifyReproEvidence）已下沉到 fix-compliance-execution-record.mjs。
// 其中仅 NOOP_RECON_HEADING_REGEX / parseNoopReconLines / classifyReproEvidence 被本层
// import back（供 stripReconSubblock / judgeCompliance 复用）；其余符号无本地绑定，
// 仅经文件尾部 re-export 转发保持既有 import 面。

// ────────────────────────────────────────
// 合规最终判定（FR-002 三支）
// ────────────────────────────────────────

/**
 * 综合判定 fix 会话合规状态（data-model.md §7 ComplianceVerdict）。
 * 全部输入已由 io/judge 层解析：transcript 侧 delegations、磁盘侧 featureDir/artifacts、配置侧 enforcement。
 * @param {{
 *   delegations: {roleClass:string, subagentType:string|null, description:string|null, noopVerify?:boolean}[],
 *   featureDir: { path:string|null, existsOnDisk:boolean },
 *   fixReport: { exists:boolean, content:string|null },
 *   verificationReport: { exists:boolean, nonEmpty:boolean },
 *   enforcement: string, configDegraded: boolean, diagnostics: string[],
 * }} input
 * @returns {{ closureForm:string, compliant:boolean, missing:string[], delegationCounts:object, enforcement:string, configDegraded:boolean, diagnostics:string[] }}
 */
export function judgeCompliance(input) {
  const {
    delegations = [], featureDir = { path: null, existsOnDisk: false },
    fixReport = { exists: false, content: null }, verificationReport = { exists: false, nonEmpty: false },
    executionRecords = [], closure: providedClosure,
    enforcement = 'block', configDegraded = false, diagnostics = [],
  } = input || {};

  const counts = { implement: 0, verify: 0, other: 0 };
  let noopVerifyCount = 0;
  for (const d of delegations) {
    const cls = d && d.roleClass;
    if (cls === 'implement' || cls === 'verify' || cls === 'other') counts[cls] += 1;
    // noopVerify 优先用抽取时携带的标记；缺省时按角色回退（verify 类天然属核实语义）
    if (d && (d.noopVerify === true || (d.noopVerify === undefined && cls === 'verify'))) noopVerifyCount += 1;
  }

  // F216 AD-4：正交返回，closureForm 路由基础判据、hasNoopAnchor 独立触发复现证据门。
  // 若 caller（judge 编排层）已分类则透传复用，避免重复分类（plan I8）；否则本层自算（向后兼容）。
  const closure = (providedClosure && typeof providedClosure === 'object')
    ? providedClosure
    : (fixReport.exists
      ? classifyClosureForm(fixReport.content)
      : { closureForm: 'undetermined', hasRepairAnchor: false, hasNoopAnchor: false });
  const closureForm = closure.closureForm;
  const missing = [];

  // 特性目录：候选存在且磁盘核验通过才算就绪
  const featureDirOk = Boolean(featureDir && featureDir.path && featureDir.existsOnDisk);
  if (!featureDirOk) missing.push('feature-dir');

  if (closureForm === 'no-op') {
    const section = checkArtifactSection(fixReport.content, NOOP_JUDGMENT_HEADING_REGEX);
    if (!section.hasRequiredSection) {
      missing.push('noop:judgment-section');
    } else if (section.placeholderResidue) {
      missing.push('artifact:placeholder');
    }
    if (noopVerifyCount < 1) missing.push('delegation:noop-verify');
  } else if (closureForm === 'repair') {
    const section = checkArtifactSection(fixReport.content, ROOT_CAUSE_HEADING_REGEX);
    if (!section.hasRequiredSection) {
      missing.push('fix-report.md');
    } else if (section.placeholderResidue) {
      missing.push('artifact:placeholder');
    }
    if (!(verificationReport && verificationReport.exists && verificationReport.nonEmpty)) {
      missing.push('verification-report.md');
    }
    if (counts.implement < 1) missing.push('delegation:implement');
    if (counts.verify < 1) missing.push('delegation:verify');
  } else {
    // undetermined：既非有效修复报告也非 no-op 报告（含 F206 坍塌：连制品都没有）
    missing.push('fix-report.md');
  }

  // F216 no-op 复现证据门（与 closureForm 路由正交，AD-4）：hasNoopAnchor===true 即追加校验。
  // 双锚点（closureForm='repair' 但 hasNoopAnchor=true）时 repair 合同与 repro 合同并集 missing，
  // 使 FR-018"须同时满足两合同"可达；纯 repair（hasNoopAnchor=false）零介入（FR-007）。
  if (closure.hasNoopAnchor && fixReport.exists) {
    const reproMissing = classifyReproEvidence(
      parseNoopReconLines(fixReport.content),
      executionRecords,
    );
    for (const key of reproMissing) {
      if (!missing.includes(key)) missing.push(key);
    }
  }

  return {
    closureForm,
    compliant: missing.length === 0,
    missing,
    delegationCounts: counts,
    enforcement,
    configDegraded,
    diagnostics: Array.isArray(diagnostics) ? [...diagnostics] : [],
  };
}

// ────────────────────────────────────────
// 配置强制程度解析（FR-015 三步顺序）
// ────────────────────────────────────────

/**
 * 从（io 层读取的）配置状态解析生效 enforcement（fix-compliance-config-field.md 三步序）。
 * 纯函数：io 负责查找文件与捕获解析异常，本函数只做取值→归约。
 * @param {{ found:boolean, parseFailed:boolean, config:object|null }} input
 * @returns {{ enforcement:string, configDegraded:boolean }}
 */
export function resolveEnforcementFromConfig(input) {
  const { found = false, parseFailed = false, config = null } = input || {};
  // 步 1：无配置文件 → 默认 block，非降级
  if (!found) return { enforcement: 'block', configDegraded: false };
  // 步 2a：文件存在但解析失败 → block + 降级
  if (parseFailed) return { enforcement: 'block', configDegraded: true };
  const value = config && config.fix_compliance && config.fix_compliance.enforcement;
  // 缺 fix_compliance 字段 → 默认 block，非降级（缺字段=默认，不视作损坏）
  if (value === undefined || value === null) return { enforcement: 'block', configDegraded: false };
  // 步 3：合法取值直接采用；步 2b：非法取值 → block + 降级
  if (ENFORCEMENT_VALUES.has(value)) return { enforcement: value, configDegraded: false };
  return { enforcement: 'block', configDegraded: true };
}

// ────────────────────────────────────────
// F218 拆分 · re-export 转发（保 judge.mjs / io.mjs / 测试的既有 import 面）
// ────────────────────────────────────────
// F216 证据门纯函数与共享解析原语的定义体在 fix-compliance-execution-record.mjs；
// 消费者仍从本模块 import，导出面与拆分前完全一致（toSingleMatchProbe 为新符号，不在此列）。
export {
  flattenToolResultContent, deriveAssertionStatus, extractExecutionRecordsAfter,
  normalizeCommandConservative, parseNoopReconLines, classifyReproEvidence,
  SENTINEL_PASS, SENTINEL_FAIL, EXECUTION_OUTPUT_SUMMARY_LIMIT,
  NOOP_RECON_HEADING_REGEX, computeFenceMask, computeFenceRegions, NOOP_JUDGMENT_HEADING_REGEX,
} from './fix-compliance-execution-record.mjs';
