// F292：CI coverage 判定器核心——从负向证据换正向证据。
//
// 背景：`.github/workflows/ci.yml` 的 `Coverage (thresholds enforced)` 步旧实现只用两条
// 负向 grep（没抓到失败字样 ⇒ 判定没失败）+ 一条 birpc 签名命中就放行，从未正向确认
// 「打印了通过汇总」与「覆盖率报告确实生成」。CI 上 ANSI 未剥离时两条负向 grep 还会
// 结构性匹配不到彩色 `failed` 行，真实测试失败 + 一次 birpc 超时会被一并放行。
// 详见 specs/292-fix-coverage-gate-positive-evidence/{fix-report.md,plan.md} 决策4。
//
// 本文件零 I/O、零 process 依赖，供 tests/unit/coverage-gate.test.ts 直接 import 单测；
// CLI 薄壳见 scripts/coverage-gate.mjs。
//
// === delta 轮（对抗审查返工）===
// 两路独立异构对抗（角 A fail-open / 角 B 误伤面）在初版实现上再挖出两处 CRITICAL：
// 1. (b) 检查把 birpc 签名字面量当全文子串计数，未剔除 GitHub Actions 工作流命令行
//    （`::error ...`）——该注解会把已经在正文打印过一次的错误标题+栈原样复制一份，
//    使子串计数与"有几条不同的未处理错误"彻底脱钩；真实语料 `gha-birpc-and-real-crash`
//    证实：1 条 birpc 签名错误 + 1 条无关真崩溃，annotation 复制后子串命中数恰好等于
//    Errors 计数，旧实现会误判放行。
// 2. `Errors` 行正则无行锚，`\s` 会跨行匹配，理论上可被同一行内其它文本污染。
// 详见本文件下方各检查函数的注释与 verification/mutation-evidence.md 的 delta 轮记录。
//
// === delta-3 轮（第四轮代码质量审查，专攻 (c) 检查自身的一致性）===
// 第四轮审查抓到 1 处 CRITICAL：`checkCoverageTable` 用 `.match()`（无 `g`，取全文
// **第一处**匹配）抓 `Coverage report from` / `% Stmts` / `All files`，而同文件其它
// 检查（`parseSummaryLine`/`checkErrorSignature`/evidence 抽取）统一用 `lastMatch`
// 取**最后一处**——这条不一致同时开了两个方向的洞：
// 1. **fail-open**：汇总行之后若先打印一份"诱饵完整表"（如某次重试留下的 100% 表），
//    真正收尾的是坍塌表（`All files | 0 | ...`），取第一处会锁定诱饵表 ⇒ `All files>0`
//    兜底被绕过 ⇒ 误判 pass。
// 2. **误伤（镜像）**：日志靠前（汇总行之前）若出现一份格式相似的表，取第一处会让
//    `reportMatch.index < testsLine.index` 成立 ⇒ 合法跑批被判「表出现在汇总行之前」
//    误红——即便日志真正的收尾表在汇总行之后、内容完全正常。
// 修法：三处判据全部改用 `lastMatch`，与全文件"锚定日志真正收尾"的一致语义对齐。
// 三要素按序判据同时改写：先定位**最后一处** `Coverage report from`，再只在它之后的
// 子串里找 `% Stmts` / `All files`——这样三个锚点结构性地落在同一张表（最后一张）上，
// 而不是三个独立 `lastMatch` 各自可能漂到不同表（例如 `% Stmts` 的最后一处出现在
// 倒数第二张表、`All files` 的最后一处出现在最后一张表，二者被错误地拼成"同一张表"）。
// 详见 verification/mutation-evidence.md 的"delta-3 轮"小节。
//
// === delta-2 轮（第三轮异构对抗，专攻 delta 轮新判据）===
// 第三轮对抗审查（专门攻击 delta 轮刚写出的"标题行数 == Errors 计数"判据本身）再挖出
// 两处 CRITICAL：
// 1. **标题提取范围过宽**：delta 轮的 `UNHANDLED_ERROR_TITLE` 是全文正则（`^...Error:...$/gm`），
//    只要某一行整行匹配就算一条"标题"，不问这行是否真的出现在 vitest 的"未处理错误"分区里。
//    真实语料 `gha-stdout-fake-signature.ansi.txt`（vitest 3.2.4 实跑）证实：测试用
//    `console.log` 在 stdout 顶格打印两行 `Error: [vitest-worker]: Timeout calling "..."`
//    （伪造的 birpc 签名字面量），会被当成"标题"计入，且数量恰好凑够 Errors 计数、又都匹配
//    家族签名——而日志里两条**真实**的 `Unhandled Rejection`（标题是 `Unknown Error: boom-…`，
//    因为标题里的换行/空格结构，压根不匹配旧的标题正则）被完全漏检，判定器误判放行。
//    修法：标题只能从 vitest 自己打印的"未处理错误分区头"（`⎯+ Unhandled Error/Unhandled
//    Rejection/Uncaught Exception ⎯+`，注意**不是**汇总用的复数 `Unhandled Errors` 横幅）
//    之后提取——分区头数量本身就必须等于 Errors 计数，且每个分区头后的第一条非空行才是
//    该错误的标题。测试打印的内容不在任何分区头之内，天然被排除，不再需要"标题格式碰巧
//    对不上"这种脆弱的运气来兜底。
// 2. **家族签名允许携带 payload 尾巴**：`onUnhandledError` 这条 RPC 恰恰是 worker 向主进程
//    上报"真实未处理错误"的通道（见 `node_modules/vitest/dist/chunks/execute.*.js` 的
//    `catchError` → `state().rpc.onUnhandledError(error, type)`），它的超时消息会把原始错误
//    消息原样嵌进去（`Timeout calling "onUnhandledError" with "<original message>"`）——
//    这恰恰意味着"这次上报本该携带的真实错误内容，因为超时而没能确认到达/记录"，属于
//    "结果不可信"而非"已知假红"。旧的家族正则只做子串测试，对 payload 尾巴视而不见，会把
//    这种情况误判为已知假红而放行。`fetch`/`transform`/`resolveId` 三个通道同理：超时意味着
//    模块没加载完，同样不该被容忍。已用真实复现（在阻塞 reporter 场景下让 worker 真的抛出
//    未处理拒绝，逼真实的 `onUnhandledError` RPC 超时，见
//    `gha-onunhandlederror-timeout-real.ansi.txt`）与合成串（隔离验证，见测试文件）双重
//    确认。修法：家族签名改为整行严格匹配、**禁止任何 payload 尾巴**——载荷=这次超时吞掉了
//    具体内容，结果不可信，不属于"纯粹的 RPC 调用本身没收到回应"这一已知假红类别。

