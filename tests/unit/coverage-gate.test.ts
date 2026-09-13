/**
 * F292：CI coverage 判定器行为测试——8 份真实样本 + 变异隔离用的合成串。
 *
 * 见 specs/292-fix-coverage-gate-positive-evidence/{fix-report.md,plan.md} 决策4。
 * 每条正向/负向检查都必须有一条能证明「删掉它，至少一个用例会从红误判为通过」的用例
 * （变异隔离表），而不只是靠 8 份真实样本的整体判定结果打勾。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeCoverageLog } from '../../scripts/lib/coverage-gate-core.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/coverage-gate');
const loadFixture = (file: string): string => fs.readFileSync(path.join(fixturesDir, file), 'utf8');

/**
 * 全部真实样本的期望判定表——W-2（CLI 薄壳与 core 绑定断言）需要遍历同一份表对
 * CLI 子进程与直调 core 做逐份 exitCode 对拍，故提到模块作用域供两个 describe 共用。
 */
const cases: Array<{ file: string; status: number; verdict: 'pass' | 'red'; exitCode: number }> = [
  { file: 'clean-pass.ansi.txt', status: 0, verdict: 'pass', exitCode: 0 },
  { file: 'birpc-timeout-pass.ansi.txt', status: 1, verdict: 'pass', exitCode: 0 },
  { file: 'birpc-timeout-empty-counts.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  { file: 'unhandled-other.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  { file: 'tests-failed.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  { file: 'threshold-miss.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  { file: 'truncated-before-summary.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  { file: 'summary-no-coverage-table.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  // delta 轮新增：真实 GITHUB_ACTIONS=true 语料（旧 8 份只在 CI=true 下采集，两条 CRITICAL
  // 正是靠这条采集环境差异逃过初版实现——GHA 才会产出 `::error` 工作流命令行注解）。
  // 真实 CI（F285 首跑 run 34710678418）实况：549 passed/9 skipped、8206 passed/35 skipped/
  // 12 todo、1 error、1 条 birpc 签名、表完整、无 ::error 注解（栈帧全在 node_modules，
  // GithubActionsReporter 跳过无源文件位置的错误）⇒ 必须放行。
  { file: 'ci-run-34710678418-birpc-pass.ansi.txt', status: 1, verdict: 'pass', exitCode: 0 },
  // 真实 GHA 跑批：非 birpc 的未处理错误（`boom unhandled`）+ ::error 注解 ⇒ 硬红。
  { file: 'gha-unhandled-other.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  // CRITICAL 回归主证据：1 条 birpc 签名错误 + 1 条无关真崩溃（`boom real crash`），
  // ::error 注解把 birpc 签名复制一份——初版实现（全文子串计数未剔除注解）
  // 会让子串命中数(2)恰好等于 Errors 计数(2)，误判放行；delta 轮改为逐条核对
  // 标题行数与家族签名后必须判红。
  { file: 'gha-birpc-and-real-crash.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  // 真实 GHA birpc 超时把计数打丢 ⇒ (a) 检查兜底判红。
  { file: 'gha-birpc-empty-counts.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  // delta-2 轮新增（C-1 CRITICAL 主证据）：真实 vitest 3.2.4 实跑，测试用 console.log
  // 在 stdout 顶格打印两行伪造的 birpc 签名字面量，同时真实抛出两条 Unhandled Rejection
  // （`Unknown Error: boom-primitive-*`）。delta 轮实现（标题提取不锚定分区）会把伪造行
  // 当成标题吃进计数，数量与家族签名恰好都对得上，误判放行；delta-2 轮改为分区锚定后
  // 必须判红（伪造行不在任何分区内，真实标题不匹配家族签名）。
  { file: 'gha-stdout-fake-signature.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
  // delta-2 轮新增（C-2 CRITICAL 真实复现，见 lib/coverage-gate-core.mjs 文件头说明）：
  // 阻塞 reporter 在 `onCollected` 首次回调时同步空转 61s，逼真实的 `onUnhandledError`
  // RPC 调用超时，产出 `Timeout calling "onUnhandledError" with "<真实错误消息>"`。
  // **如实登记**：本样本因阻塞发生在收集阶段，测试从未真正执行，(a)(c) 也同时判红
  // （零 passed、无覆盖率表），故此样本是"多重原因同时判红"的真实语料，不能单独隔离证明
  // C-2；C-2 的单独隔离证明见下方 delta-2 专项 describe 块的合成串用例。
  { file: 'gha-onunhandlederror-timeout-real.ansi.txt', status: 1, verdict: 'red', exitCode: 1 },
];

describe('F292 · judgeCoverageLog — 14 份真实样本（8 份 CI=true + delta 轮 4 份 + delta-2 轮 2 份 GITHUB_ACTIONS=true）', () => {
  for (const { file, status, verdict, exitCode } of cases) {
    it(`${file}（status=${status}）⇒ verdict=${verdict} exitCode=${exitCode}`, () => {
      const result = judgeCoverageLog({ log: loadFixture(file), status });
      expect(result.verdict).toBe(verdict);
      expect(result.exitCode).toBe(exitCode);
    });
  }

  // 主编排器修订：该 fixture 的 Unhandled Error 签名字面量已统一为 onTaskUpdate，
  // 因此现在同时触发 (a)（零 passed 段）与 (b)（签名计数 1 == Errors 计数 1，实为满足；
  // 实测：checkErrorSignature 对该样本判 ok，红判完全来自 (a)）——它现在**可以**单独
  // 充当 (a) 的隔离证明，但 T004 的合成串仍额外编写（证明目的不同，两条断言都保留，
  // 详见 tasks.md 前提说明）。
  it('birpc-timeout-empty-counts.ansi.txt 现仅触发 (a)：Errors(1)==签名数(1) 本身满足', () => {
    const result = judgeCoverageLog({ log: loadFixture('birpc-timeout-empty-counts.ansi.txt'), status: 1 });
    expect(result.evidence.errorCount).toBe(1);
    expect(result.evidence.signatureCount).toBe(1);
    expect(result.reasons.join('\n')).toMatch(/\(a\)/);
    expect(result.reasons.join('\n')).not.toMatch(/\(b\)/);
  });
});

describe('F292 · judgeCoverageLog — 异构对抗审查回归（独立子代理找到的 CRITICAL/WARNING）', () => {
  it('CRITICAL 回归：诱饵行不得劫持真实收尾汇总行（早期实现用无 g 标志 .exec 只取第一处匹配）', () => {
    // 对抗审查实测：在真实"计数被打丢"样本前追加两行格式吻合的顶格诱饵文本
    // （如误落地的调试 console.log），早期实现会把 (a) 检查锁定的行从"真正的收尾
    // 汇总行"错换成"更早出现的诱饵行"，把本该红的判定翻成 pass。修法：所有汇总/
    // Errors 行匹配一律取全文最后一处（lastMatch），而不是第一处。
    const original = loadFixture('birpc-timeout-empty-counts.ansi.txt');
    const decoy = `Test Files 1 passed (1)\nTests 2 passed (2)\n${original}`;
    const result = judgeCoverageLog({ log: decoy, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(a\)/);
    // evidence 打印给人工复核用，同样不能被诱饵行污染
    expect(result.evidence.testFilesLine).not.toBe('Test Files 1 passed (1)');
  });
});

describe('F292 · judgeCoverageLog — delta 轮对抗审查返工（角 A fail-open / 角 B 误伤面）', () => {
  it('R2 CRITICAL：::error 注解复制的 birpc 签名不得让含真实崩溃的批次放行（真实语料，见上方主用例表）', () => {
    // 独立复述断言，明确指向根因：初版 checkErrorSignature 用全文子串计数
    // `stripped.split(BIRPC_SIGNATURE).length`，::error 注解把已经打印过一次的
    // birpc 签名原样复制一份，使子串命中数(2)恰好等于 Errors 计数(2)，
    // 掩盖了"另一条错误其实是无关真崩溃"这一事实。delta 轮改为逐条核对标题行数
    // 与家族签名后必须判红。
    const result = judgeCoverageLog({ log: loadFixture('gha-birpc-and-real-crash.ansi.txt'), status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.evidence.errorCount).toBe(2);
    expect(result.reasons.join('\n')).toMatch(/\(b\)/);
  });

  it('R3：家族正则容忍不同 RPC 通道/方法名（不钉死 onTaskUpdate 字面量）——合成串验证 snapshotSaved/vitest-pool/vitest-api 均可放行', () => {
    // 合成一份结构合法的最小放行日志，逐一替换签名的通道前缀与方法名，验证
    // BIRPC_SIGNATURE_FAMILY 不因方法名/通道变化而误判红（旧实现钉死 onTaskUpdate
    // 字面量，换一个阻塞点就会被误判为"新的真实错误"）。
    const buildLog = (channel: string, method: string): string =>
      [
        ' RUN v3.2.4 test-project',
        '',
        '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
        '',
        'Vitest caught 1 unhandled error during the test run.',
        '',
        // delta-2 轮修正：真实 vitest 除打印复数横幅外，还会为每条错误单独打印一个
        // 分区头（`⎯+ Unhandled Error ⎯+`），(b) 检查现在从分区头之后提取标题，
        // 缺了这行会导致 sectionCount(0) !== errCount(1) 而被误判红——这不是本用例
        // 想验证的失效面（本用例专测家族签名是否容忍不同 channel/method），故补全。
        '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
        '',
        `Error: [${channel}]: Timeout calling "${method}"`,
        ' ❯ Timeout._onTimeout a.test.mjs:1:1',
        '',
        '',
        ' Test Files  1 passed (1)',
        '      Tests  2 passed (2)',
        '     Errors  1 error',
        '',
        '',
        ' % Coverage report from v8',
        '----------|---------|----------|---------|---------|-------------------',
        'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
        '----------|---------|----------|---------|---------|-------------------',
        'All files |     100 |      100 |     100 |     100 |',
        '----------|---------|----------|---------|---------|-------------------',
      ].join('\n');
    for (const [channel, method] of [
      ['vitest-worker', 'onTaskUpdate'],
      ['vitest-worker', 'snapshotSaved'],
      ['vitest-pool', 'onCollected'],
      ['vitest-api', 'onUserConsoleLog'],
    ]) {
      const result = judgeCoverageLog({ log: buildLog(channel!, method!), status: 1 });
      expect(result.verdict, `channel=${channel} method=${method}`).toBe('pass');
    }
    // 反例：非 birpc 家族通道（伪造 `[vitest-fake]`）不应被容忍。
    const fake = judgeCoverageLog({ log: buildLog('vitest-fake', 'onTaskUpdate'), status: 1 });
    expect(fake.verdict).toBe('red');
  });

  it('R4：跨行拼接的噪声（"Tests\\n3 failed to parse" / 非锚定的 "does not meet"）不得触发负向检查误伤', () => {
    // 本仓测试会把子进程 stderr 原样泄进同一份 coverage.log；旧负向检查
    // `/does not meet|ERROR: Coverage for/`（纯子串，无锚）与
    // `/Tests\s+\d+\s+failed/`（\s 可跨行）在这类噪声面前会整段误判红。
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const anchor = 'Vitest caught 1 unhandled error during the test run.';
    expect(original).toContain(anchor);
    const noise = [
      '[coverage-gate] 无法读取日志文件 /tmp/x.log: ENOENT（无关子进程 stderr 泄漏）',
      'Tests',
      '3 failed to parse',
      'note: coverage for module-x does not meet spec requirements (unrelated prose)',
    ].join('\n');
    const mutated = original.replace(anchor, `${anchor}\n${noise}`);
    expect(mutated).not.toBe(original); // 确认注入生效
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('pass');
  });

  it('R5：未知汇总类别（"1 errored"）必须判红，且 flaky 也不在白名单内（宁可误判红不放过真失败）', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const withErrored = original.replace('2 passed', '1 passed | 1 errored');
    const rErrored = judgeCoverageLog({ log: withErrored, status: 1 });
    expect(rErrored.verdict).toBe('red');
    expect(rErrored.reasons.join('\n')).toMatch(/\(a\)/);

    const withFlaky = original.replace('2 passed', '1 passed | 1 flaky');
    const rFlaky = judgeCoverageLog({ log: withFlaky, status: 1 });
    expect(rFlaky.verdict).toBe('red');
    expect(rFlaky.reasons.join('\n')).toMatch(/\(a\)/);

    // sanity：未变异应放行，确认变异是唯一变量
    const sanity = judgeCoverageLog({ log: original, status: 1 });
    expect(sanity.verdict).toBe('pass');
  });

  it('R6a：覆盖率表三要素顺序错乱（同一张表内 All files 提前到 % Stmts 之前）⇒ 判红', () => {
    const errorBlock = [
      '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
      '',
      'Vitest caught 1 unhandled error during the test run.',
      '',
      // delta-2 轮修正：补上单条错误的分区头，否则 sectionCount(0)!==errCount(1)，
      // (b) 检查会无关地把本用例判红，掩盖了本用例真正要测的 (c) 失效面。
      '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
      '',
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
    ].join('\n');
    const summaryBlock = [' Test Files  1 passed (1)', '      Tests  2 passed (2)', '     Errors  1 error'].join('\n');
    // delta-3 轮修正：三要素必须锚定**同一张表**才有意义——旧写法把 "All files" 整个
    // 放在 "Coverage report from" 之前，在新的"先锚最后一处 report 头、再在其后子串找
    // 剩余两要素"语义下，这实为"表不完整"（report 头之后压根没有 All files 行）而非
    // "顺序错乱"。改为在 report 头**之后**的同一张表内部把 All files 提前到 % Stmts
    // 之前，才是货真价实的"同一张表、顺序被打乱"。
    const reorderedTable = [
      ' % Coverage report from v8',
      'All files |     100 |      100 |     100 |     100 |',
      '----------|---------|----------|---------|---------|-------------------',
      'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
      '----------|---------|----------|---------|---------|-------------------',
      '----------|---------|----------|---------|---------|-------------------',
    ].join('\n');
    const log = [' RUN v3.2.4', '', errorBlock, '', summaryBlock, '', reorderedTable].join('\n');
    const result = judgeCoverageLog({ log, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\).*顺序错乱/);
  });

  it('R6b：覆盖率表整体出现在汇总行之前（不是日志真正的收尾内容）⇒ 判红', () => {
    const errorBlock = [
      '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
      '',
      'Vitest caught 1 unhandled error during the test run.',
      '',
      // delta-2 轮修正：补上单条错误的分区头，否则 sectionCount(0)!==errCount(1)，
      // (b) 检查会无关地把本用例判红，掩盖了本用例真正要测的 (c) 失效面。
      '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
      '',
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
    ].join('\n');
    const summaryBlock = [' Test Files  1 passed (1)', '      Tests  2 passed (2)', '     Errors  1 error'].join('\n');
    const validTable = [
      ' % Coverage report from v8',
      '----------|---------|----------|---------|---------|-------------------',
      'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
      '----------|---------|----------|---------|---------|-------------------',
      'All files |     100 |      100 |     100 |     100 |',
      '----------|---------|----------|---------|---------|-------------------',
    ].join('\n');
    const logBefore = [' RUN v3.2.4', '', errorBlock, '', validTable, '', summaryBlock].join('\n');
    const result = judgeCoverageLog({ log: logBefore, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\).*汇总行之前/);

    // sanity：表在汇总行之后（正常顺序）应放行
    const logAfter = [' RUN v3.2.4', '', errorBlock, '', summaryBlock, '', validTable].join('\n');
    const sanity = judgeCoverageLog({ log: logAfter, status: 1 });
    expect(sanity.verdict).toBe('pass');
  });

  it('R7a：裸 \\r（无 \\n）行结尾——归一化前 (c) 会把整份日志当成一整行误判红', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const bareCr = original.replace(/\n/g, '\r');
    const result = judgeCoverageLog({ log: bareCr, status: 1 });
    expect(result.verdict).toBe('pass');
  });

  it('R7b：OSC-8 超链接序列（非 SGR 的 \\x1b] 转义）包裹收尾分隔线——旧窄 ANSI 剥离会把该行误判为"非分隔线"', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const sep = '----------|---------|----------|---------|---------|-------------------';
    const idx = original.lastIndexOf(sep);
    expect(idx).toBeGreaterThan(0);
    const wrapped = `\x1b]8;;https://example.com\x07${sep}\x1b]8;;\x07`;
    const mutated = original.slice(0, idx) + wrapped + original.slice(idx + sep.length);
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('pass');
  });
});

describe('F292 · judgeCoverageLog — delta-2 轮对抗审查返工（第三轮，专攻 delta 轮新判据本身）', () => {
  it('C-1 CRITICAL：伪造的顶格 birpc 签名字面量（console.log 打印，非 vitest 分区内容）不得掩盖真实未处理错误（真实语料）', () => {
    // 见上方主用例表 gha-stdout-fake-signature.ansi.txt：测试自己在 stdout 打印两行
    // 形如 `Error: [vitest-worker]: Timeout calling "..."` 的伪造签名文本，同时真的抛出
    // 两条 Unhandled Rejection。delta 轮实现（全文标题正则、不锚定分区）会把伪造行当成
    // 标题吃进计数，掩盖真实错误，误判放行。delta-2 轮改为从分区头之后提取标题后必须判红，
    // 且失败原因必须来自 (b)（不是 (a)——这份样本汇总计数本身是干净的 1 passed）。
    const result = judgeCoverageLog({ log: loadFixture('gha-stdout-fake-signature.ansi.txt'), status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.evidence.errorCount).toBe(2);
    expect(result.reasons.join('\n')).toMatch(/\(b\)/);
    expect(result.reasons.join('\n')).not.toMatch(/\(a\)/);
  });

  it('C-2 CRITICAL：家族签名禁止 payload 尾巴——"onUnhandledError" 携带真实错误消息的超时不得放行（合成串隔离）', () => {
    // 合成一份结构合法的最小放行日志（单分区、单标题、汇总/表格均正常），标题唯一的
    // 差异点是携带了 payload 尾巴（` with "..."`）。这是 delta 轮家族正则会误放行、
    // delta-2 轮严格正则会拦下的精确边界——单独隔离证明 C-2，不与 (a)/(c) 混淆。
    // 真实复现见 gha-onunhandlederror-timeout-real.ansi.txt（见该文件注释：因同时触发
    // (a)(c) 无法单独隔离，故本用例是 C-2 的干净隔离证明）。
    const buildLog = (title: string): string =>
      [
        ' RUN v3.2.4 test-project',
        '',
        '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
        '',
        'Vitest caught 1 unhandled error during the test run.',
        '',
        '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
        '',
        title,
        ' ❯ Timeout._onTimeout a.test.mjs:1:1',
        '',
        '',
        ' Test Files  1 passed (1)',
        '      Tests  2 passed (2)',
        '     Errors  1 error',
        '',
        '',
        ' % Coverage report from v8',
        '----------|---------|----------|---------|---------|-------------------',
        'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
        '----------|---------|----------|---------|---------|-------------------',
        'All files |     100 |      100 |     100 |     100 |',
        '----------|---------|----------|---------|---------|-------------------',
      ].join('\n');

    // 反例：不带 payload 尾巴的合法家族签名——sanity，确认结构本身没问题，唯一变量是 payload。
    const clean = judgeCoverageLog({ log: buildLog('Error: [vitest-worker]: Timeout calling "onTaskUpdate"'), status: 1 });
    expect(clean.verdict).toBe('pass');

    // 目标变异：携带真实错误消息 payload 的 onUnhandledError 超时。
    const withPayload = judgeCoverageLog(
      { log: buildLog('Error: [vitest-worker]: Timeout calling "onUnhandledError" with "boom real message"'), status: 1 },
    );
    expect(withPayload.verdict).toBe('red');
    expect(withPayload.reasons.join('\n')).toMatch(/\(b\)/);

    // 同理覆盖 fetch/transform/resolveId 三个通道的 payload 尾巴。
    for (const method of ['fetch', 'transform', 'resolveId']) {
      const r = judgeCoverageLog({ log: buildLog(`Error: [vitest-worker]: Timeout calling "${method}" with "[\\"a.mjs\\"]"`), status: 1 });
      expect(r.verdict, `method=${method}`).toBe('red');
    }
  });

  it('W-1 WARNING：覆盖率表 "All files" 首项百分比为 0（整体坍塌）⇒ 即便 (a)(b) 全过也必须判红（合成串隔离）', () => {
    const log = [
      ' RUN v3.2.4 test-project',
      '',
      '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
      '',
      'Vitest caught 1 unhandled error during the test run.',
      '',
      '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
      '',
      'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
      '',
      '',
      ' Test Files  1 passed (1)',
      '      Tests  2 passed (2)',
      '     Errors  1 error',
      '',
      '',
      ' % Coverage report from v8',
      '----------|---------|----------|---------|---------|-------------------',
      'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
      '----------|---------|----------|---------|---------|-------------------',
      'All files |       0 |        0 |       0 |       0 |',
      '----------|---------|----------|---------|---------|-------------------',
    ].join('\n');
    // sanity：把首项从 0 改成 100，其余不动，应放行——确认变异点唯一。
    const sanity = judgeCoverageLog({ log: log.replace('All files |       0 |', 'All files |     100 |'), status: 1 });
    expect(sanity.verdict).toBe('pass');

    const result = judgeCoverageLog({ log, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\).*整体坍塌/);
  });

  it('W-3 WARNING：status===0 不再零正向证据放行——全量 skip（零 passed）必须判红（合成串隔离）', () => {
    const log = [
      ' RUN v3.2.4 test-project',
      '',
      ' Test Files   (1)',
      '      Tests   (2)',
      '',
      '',
      ' % Coverage report from v8',
      '----------|---------|----------|---------|---------|-------------------',
      'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
      '----------|---------|----------|---------|---------|-------------------',
      'All files |     100 |      100 |     100 |     100 |',
      '----------|---------|----------|---------|---------|-------------------',
    ].join('\n');
    const result = judgeCoverageLog({ log, status: 0 });
    expect(result.verdict).toBe('red');
    expect(result.exitCode).toBe(1);
    expect(result.reasons.join('\n')).toMatch(/\(a\)/);

    // sanity：status===0 且有真实 passed 计数 + 完整表格，仍应放行（不误伤正常绿批）。
    const cleanLog = loadFixture('clean-pass.ansi.txt');
    const cleanResult = judgeCoverageLog({ log: cleanLog, status: 0 });
    expect(cleanResult.verdict).toBe('pass');
  });

  it('I-1 INFO：负阈值形态（"ERROR: Uncovered ... exceed ... threshold (...)"）必须触发负向检查（合成串隔离）', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const separatorLine = '----------|---------|----------|---------|---------|-------------------';
    expect(original.trimEnd().endsWith(separatorLine)).toBe(true);
    const mutated = `${original}ERROR: Uncovered statements (33) exceed threshold (30)\n${separatorLine}\n`;
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/负向检查命中.*负阈值形态/);

    // 带文件名后缀的形态（per-file 阈值）同样必须命中。
    const mutatedPerFile = `${original}ERROR: Uncovered statements (33) exceed "src/a.mjs" threshold (30) for src/a.mjs\n${separatorLine}\n`;
    const resultPerFile = judgeCoverageLog({ log: mutatedPerFile, status: 1 });
    expect(resultPerFile.verdict).toBe('red');
  });
});

describe('F292 · judgeCoverageLog — delta-3 轮代码质量审查返工（(c) 检查内部 .match()/lastMatch 不一致，CRITICAL）', () => {
  // 两条用例共享的最小合法未处理错误块（单条 birpc 家族签名，满足 (a)(b)，
  // 让判定结果只取决于 (c) 对"多份覆盖率表"的处理方式）。
  const errorBlock = [
    '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
    '',
    'Vitest caught 1 unhandled error during the test run.',
    '',
    '⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯',
    '',
    'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
  ].join('\n');
  const summaryBlock = [' Test Files  1 passed (1)', '      Tests  2 passed (2)', '     Errors  1 error'].join('\n');
  const buildTable = (pct: string): string =>
    [
      ' % Coverage report from v8',
      '----------|---------|----------|---------|---------|-------------------',
      'File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
      '----------|---------|----------|---------|---------|-------------------',
      `All files | ${pct.padStart(7)} | ${pct.padStart(8)} | ${pct.padStart(7)} | ${pct.padStart(7)} |`,
      '----------|---------|----------|---------|---------|-------------------',
    ].join('\n');

  it('CRITICAL fail-open 方向：早期诱饵完整表（100%）不得掩盖日志真正收尾表的坍塌（0%）', () => {
    // 旧实现（三处 .match() 各自取第一处）会锁定更早出现的诱饵完整表（100%），
    // 判定 (c) 全过，完全看不到日志真正收尾的坍塌表（0%）——这正是本仓 W-1 兜底
    // 想拦截的场景，但被"取第一处"的实现漏放了。
    const decoyTable = buildTable('100');
    const collapsedTable = buildTable('0');
    const log = [' RUN v3.2.4', '', errorBlock, '', summaryBlock, '', decoyTable, '', collapsedTable].join('\n');
    const result = judgeCoverageLog({ log, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\).*整体坍塌/);
  });

  it('镜像误伤方向：汇总行之前出现的诱饵表不得让日志真正收尾的合法表被误判为"出现在汇总行之前"', () => {
    // 旧实现取"Coverage report from"的第一处匹配——如果日志更早的位置（汇总行之前）
    // 恰好出现一份格式相似的诱饵表，第一处匹配会锁定这份诱饵表，其位置在汇总行之前，
    // 触发 (c) 的位置检查误判红；而日志真正收尾的、位于汇总行之后的合法表反而被忽视。
    const decoyTable = buildTable('100');
    const validTable = buildTable('100');
    const log = [' RUN v3.2.4', '', decoyTable, '', errorBlock, '', summaryBlock, '', validTable].join('\n');
    const result = judgeCoverageLog({ log, status: 1 });
    expect(result.verdict).toBe('pass');
  });
});

describe('F292 · judgeCoverageLog — 变异隔离用例（合成串，证明每项检查独立生效）', () => {
  it('汇总计数 (a)：挖空 passed 计数（其余签名/Errors/表格不动）⇒ 单独判红', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    expect((original.match(/1 passed/g) ?? []).length).toBe(1);
    expect((original.match(/2 passed/g) ?? []).length).toBe(1);
    const mutated = original.replace('1 passed', '').replace('2 passed', '');
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(a\)/);
  });

  it('签名数不匹配 (b)：unhandled-other 的 Errors=1 但签名文本是 boom unhandled，signatureCount=0≠1', () => {
    const result = judgeCoverageLog({ log: loadFixture('unhandled-other.ansi.txt'), status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.evidence.errorCount).toBe(1);
    expect(result.evidence.signatureCount).toBe(0);
    expect(result.reasons.join('\n')).toMatch(/\(b\)/);
  });

  it('Errors 行缺失 (b)：全过日志却手写 status=1 且无 Errors 行 ⇒ 判红（不能"看似全过就放行"）', () => {
    const mutated = loadFixture('clean-pass.ansi.txt');
    expect(mutated).not.toMatch(/Errors/);
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.evidence.errorCount).toBe(0);
    expect(result.reasons.join('\n')).toMatch(/\(b\)/);
  });

  it('覆盖率表缺失 (c)：summary-no-coverage-table 汇总全过但表缺失 ⇒ 判红', () => {
    const result = judgeCoverageLog({ log: loadFixture('summary-no-coverage-table.ansi.txt'), status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\)/);
  });

  it('末行非收尾分隔线 (c)：表完整但收尾分隔线后追加无害噪声 ⇒ 单独判红', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    const mutated = `${original}note: retried\n`;
    const sanity = judgeCoverageLog({ log: original, status: 1 });
    expect(sanity.verdict).toBe('pass'); // 未变异前本应放行，确认变异是唯一变量
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/\(c\)/);
  });

  it('负向检查优先级：本应放行的样本混入阈值未达行（收尾分隔线保持完整）⇒ 依旧判红（负向检查优先于三项正向检查）', () => {
    const original = loadFixture('birpc-timeout-pass.ansi.txt');
    // 关键：把阈值未达行插在收尾分隔线之前、再补一份分隔线收尾，保持 (c) 检查独立成立，
    // 避免"追加任意内容都会破坏末行即分隔线"这一事实把 (c) 也一并带崩，
    // 从而真正单独证明负向检查优先级（而不是被 (c) 顺带扛住）。
    const separatorLine = '----------|---------|----------|---------|---------|-------------------';
    expect(original.trimEnd().endsWith(separatorLine)).toBe(true);
    const mutated = `${original}ERROR: Coverage for branches (66.66%) does not meet "src/a.mjs" threshold (99%)\n${separatorLine}\n`;
    const result = judgeCoverageLog({ log: mutated, status: 1 });
    expect(result.verdict).toBe('red');
    expect(result.reasons.join('\n')).toMatch(/负向检查命中/);
  });
});

describe('F292 · coverage-gate.mjs CLI 薄壳（子进程实跑，保证接线不是死代码）', () => {
  const cliPath = path.join(repoRoot, 'scripts/coverage-gate.mjs');

  const runCli = (fixture: string, status: string): { stdout: string; exitCode: number } => {
    try {
      const stdout = execFileSync('node', [cliPath, path.join(fixturesDir, fixture), status], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      return { stdout, exitCode: 0 };
    } catch (error) {
      const err = error as { stdout?: string; status?: number };
      return { stdout: err.stdout ?? '', exitCode: err.status ?? -1 };
    }
  };

  it('放行样本：子进程 exit 0，stdout 含 verdict=pass', () => {
    const { stdout, exitCode } = runCli('clean-pass.ansi.txt', '0');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[coverage-gate] verdict=pass exitCode=0');
  });

  it('硬红样本：子进程 exit 非 0（沿用 status），stdout 含 verdict=red 与 reasons', () => {
    const { stdout, exitCode } = runCli('tests-failed.ansi.txt', '1');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[coverage-gate] verdict=red exitCode=1');
    expect(stdout).toContain('[coverage-gate] reasons:');
  });

  it('W-2 WARNING：CLI 源码必须 import core 判定器（防止薄壳被替换成一份内部另写判定逻辑、绕开全部 core 守护）', () => {
    // 对抗审查实测：把 scripts/coverage-gate.mjs 换成"不 import core、内部写回旧的负向
    // grep 逻辑"的变体，release-ci-gates 的两条 core 子串断言、CLI 的既有用例全绿，
    // 但 12+ 份 fixture 里有多份判定从 red 退回 pass——薄壳与 core 之间此前无任何绑定断言。
    const src = fs.readFileSync(cliPath, 'utf8');
    expect(src).toMatch(/from\s+['"]\.\/lib\/coverage-gate-core\.mjs['"]/);
    expect(src).toMatch(/judgeCoverageLog\s*\(/);
  });

  it('W-2 WARNING：CLI 子进程对全部真实样本的 exitCode 必须与直调 judgeCoverageLog 逐份相等', () => {
    // 遍历上方主用例表的全部 fixture，子进程实跑一遍、直调 core 一遍，逐份比对 exitCode——
    // 只靠"源码里有 import 字样"不够（import 了也可能被条件绕过/被后续代码覆盖判定结果），
    // 真正的绑定证据是"输出确实一致"。
    for (const { file, status } of cases) {
      const direct = judgeCoverageLog({ log: loadFixture(file), status });
      const { exitCode } = runCli(file, String(status));
      expect(exitCode, `fixture=${file} status=${status}`).toBe(direct.exitCode);
    }
  });

  it('WARNING 回归：空字符串 status 不得被 Number.isInteger 静默当成 0（成功）', () => {
    // 对抗审查实测：早期实现用 Number.isInteger(Number(x))，Number('')===0 且
    // Number.isInteger(0)===true，空字符串会被静默当成"成功"处理，绕开全部正向检查
    // （即便日志内容是本该判红的"计数被打丢"样本）。修法：改用严格的十进制整数字符串正则。
    let threw = false;
    try {
      execFileSync('node', [cliPath, path.join(fixturesDir, 'birpc-timeout-empty-counts.ansi.txt'), ''], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    } catch (error) {
      threw = true;
      const err = error as { status?: number; stderr?: string };
      expect(err.status).toBeGreaterThan(0);
      expect(err.stderr ?? '').toContain('status 必须是十进制整数字符串');
    }
    expect(threw).toBe(true);
  });

  it('参数缺失 ⇒ fail-closed 非零退出（不是死代码，真的在校验入参）', () => {
    let threw = false;
    try {
      execFileSync('node', [cliPath], { cwd: repoRoot, encoding: 'utf8' });
    } catch (error) {
      threw = true;
      const err = error as { status?: number };
      expect(err.status).toBeGreaterThan(0);
    }
    expect(threw).toBe(true);
  });

  it('日志文件不可读 ⇒ fail-closed 非零退出', () => {
    let threw = false;
    try {
      execFileSync('node', [cliPath, path.join(fixturesDir, 'does-not-exist.ansi.txt'), '1'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    } catch (error) {
      threw = true;
      const err = error as { status?: number };
      expect(err.status).toBeGreaterThan(0);
    }
    expect(threw).toBe(true);
  });
});
