// Feature 241（M9 轨道 B4）— tasks.md 目标路径信号（D3 `pre-implement advisory` 轮 1 信号源）。
//
// 回答 D3 里那个鸡生蛋问题：goal_loop 的注入时点在该轮 implement **之前**，第一轮根本不存在
// "本轮 diff"，git 侧只能给 `unknown`。D3 定的替代信号是「tasks.md 已声明目标文件路径的**存在性**」
// ——`fs.existsSync` 是纯文件系统事实，与 F204 记录的「对抗性自我误标」风险无关，不是 agent 自报。
//
// 三条硬约束：
// - **纯函数、零 I/O**：`fsExists` 依赖注入而非 import `node:fs`。单测靠静态断言守这条。
// - **只服务 advisory 合同**：权威判定（`pre-verify authoritative`）只认 git diff。这条边界由调用方
//   （`graph-consumption-cli.mjs`）强制，本模块无从知道自己被谁调用，故在此显式声明契约。
// - **判不出就说不知道**：抽不到路径返回空数组、分类返回 `unknown`。`unknown` 在 FR-003 矩阵里落
//   降级消费（行 7）是安全方向；猜成 `additive-only` 会直接跳过 impact，猜错的代价不对称。

/** 任务行判据：必须同时有 checkbox 与 `T<数字>` 编号。 */
const TASK_LINE = /^\s*[-*]\s*\[[ xX]\]\s*T\d+\b/;

/**
 * token 分隔符。
 *
 * 刻意**不含** `:`——`tests/a.test.ts:16,109` 这类编辑器风格后缀要先整体成 token 再剥，
 * 按 `:` 切会把它切成两半后各自判不出路径。`,` 在分隔符里，所以 `,109` 不会粘进来。
 */
const TOKEN_SPLIT = /[\s"'`（）()[\]{}<>《》，、；;,|]+/;

/**
 * 路径形状判据：至少一个基名字符 + 一个以**字母开头**的扩展名。
 *
 * 扩展名必须以字母开头，是为了挡掉章节号与版本号（`§1.7`、`v1.2.3`、`plan §1.1/§1.2`）——
 * 它们在真实 tasks.md 里随处可见，按"有点就是路径"抽会把整份清单污染成噪声。
 * 点号前一位不能是 `/`，因此 `.ts/.tsx` 这种扩展名枚举也不会被当成路径。
 */
const PATH_SHAPE = /^[^\s]*[^\s/]\.[A-Za-z][A-Za-z0-9_]{0,9}$/;

/**
 * 绝对路径判据（POSIX 前导 `/` 与 Windows 盘符两种形态）。
 *
 * 本信号的合同是"仓内相对路径"。绝对路径拿去做存在性探测等于把判据交给仓外文件系统：
 * `/etc/passwd.txt` 之类只要恰好存在，就能把 advisory 结论反向掰成 `modifies-existing`。
 */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/;

/** 父目录跳出段：`..` 单独成段时，resolve 后可越出 projectRoot。 */
const PARENT_TRAVERSAL = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/** 句末标点、markdown 强调符、成对符号的右半——都可能粘在路径尾巴上。 */
const TRAILING_NOISE = /[。，、；：.,;:!?！？)\]}>*_~-]+$/;

/** 编辑器风格的 `:行` / `:行:列` 后缀。 */
const LINE_COLUMN_SUFFIX = /:\d+(?::\d+)?$/;

/**
 * 把一个 token 归一为仓内相对路径，判不出则返回 null。
 *
 * @param {string} rawToken
 * @returns {string | null}
 */