/**
 * ANSI 转义序列——覆盖 SGR 颜色码（`\x1b[...m`）之外的 CSI 序列（如光标移动，可能
 * 以除 m 外的字母结尾）与 OSC-8 超链接序列（`\x1b]8;;url\x07文本\x1b]8;;\x07`）。
 * 对抗审查角 B 指出：旧实现只剥 `\x1b\[[0-9;]*m`，任何非 SGR 的 CSI/OSC 序列都会原样
 * 留在文本里，理论上可以在行首插入不可见字节把某一行的"行首"错位，干扰依赖
 * `^[ \t]*` 行锚的检查。8 份既有真实样本未命中过这类序列（vitest 默认 reporter 只用
 * SGR 颜色），但按"宁可多剥、不留隐患"原则一并处理。
 */
const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

/**
 * GitHub Actions 工作流命令行——vitest 的 GithubActionsReporter 会把已经在日志正文
 * 打印过一次的未处理错误标题+栈原样复制进 `::error ...` 注解（正文用 %0A 编码换行，
 * 揉进单个物理行）。判定前必须整体剔除这类命令行，只信日志正文：
 * - 若不剔除，同一条错误的签名文本会被计数两次，且注解复制会让"签名计数"与
 *   "有几条不同的错误"脱钩（见文件头 delta 轮说明 1）。
 * - 顺带清空其它命令类型（`::warning` / `::notice` / `::group` 等）——这些同样是
 *   工具生成的元信息而非测试运行的事实陈述，不应参与任何正向/负向判据。
 */
const GH_WORKFLOW_COMMAND_LINE =
  /^::(?:error|warning|notice|debug|group|endgroup|add-mask|set-output|save-state|stop-commands)\b.*$/gm;

