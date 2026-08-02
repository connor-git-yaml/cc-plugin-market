// Feature 241（M9 轨道 B4）— 变更类别机械判定（FR-005 / D3）。
//
// 为什么不接受 agent 自报：F204 记录过 `validateFullCommandKinds` 的边界——「能挡遗漏，挡不住
// 对抗性自我误标」。`changeClass` 直接决定"要不要消费 impact"，让被评估方自己申报等于把判据
// 交给它优化。这里改成读 git 的机械事实。
//
// **输入格式锁定为 NUL 分隔**（`-z`），不接受人读形态。理由是一个真实存在的歧义交点：
// 无 `-z` 时重命名写作 `old -> new`，而 ` -> ` 是合法文件名子串，按它切分迟早切出错误清单；
// 无 `-z` 时含空格/引号/非 ASCII 的路径还会被加引号并转义，需要一层反转义才能还原。
// `-z` 一次性消掉这四类歧义。
//
// 解析范式与 `goal-loop-core.mjs::parsePreservedConfigStates` 同构（porcelain 前两字符是 XY 状态列、
// 第三字符是空格、其后是路径），但**不 import 它**：那个函数处理的是无 `-z` 的带引号形态且绑定了
// preserved-path 语义，两边的输入契约不同，共用会把各自的约束混进对方。

/** name-status 里"改动了既有文件"的状态码；`R`/`C` 带相似度分数后缀。 */
const MODIFYING_NAME_STATUS = new Set(['M', 'R', 'C', 'D']);
/** name-status 里"纯新增"的状态码。 */
const ADDITIVE_NAME_STATUS = new Set(['A']);
/** name-status 里占三段（status + old + new）的状态码。 */
const TWO_PATH_NAME_STATUS = new Set(['R', 'C']);

/** porcelain XY 列里"改动了既有文件"的字符。 */
const MODIFYING_PORCELAIN = new Set(['M', 'R', 'C', 'D']);
/** porcelain XY 列里"纯新增"的字符（`?` 属于 `??` 未跟踪）。 */
const ADDITIVE_PORCELAIN = new Set(['A', '?']);

/** 把 `-z` 文本切成字段（末尾 NUL 会产生一个空尾项，丢弃）。 */
function splitNulFields(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const fields = text.split('\0');
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  return fields;
}

/**
 * 解析 `git diff --name-status -z <base-ref>..`。
 *
 * 记录形态：`<status>\0<path>\0`；重命名/复制为 `<status><score>\0<old>\0<new>\0`（三段）。
 *
 * @returns {{ ok: boolean, entries: { code: string, paths: string[] }[] }}
 */
function parseNameStatus(text) {
  const fields = splitNulFields(text);
  const entries = [];
  let index = 0;

  while (index < fields.length) {
    const raw = fields[index];
    // 空字段出现在状态位说明输入被截断或本就不是 -z 形态——不猜测
    if (raw.length === 0) return { ok: false, entries };

    const code = raw[0];
    const pathCount = TWO_PATH_NAME_STATUS.has(code) ? 2 : 1;

    const paths = fields.slice(index + 1, index + 1 + pathCount);
    // 段数不足 = 记录被截断；空路径段 = 输入根本不是 -z 形态。两者都不猜测。
    if (paths.length !== pathCount || paths.some((filePath) => filePath.length === 0)) {
      return { ok: false, entries };
    }

    entries.push({ code, paths });
    index += 1 + pathCount;
  }

  return { ok: true, entries };
}

/**
 * 解析 `git status --porcelain -z`。
 *
 * 记录形态：`XY <path>\0`；重命名/复制为 `XY <new>\0<old>\0`
 * ——**新旧顺序与 name-status 相反**，这是 git 的既定契约，不是笔误。
 *
 * @returns {{ ok: boolean, entries: { x: string, y: string, paths: string[] }[] }}
 */
function parsePorcelain(text) {
  const fields = splitNulFields(text);
  const entries = [];
  let index = 0;

  while (index < fields.length) {
    const field = fields[index];
    // `XY ` 三字符前缀 + 至少一个字符的路径
    if (field.length < 4 || field[2] !== ' ') return { ok: false, entries };

    const x = field[0];
    const y = field[1];
    const first = field.slice(3);
    const paths = [first];

    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const second = fields[index + 1];
      if (second === undefined || second.length === 0) return { ok: false, entries };
      paths.push(second);
      index += 1;
    }

    entries.push({ x, y, paths });
    index += 1;
  }

  return { ok: true, entries };
}

/**
 * 把 git 的两路输出解析为 `changeClass` + 变更文件清单。
 *
 * 判定规则（FR-005）：
 * - 任一状态码为 `M` / `R` / `C` / `D` → `modifies-existing`
 * - 全部为 `A` / `??` → `additive-only`
 * - 输入为空、不可解析、或含未识别状态码（如 `T` 类型变更、`U` 未合并）→ `unknown`
 *
 * 未识别状态码走 `unknown` 而非"猜一个"：`unknown` 在 FR-003 矩阵里落降级消费（行 7），
 * 是安全方向；猜成 `additive-only` 会直接跳过 impact，猜错的代价不对称。
 *
 * @param {{ nameStatusText?: string, porcelainText?: string }} input
 * @returns {{ changeClass: 'modifies-existing'|'additive-only'|'unknown', files: string[] }}
 */
export function classifyChangeSet(input) {
  const nameStatusText = typeof input?.nameStatusText === 'string' ? input.nameStatusText : '';
  const porcelainText = typeof input?.porcelainText === 'string' ? input.porcelainText : '';

  const nameStatus = parseNameStatus(nameStatusText);
  const porcelain = parsePorcelain(porcelainText);

  const files = new Set();
  let modifiesExisting = false;
  let additive = false;
  let unrecognized = !nameStatus.ok || !porcelain.ok;

  for (const entry of nameStatus.entries) {
    for (const filePath of entry.paths) files.add(filePath);
    if (MODIFYING_NAME_STATUS.has(entry.code)) modifiesExisting = true;
    else if (ADDITIVE_NAME_STATUS.has(entry.code)) additive = true;
    else unrecognized = true;
  }

  for (const entry of porcelain.entries) {
    for (const filePath of entry.paths) files.add(filePath);
    for (const flag of [entry.x, entry.y]) {
      if (flag === ' ') continue;
      if (MODIFYING_PORCELAIN.has(flag)) modifiesExisting = true;
      else if (ADDITIVE_PORCELAIN.has(flag)) additive = true;
      else unrecognized = true;
    }
  }

  const sortedFiles = [...files].sort();

  if (unrecognized) return { changeClass: 'unknown', files: sortedFiles };
  if (modifiesExisting) return { changeClass: 'modifies-existing', files: sortedFiles };
  if (additive) return { changeClass: 'additive-only', files: sortedFiles };
  return { changeClass: 'unknown', files: sortedFiles };
}
