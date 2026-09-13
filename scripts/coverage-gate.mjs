import fs from 'node:fs';
import process from 'node:process';
import { judgeCoverageLog } from './lib/coverage-gate-core.mjs';

// F292：CI coverage 判定器 CLI 薄壳。
//
// 用法：node scripts/coverage-gate.mjs <logPath> <status>
// - logPath：`npm run test:coverage` 重定向落盘的日志文件路径
// - status：`test:coverage` 命令自身的退出码（字符串数字）
//
// 只会被 CI 直接 `node` 调用，不会被任何模块 import——不带
// `scripts/lib/is-invoked-directly.mjs` guard（该 helper 用于同一文件既可
// import 又可直接执行的双重身份场景，本文件与 coverage-gate-core.mjs 已物理
// 拆分，不存在这个问题；见 plan.md §决策1）。
//
// fail-closed：参数缺失 / status 非整数 / 日志不可读，一律非零退出并打印原因，
// 判定器自身出问题时绝不能表现成「放行」。

const [, , logPath, statusArg] = process.argv;

if (!logPath || statusArg === undefined) {
  console.error('[coverage-gate] 用法: node scripts/coverage-gate.mjs <logPath> <status>');
  process.exit(2);
}

// 对抗审查发现：`Number.isInteger(Number(x))` 对空字符串/纯空白串会误判为合法（`Number('')===0`），
// 静默把「退出码未知」当成「成功」处理，绕开全部正向检查——用严格的整数字符串正则替代，
// 拒绝空串、纯空白串、十六进制字面量等一切非「十进制整数」形态。
if (!/^-?\d+$/.test(statusArg.trim())) {
  console.error(`[coverage-gate] status 必须是十进制整数字符串，得到: ${JSON.stringify(statusArg)}`);
  process.exit(2);
}
const status = Number(statusArg.trim());

let log;
try {
  log = fs.readFileSync(logPath, 'utf8');
} catch (error) {
  console.error(`[coverage-gate] 无法读取日志文件 ${logPath}: ${error.message}`);
  process.exit(2);
}

const result = judgeCoverageLog({ log, status });

// 结构化摘录：Actions 日志里可直接看到判定用到的证据，不再依赖 `tail -n 40`。
console.log(`[coverage-gate] verdict=${result.verdict} exitCode=${result.exitCode}`);
console.log(`[coverage-gate] status(from test:coverage)=${status}`);
console.log(`[coverage-gate] Test Files 行: ${JSON.stringify(result.evidence.testFilesLine)}`);
console.log(`[coverage-gate] Tests 行: ${JSON.stringify(result.evidence.testsLine)}`);
console.log(
  `[coverage-gate] Errors 行: ${JSON.stringify(result.evidence.errorsLine)}  birpcTimeoutTitles=${result.evidence.signatureCount ?? 'n/a'}`,
);
console.log('[coverage-gate] reasons:');
for (const reason of result.reasons) {
  console.log(`  - ${reason}`);
}

process.exit(result.exitCode);