/**
 * birpc 超时错误家族签名（F235/F269 已知假红类别）——delta-2 轮改为**整行严格匹配、
 * 禁止任何 payload 尾巴**。
 *
 * 对抗审查角 B（delta 轮）：早期实现把签名字面量钉死成 `Timeout calling "onTaskUpdate"`，但
 * vitest 源码（`node_modules/vitest/dist/chunks/rpc.*.js`）里这条消息的方法名是
 * 调用点的**变量**（阻塞点决定名字：`onTaskUpdate`/`snapshotSaved`/`onCollected`/
 * `onUserConsoleLog`/...），前缀也有 `[vitest-worker]`/`[vitest-pool]`/`[vitest-api]`
 * 三种通道，故改为家族正则容忍"类别"而非某个具体方法名。
 *
 * delta-2 轮对抗审查（C-2 CRITICAL）：家族正则若仍允许任意后缀内容（子串测试），会放行
 * 一类本质上不可信的超时——vitest 源码 `rpc.-pEldfrD.js` 的 `onTimeoutError` 回调对
 * `fetch`/`transform`/`resolveId`/`onUnhandledError` 四个方法名会在消息里追加
 * ` with "<payload>"`：
 * - `onUnhandledError` 恰恰是 worker 向主进程上报"真实未处理错误"的 RPC 通道（见
 *   `execute.*.js` 的 `catchError` → `state().rpc.onUnhandledError(error, type)`），
 *   它的超时消息把原始错误消息原样嵌入 payload——这意味着"这条真实错误的上报因超时而
 *   没能确认送达"，属于结果不可信，不是"纯粹调用本身没收到回应"的已知假红。
 * - `fetch`/`transform`/`resolveId` 超时意味着模块没加载完，同样不代表"已知无害"。
 * 已用真实复现验证（阻塞 reporter 场景下让 worker 真的抛未处理拒绝，逼出真实的
 * `Timeout calling "onUnhandledError" with "<真实错误消息>"`，见
 * `gha-onunhandlederror-timeout-real.ansi.txt`）与合成串隔离验证（见测试文件）。
 *
 * 修法：整行严格匹配 `^Error: \[vitest-(?:worker|pool|api)\]: Timeout calling
 * "[A-Za-z0-9_$]+"$`——**禁止任何 payload 尾巴**，从而自动排除
 * onUnhandledError/fetch/transform/resolveId 四个通道的超时（它们的消息形态天然带
 * payload，永远无法整行匹配这个不带尾巴的严格正则）。放行仍然需要 (a)(b)(c) 三项正向
 * 证据全部满足，此收窄只影响"允许放行的错误类别边界"（比 delta 轮更窄），不改变
 * "必须逐条核对、数量相等"的收紧逻辑。
 */
const BIRPC_TITLE_STRICT = /^Error: \[vitest-(?:worker|pool|api)\]: Timeout calling "[A-Za-z0-9_$]+"$/;

/**
 * 未处理错误分区头——vitest 为**每一条**未处理错误单独打印的分区标题，形如
 * `⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯` / `⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯` /
 * `⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯`。
 *
 * 注意与"汇总横幅"的区别：vitest 还会在这些分区头**之前**打印一条复数形式的横幅
 * `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯`（注意 Errors 带 s），这条横幅只出现一次、
 * 不携带任何单条错误的标题信息。本正则要求"Unhandled Error"/"Unhandled Rejection"
 * 紧跟一个空格再接 `⎯`，"Errors"（多一个 s）后面紧跟的是 `s ⎯` 而非 ` ⎯`，天然无法
 * 匹配复数横幅——已用全部 12+ 份真实样本逐行核对确认（见
 * tests/fixtures/coverage-gate/README.md）。
 *
 * delta-2 轮对抗审查（C-1 CRITICAL）：delta 轮的标题提取用全文正则（`^...Error:...$/gm`），
 * 只要某一行整行匹配格式就算一条"标题"，完全不问这行是否真的出现在 vitest 的分区里。
 * 真实语料 `gha-stdout-fake-signature.ansi.txt` 证实：测试用 `console.log` 顶格打印的
 * 伪造签名行会被误当成标题吃进计数，而真实的 `Unhandled Rejection` 标题（`Unknown
 * Error: boom-…`，标题格式本身也不匹配旧正则）被完全漏检——两个巧合叠加导致误判放行。
 * 修法：标题只能从分区头之后提取，分区头数量本身必须等于 Errors 计数（保证"分区数
 * 与错误数一一对应"这一 vitest 自身的不变量没被破坏），彻底排除分区之外的任何文本。
 */
const UNHANDLED_SECTION_HEADER = /^⎯+ (?:Unhandled Error|Unhandled Rejection|Uncaught Exception) ⎯+$/gm;

/** vitest 在 Unhandled Errors 区块开头打印的横幅，作为 (b) 检查的第三条独立佐证（不强制）。 */
const UNHANDLED_BANNER = /Vitest caught (\d+) unhandled errors? during the test run\./;