function normalizeCandidate(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  // URL 不是仓内路径。放在最前面，避免 `https://x/a.md` 被当成 `a.md` 的宿主
  if (rawToken.includes('://')) return null;
  // 命令行开关（`--refresh-policy` 等）不是路径
  if (rawToken.startsWith('-')) return null;

  // symbol id 形态：仓内两种分隔符（F214 统一为 `::`，历史文档仍有 `#`）都归一到文件路径
  let token = rawToken.split('::')[0].split('#')[0];
  token = token.replace(LINE_COLUMN_SUFFIX, '');
  token = token.replace(TRAILING_NOISE, '');

  if (!PATH_SHAPE.test(token)) return null;

  // B1-W2 三条收紧：本信号只认**仓内相对路径**，其余一律判"不是路径"而非"路径但不存在"。
  //
  // - 必须含 `/`：`Node.js`、`spectra.batch`、`README.md` 这类裸词满足"基名 + 字母扩展名"，
  //   但它们几乎必然探测不到 → 把 advisory 轮 1 一路推向 `additive-only` → 跳过 impact。
  //   代价不对称：漏收一个根目录文件只是退回 `unknown`（安全方向），误收一批噪声却会翻转结论。
  // - 拒绝绝对路径 / Windows 盘符：探测目标必须落在 projectRoot 之内。
  // - 拒绝含 `..` 段：resolve 后可越出 projectRoot，与绝对路径同一风险。
  if (!token.includes('/')) return null;
  if (ABSOLUTE_PATH.test(token)) return null;
  if (PARENT_TRAVERSAL.test(token)) return null;

  return token;
}

/**
 * 从 tasks.md 全文里抽出任务行声明的目标文件路径。
 *
 * 只看任务行（`- [ ] T001 ...` / `- [x] T001 ...`）：表格行、说明段落、普通列表里同样会出现
 * 反引号路径（RG 表、crosswalk、决策依据），把它们一并收进来会让信号被文档噪声淹没。
 *
 * 反引号在抽取前被当成空白：行内代码只是包裹语法，不承载分隔语义，裸路径与包裹路径走同一条
 * tokenize 路径可以少一套分支。
 *
 * @param {string} tasksMarkdownText
 * @returns {string[]} 去重后按首次出现顺序排列；解析不出返回 `[]`
 */
export function extractTaskPaths(tasksMarkdownText) {
  if (typeof tasksMarkdownText !== 'string' || tasksMarkdownText.length === 0) return [];

  const seen = new Set();
  const paths = [];

  for (const line of tasksMarkdownText.split('\n')) {
    if (!TASK_LINE.test(line)) continue;
    for (const rawToken of line.split(TOKEN_SPLIT)) {
      const candidate = normalizeCandidate(rawToken);
      if (candidate === null || seen.has(candidate)) continue;
      seen.add(candidate);
      paths.push(candidate);
    }
  }

  return paths;
}

/**
 * 由「目标路径存在性」推出 advisory 轮 1 的变更类别。
 *
 * `fsExists` 走注入而非直接读盘：这让本模块保持纯函数，也让调用方能自己决定相对哪个根解析路径
 * （CLI 侧相对 `--project-root`）。
 *
 * 任一路径已存在即 `modifies-existing`（短路，不再继续探测）：只要碰了一个既有文件，
 * 本轮就不是纯新增，impact 就有意义。
 *
 * 三处都收敛到 `unknown` 而非猜测：清单为空、未注入探测器、探测器抛错。它们的共同点是
 * **信号本身不可得**，把不可知当成 `additive-only` 会静默跳过影响面分析。
 *
 * @param {string[]} paths `extractTaskPaths` 的输出
 * @param {(filePath: string) => boolean} fsExists 存在性探测器（注入）
 * @returns {'modifies-existing'|'additive-only'|'unknown'}
 */
export function classifyFromTaskPaths(paths, fsExists) {
  if (!Array.isArray(paths) || paths.length === 0) return 'unknown';
  if (typeof fsExists !== 'function') return 'unknown';

  for (const filePath of paths) {
    let exists;
    try {
      exists = fsExists(filePath);
    } catch {
      // 探测器失败属工具面问题，不是"文件不存在"的证据
      return 'unknown';
    }
    if (exists === true) return 'modifies-existing';
  }

  return 'additive-only';
}
