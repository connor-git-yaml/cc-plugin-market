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
 * **输入可信度必须由调用方显式声明（F258 缺陷 2 的 Why 5）**：`nameStatusOk` / `porcelainOk`
 * 是 required 布尔位，缺失或非 boolean 一律 `throw TypeError`。
 *
 * - 为什么不接受"缺省即可信"：调用方的 git 包装器若把"命令跑失败"折成空串，空串在这里是
 *   完全合法的"没有变更"——"读不到"与"没有改动"在类型层不可区分，正是原缺陷的形态。
 * - 为什么也不接受"缺省即不可信"：那会把一切旧调用静默判成 `unknown`，而 `unknown` 命中矩阵
 *   行 7 `consume-degraded`、**根本不刷图**，还会抢在 freshness 之前短路，把 stale/dirty 信号
 *   永久遮蔽（fix-report R1 实证）。静默的"保守"方向在这条链上恰恰不保守。
 * - 终态取 caller 传参 required + fail-loud（F238 教训：让字符串/缺省承担控制信号必被击穿）。
 *
 * 文本字段仍保持宽容（非字符串按空串处理）：它们的"可信与否"已由 ok 位承担，再对文本类型
 * fail-loud 只会把同一件事判两遍。
 *
 * @param {{ nameStatusText?: string, nameStatusOk: boolean,
 *           porcelainText?: string, porcelainOk: boolean }} input
 * @returns {{ changeClass: 'modifies-existing'|'additive-only'|'unknown', files: string[] }}
 * @throws {TypeError} 两个 ok 位任一非 boolean 时
 */
export function classifyChangeSet(input) {
  for (const key of ['nameStatusOk', 'porcelainOk']) {
    if (typeof input?.[key] !== 'boolean') {
      throw new TypeError(
        `classifyChangeSet: 入参 ${key} 必须是 boolean（调用方必须显式声明该路 git 输出是否可信），实得 ${JSON.stringify(input?.[key])}`,
      );
    }
  }

  const nameStatusText = typeof input.nameStatusText === 'string' ? input.nameStatusText : '';
  const porcelainText = typeof input.porcelainText === 'string' ? input.porcelainText : '';

  const nameStatus = parseNameStatus(nameStatusText);
  const porcelain = parsePorcelain(porcelainText);

  const files = new Set();
  let modifiesExisting = false;
  let additive = false;
  // 读取失败与解析失败同权：两者都意味着"这一路的事实拿不到"，不得被空串伪装成"没有变更"。
  //
  // ⚠️ `porcelainOk:false` 并进这里是**有意的**，且有实打实的下游代价：它会让 changeClass 变
  // `unknown` ⇒ 命中 FR-003 矩阵行 7 `consume-degraded` ⇒ 本次不刷图（审查修复轮 M-5 登记于
  // `graph-consumption-inputs.mjs::collectChangeSet` 的 JSDoc）。保留它的理由是另一边更危险：
  // 排除 porcelain 会让只看得见已提交部分的残缺变更集冒充完整的，工作树里的修改型改动被抹掉
  // 后整体判 `additive-only` ⇒ 跳过 impact。
  let unrecognized = !input.nameStatusOk || !input.porcelainOk || !nameStatus.ok || !porcelain.ok;

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