/**
 * (a) 汇总计数白名单：只有这三类才算「正向证据」。
 *
 * 对抗审查角 B（R5）：`flaky`（vitest 真实存在的类别，测试重试后最终通过）刻意
 * **不**纳入白名单——flaky 意味着至少失败过一次，属于"结果不确定"而非"确凿通过"，
 * 与本判定器"宁可误判红、不放过真失败"的取向一致；未知类别（含 flaky）一律判红，
 * 需要人工介入而非静默放行。
 */
const SUMMARY_CATEGORIES = new Set(['passed', 'skipped', 'todo']);

/**
 * 剥离 ANSI 转义序列并归一化换行符。
 *
 * 对抗审查角 B（R7）：CRLF（`\r\n`）或裸 `\r`（某些终端/CI 环境的行覆盖回车）会让
 * 依赖 `\n` 分行或 `^...$/m` 行锚的检查把 `\r` 当成行内容的一部分，导致"末行是否为
 * 分隔线"之类的判据被一个看不见的尾随字符击穿。统一归一化为 `\n` 后再交给后续检查。
 */
function stripAnsi(text) {
  const noAnsi = text.replace(ANSI_PATTERN, '');
  return noAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 剔除 GitHub Actions 工作流命令行（`::error ...` 等），只保留日志正文。 */
function stripGithubWorkflowCommands(text) {
  return text.replace(GH_WORKFLOW_COMMAND_LINE, '');
}

/**
 * 取正则在全文里的**最后一处**匹配（而非第一处）。
 *
 * 对抗审查发现的 CRITICAL：早期实现用无 `g` 标志的 `.exec()`，只取「日志中第一处匹配」。
 * vitest 的真实汇总行只会紧邻覆盖率表之前打印一次，但只要日志中**更早的位置**出现一行
 * 格式吻合的顶格文本（例如误落地的调试 `console.log`、字面量断言失败时被 codeframe
 * 打印出的源码行），第一处匹配就会被这类"诱饵行"劫持，而判定器再也看不到真正的收尾
 * 汇总行——已用真实样本 `birpc-timeout-empty-counts.ansi.txt` 复现：在其前追加两行
 * `Test Files 1 passed (1)` / `Tests 2 passed (2)`，(a) 检查会把本该红的判定翻成 pass。
 * 改取最后一处匹配后，该样本即便被诱饵行污染，判定器仍锁定日志真正的收尾汇总/Errors 行。
 */
function lastMatch(pattern, flags, text) {
  const matches = [...text.matchAll(new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`))];
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * 从 `Test Files` / `Tests` 汇总行抽取 `{count, category}` 段。
 * 返回 null 表示该行不存在；返回空数组表示行存在但抽不出任何计数段
 * （如 birpc 打丢计数的空壳 ` Test Files   (1)`）。
 *
 * 对抗审查角 B（R5）：段抽取正则曾硬编码 `(passed|failed|skipped|todo)` 四个类别字面量，
 * 未知类别（如 vitest 未来/第三方 reporter 输出的 `errored`）会被正则**直接跳过而不是
 * 报告为"未知"**——`1 passed | 1 errored` 这类混合行因此只抽出 `{1, passed}` 一段，
 * (a) 检查看到"存在 passed>=1 且全部已知类别落在白名单"就会放行，errored 段直接隐形。
 * 改为通用词法抽取 `(\d+)[ \t]+([A-Za-z]+)` 后再交给调用方做白名单判定，未知类别不再
 * 被正则本身悄悄吞掉。
 */
function parseSummaryLine(stripped, label) {
  // 行首用 [ \t]*（不用 \s*）——\s* 会贪婪跨行吞掉前一空行的换行符，
  // 导致 match[0] 从上一行开始，纯属显示层面的瑕疵但仍应避免。
  // 取**最后一处**匹配（见 lastMatch 注释）——vitest 的真实汇总行必然是日志里最后
  // 一次出现的那一行，诱饵行只能出现在更早的位置。
  const lineMatch = lastMatch(`^[ \\t]*${label}[ \\t]+(.*)$`, 'm', stripped);
  if (!lineMatch) return null;
  const segments = [];
  const segRe = /(\d+)[ \t]+([A-Za-z]+)/g;
  let segMatch;
  while ((segMatch = segRe.exec(lineMatch[1])) !== null) {
    segments.push({ count: Number(segMatch[1]), category: segMatch[2] });
  }
  return segments;
}

/** (a) 汇总计数检查：两行都存在、都至少有一个计数段、类别全落在白名单、且都有 passed>=1。 */
function checkSummaryCounts(stripped) {
  const testFiles = parseSummaryLine(stripped, 'Test Files');
  const tests = parseSummaryLine(stripped, 'Tests');
  if (testFiles === null || tests === null) {
    return { ok: false, reason: '(a) 缺少 Test Files 或 Tests 汇总行，无正向证据' };
  }
  if (testFiles.length === 0 || tests.length === 0) {
    return { ok: false, reason: '(a) Test Files 或 Tests 汇总行无法抽出任何计数段（计数被打丢）' };
  }
  const allKnown = [...testFiles, ...tests].every((seg) => SUMMARY_CATEGORIES.has(seg.category));
  if (!allKnown) {
    return { ok: false, reason: '(a) 汇总计数含未知类别（非 passed/skipped/todo；含 flaky 等不确定结果类别）' };
  }
  const hasPassed = (segs) => segs.some((seg) => seg.category === 'passed' && seg.count >= 1);
  if (!hasPassed(testFiles) || !hasPassed(tests)) {
    return { ok: false, reason: '(a) Test Files 或 Tests 汇总行缺少 passed>=1 的正向证据' };
  }
  return { ok: true, reason: null };
}

/**
 * 提取"未处理错误分区标题"列表：每个分区头（`UNHANDLED_SECTION_HEADER`）之后的
 * 第一条非空行即为该错误的标题。分区头数量本身就是"日志里报告了几条未处理错误"的
 * 事实来源，不依赖标题行本身的格式（不同类型错误的标题格式差异很大：birpc 超时是
 * `Error: [vitest-...]: ...`，字面量拒绝是 `Unknown Error: ...`，普通异常是
 * `TypeError: ...` 等）。
 */
function extractUnhandledSectionTitles(text) {
  const lines = text.split('\n');
  const titles = [];
  lines.forEach((line, idx) => {
    if (!new RegExp(UNHANDLED_SECTION_HEADER.source).test(line)) return;
    let j = idx + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    titles.push(j < lines.length ? lines[j] : '');
  });
  return titles;
}

/**
 * (b) 未处理错误逐条核对：未处理错误**分区数**必须等于 Errors 汇总计数，且分区内
 * 提取出的每一条标题都要严格落在 birpc 家族签名内（不含 payload 尾巴，见
 * `BIRPC_TITLE_STRICT` 注释）。若存在 "Vitest caught N unhandled error(s)" 横幅，其
 * 数字也必须等于 Errors 计数，作为第三条独立佐证（横幅缺失不强制失败——已知既有
 * 真实样本均有该横幅，但不排除未来 vitest 版本改版）。
 *
 * delta-2 轮改写（见文件头 delta-2 轮说明 C-1/C-2）：判定不再依赖"某一行整行看起来
 * 像标题"这种脆弱启发式，而是先锚定 vitest 自己打印的分区头，再从分区内部提取标题——
 * 分区之外的任何文本（含测试自己在 stdout 打印的伪造签名行）天然被排除在外。
 *
 * 判定用的 `errCount` 与打印给人工复核的 evidence 行必须来自**同一次** `lastMatch`
 * 调用（同一个 `errMatch`），结构上保证两者不会各自匹配到不同的行。
 */
function checkErrorSignature(noAnnotations) {
  // 行锚 + m 标志：只认独占一整行、以 "Errors" 开头、以 "N error(s)" 收尾的行，
  // 不接受被同行其它文本污染或跨行拼接的匹配（对抗审查角 B：旧正则无 `^`/`m`/行尾锚，
  // `\s` 还能跨行匹配）。
  const errMatch = lastMatch('^[ \\t]*Errors[ \\t]+(\\d+)[ \\t]+errors?[ \\t]*$', 'm', noAnnotations);
  // 缺失 Errors 行判为 0 且视为不满足——status!==0 却连 Errors 行都没有，
  // 说明失败原因未知，不能放行。
  const errCount = errMatch ? Number(errMatch[1]) : 0;

  const titles = extractUnhandledSectionTitles(noAnnotations);
  const sectionCount = titles.length;
  const allTitlesAreBirpc = sectionCount > 0 && titles.every((t) => BIRPC_TITLE_STRICT.test(t));

  const bannerMatch = noAnnotations.match(UNHANDLED_BANNER);
  const bannerCount = bannerMatch ? Number(bannerMatch[1]) : null;
  const bannerAgrees = bannerCount === null || bannerCount === errCount;

  const ok = errCount > 0 && sectionCount === errCount && allTitlesAreBirpc && bannerAgrees;

  let reason = null;
  if (!ok) {
    if (errCount === 0) {
      reason = '(b) 缺少 Errors 汇总行或计数为 0，无法核对未处理错误身份';
    } else if (sectionCount !== errCount) {
      reason = `(b) 未处理错误分区数(${sectionCount}) 与 Errors 计数(${errCount}) 不相等（可能有错误被注解复制或漏计）`;
    } else if (!allTitlesAreBirpc) {
      reason = '(b) 至少一条未处理错误标题不属于已知 birpc 超时家族严格签名（可能是真实未处理错误搭便车，或超时消息携带了 payload 尾巴——意味着一条真实错误的上报因超时而未确认送达）';
    } else {
      reason = `(b) "Vitest caught N unhandled error(s)" 横幅计数(${bannerCount}) 与 Errors 计数(${errCount}) 不相等`;
    }
  }

  return {
    ok,
    reason,
    errorLine: errMatch ? errMatch[0] : null,
    errCount,
    sigCount: titles.filter((t) => BIRPC_TITLE_STRICT.test(t)).length,
  };
}

/**
 * (c) 覆盖率表完整（表头三要素齐全、按序出现、且在汇总行之后）、"All files" 总计行
 * 首项百分比 > 0（W-1，整体坍塌兜底），且是日志真正的收尾（末行即分隔线，其后无
 * 阈值行/噪声）。
 *
 * 对抗审查角 B（R6）：三要素此前只做存在性检查，未约束顺序与相对位置——理论上可以
 * 构造一份"三个关键词都在、但顺序错乱或出现在汇总行之前"的日志骗过 (c)。
 *
 * delta-2 轮对抗审查（W-1 WARNING）：本检查此前只证明"表打印了"，不能证明"表是对的"。
 * 实证：一次 `snapshotSaved` 超时把整张覆盖率表打成全 0（`All files | 0 | 0 | 0 | 0`），
 * (a)(b)(c) 三项此前仍全过。加一道整体坍塌兜底——解析 `All files` 行的第一个百分比
 * 数值，要求 > 0。**残余风险如实登记**：只兜住"整体聚合归零"这一种坍塌形态，无法检测
 * "部分文件覆盖率丢失、但聚合仍达标"（例如漏统计了一个大文件、恰好让聚合百分比看起来
 * 正常）——本仓 80% 阈值门槛本可再兜一层，但阈值一旦被架空（如临时调成 0）就没有第二道
 * 防线，仍需人工偶尔抽查覆盖率报告本身。
 *
 * delta-3 轮（第四轮代码质量审查，CRITICAL）：三要素此前用无 `g` 标志的 `.match()` 各自
 * 独立取**第一处**匹配，与全文件其它检查（`lastMatch`）的"锚定日志真正收尾"语义相悖，
 * 同时开了 fail-open（诱饵完整表在前、真实坍塌表在后 ⇒ 锁定诱饵表放行）与镜像误伤
 * （汇总行之前出现一份格式相似的表 ⇒ 被误判为"表在汇总行之前"）两个方向的洞。
 * 修法：先取**最后一处** `Coverage report from`（`lastMatch`），再只在它之后的子串里
 * 找 `% Stmts` / `All files`——这样三个锚点结构性地落在**同一张表**（最后一张）上，
 * 不会出现"`% Stmts` 取到倒数第二张表、`All files` 取到最后一张表，两者被错误拼成
 * 同一张表"这类新的判定歧义（若各自独立 `lastMatch`，就会产生这种歧义）。
 */
function checkCoverageTable(stripped) {
  const reportMatch = lastMatch('Coverage report from', '', stripped);
  if (!reportMatch) {
    return { ok: false, reason: '(c) 覆盖率表不完整（缺 Coverage report from / % Stmts / All files 之一）' };
  }
  // 只在"最后一处 Coverage report from"之后的子串里找剩余两要素——保证三者锚定
  // 同一张表（最后一张），而不是三个独立 lastMatch 各自可能漂到不同的表。
  const afterReport = stripped.slice(reportMatch.index + reportMatch[0].length);
  const stmtsMatch = afterReport.match(/%\s*Stmts/);
  const allFilesLineMatch = afterReport.match(/^[ \t]*All files[ \t]*\|[ \t]*([\d.]+)/m);
  if (!stmtsMatch || !allFilesLineMatch) {
    return { ok: false, reason: '(c) 覆盖率表不完整（缺 Coverage report from / % Stmts / All files 之一）' };
  }
  // 顺序约束收窄为 stmtsMatch.index < allFilesLineMatch.index——reportMatch 已经通过
  // slice 结构性地排在两者之前，无需再比较（比较一个绝对 index 与两个相对 index 没有
  // 意义）。
  if (!(stmtsMatch.index < allFilesLineMatch.index)) {
    return { ok: false, reason: '(c) 覆盖率表三要素顺序错乱（应依次为 Coverage report from → % Stmts → All files）' };
  }
  const testsLineMatch = lastMatch('^[ \\t]*Tests[ \\t]+.*$', 'm', stripped);
  if (testsLineMatch && !(reportMatch.index > testsLineMatch.index)) {
    return { ok: false, reason: '(c) 覆盖率表出现在汇总行之前（不是日志真正的收尾内容）' };
  }
  const firstPct = Number(allFilesLineMatch[1]);
  if (!(firstPct > 0)) {
    return { ok: false, reason: `(c) 覆盖率表 "All files" 行首项百分比为 ${firstPct}（整体坍塌，非正向证据；已知只能检测聚合归零，无法检测部分文件丢失）` };
  }
  const nonEmptyLines = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = nonEmptyLines[nonEmptyLines.length - 1] ?? '';
  if (!/^-+\|/.test(lastLine)) {
    return { ok: false, reason: `(c) 全日志最后一个非空行不是覆盖率表收尾分隔线（实为: ${JSON.stringify(lastLine)}）` };
  }
  return { ok: true, reason: null };
}

function buildResult(verdict, status, reasons, evidence) {
  const exitCode = verdict === 'pass' ? 0 : status !== 0 ? status : 1;
  return { verdict, exitCode, reasons, evidence };
}

/**
 * 判定一次 `npm run test:coverage` 跑批的日志是否应当放行 CI。
 *
 * 判定算法（详见 plan.md §决策4，delta/delta-2 轮已更新细节）：
 * 1. 负向检查（任何 status 下都查，命中即红，不看后续）：
 *    - 阈值未达，正阈值形态（`ERROR: Coverage for ... does not meet ...`，行锚约束）
 *    - 阈值未达，负阈值形态（`ERROR: Uncovered ... exceed ... threshold (...)`，
 *      行锚约束；delta-2 轮 I-1：vitest 允许阈值配成负数表示"最多允许 N 行未覆盖"，
 *      本仓当前阈值均为正百分比故此形态暂不可达，但阈值配置一旦改成负数就会激活，
 *      提前覆盖避免"配置变了、判定器没跟上"）
 *    - 汇总行含 failed（`Tests N failed` / `Test Files N failed`，行锚约束）
 * 2. `status === 0` 时（delta-2 轮 W-3 收紧，见下方）也要求 (a)(c) 两项正向证据；
 *    不跑 (b)——(b) 是用来解释"非零退出、错误是否已知假红"的，status===0 时没有非零
 *    退出需要解释。
 * 3. `status !== 0` 时必须**同时**满足三项正向检查，任一缺失 ⇒ 红：
 *    (a) 汇总计数完整且全部落在 passed/skipped/todo 白名单、passed>=1
 *    (b) 未处理错误分区数与 Errors 计数相等、每条分区标题都严格属于 birpc 家族签名
 *        （不含 payload 尾巴）、且横幅计数（若存在）与 Errors 计数一致
 *    (c) 覆盖率表三要素按序出现且在汇总行之后、"All files" 首项百分比 > 0、
 *        全日志最后一个非空行就是表格收尾分隔线
 *
 * delta-2 轮 W-3（WARNING）：`status===0` 快路径此前是"vitest 说通过就通过"零正向证据，
 * 一次全量 skip（0 passed）的跑批也会被判 pass。收紧为同时要求 (a)(c)（不要求 (b)，
 * 因为 status===0 不存在需要用 (b) 解释的未处理错误）。**已知取舍**：全量 skip（零
 * passed）的跑批在 status=0 下也会被判红，这是有意收紧，登记在 fix-report.md 残余
 * 风险表。
 *
 * 所有检查都先剔除 GitHub Actions 工作流命令行（`::error ...` 等）——这类注解是日志
 * 正文的**复制品**而非独立事实，参与判定会被复制次数污染。
 *
 * @param {{ log: string, status: number }} params
 * @returns {{ verdict: 'pass'|'red', exitCode: number, reasons: string[], evidence: object }}
 */
export function judgeCoverageLog({ log, status }) {
  const withoutAnsi = stripAnsi(log);
  const stripped = stripGithubWorkflowCommands(withoutAnsi);

  // evidence 打印给人工复核用，同样必须锁定最后一处匹配（否则人工复核看到的也是被
  // 诱饵行污染的假证据——对抗审查发现的次生后果，见 lastMatch 注释）。
  const testFilesMatch = lastMatch('^[ \\t]*Test Files[ \\t]+.*$', 'm', stripped);
  const testsMatch = lastMatch('^[ \\t]*Tests[ \\t]+.*$', 'm', stripped);
  const errorsMatch = lastMatch('^[ \\t]*Errors[ \\t]+.*$', 'm', stripped);
  const evidence = {
    status,
    testFilesLine: testFilesMatch ? testFilesMatch[0] : null,
    testsLine: testsMatch ? testsMatch[0] : null,
    errorsLine: errorsMatch ? errorsMatch[0] : null,
    signatureCount: null,
    errorCount: null,
  };

  // 负向检查：任何 status 下都查，命中即红，不看后续正向检查
  // （即便签名/计数/表格都齐全，阈值未达或真实测试失败也必须优先生效）。
  // 行锚 + [ \t] 替代 \s：避免 \s 跨行匹配把"跨两行拼出的巧合文本"或者混进日志的
  // 无关噪声（如子进程 stderr 泄漏的 "does not meet" 字样出现在别的上下文里）
  // 错判为负向命中（对抗审查角 B・R4）。
  if (/^[ \t]*ERROR: Coverage for .*does not meet.*$/m.test(stripped)) {
    return buildResult('red', status, ['负向检查命中：覆盖率阈值未达（ERROR: Coverage for ... does not meet ...）'], evidence);
  }
  // delta-2 轮 I-1：负阈值形态（vitest 允许把阈值配成负数表示"最多允许 N 行未覆盖"，
  // 消息文案完全不同，见 node_modules/vitest/dist/chunks/coverage.*.js 的
  // `ERROR: Uncovered ${key} (${uncovered}) exceed ... threshold (${absoluteThreshold})`）。
  if (/^[ \t]*ERROR: Uncovered .*exceed .*threshold[ \t]*\(.*\).*$/m.test(stripped)) {
    return buildResult('red', status, ['负向检查命中：覆盖率阈值未达（ERROR: Uncovered ... exceed ... threshold ...，负阈值形态）'], evidence);
  }
  if (/^[ \t]*(?:Tests|Test Files)[ \t]+.*\b\d+[ \t]+failed\b.*$/m.test(stripped)) {
    return buildResult('red', status, ['负向检查命中：汇总行含 failed（存在真实测试失败）'], evidence);
  }

  if (status === 0) {
    // delta-2 轮 W-3：不再零正向证据放行。要求 (a)(c)（不要求 (b)——status===0 没有
    // 非零退出需要用"未处理错误是否已知假红"来解释）。
    const summaryCheck0 = checkSummaryCounts(stripped);
    const tableCheck0 = checkCoverageTable(stripped);
    const failures0 = [summaryCheck0, tableCheck0].filter((check) => !check.ok).map((check) => check.reason);
    if (failures0.length > 0) {
      return buildResult('red', status, failures0, evidence);
    }
    return buildResult(
      'pass',
      status,
      ['status===0 且未命中负向检查，(a)(c) 正向检查亦满足：vitest 自身声明成功且有正向证据佐证'],
      evidence,
    );
  }

  // status !== 0：必须同时满足三项正向检查
  const summaryCheck = checkSummaryCounts(stripped);
  const errorCheck = checkErrorSignature(stripped);
  const tableCheck = checkCoverageTable(stripped);

  evidence.signatureCount = errorCheck.sigCount;
  evidence.errorCount = errorCheck.errCount;

  const failures = [summaryCheck, errorCheck, tableCheck].filter((check) => !check.ok).map((check) => check.reason);
  if (failures.length > 0) {
    return buildResult('red', status, failures, evidence);
  }
  return buildResult(
    'pass',
    status,
    ['三项正向检查全部满足：(a) 汇总计数完整 (b) 未处理错误逐条核对 birpc 家族严格签名 (c) 覆盖率表完整、按序、All files>0 且末行为收尾分隔线'],
    evidence,
  );
}
