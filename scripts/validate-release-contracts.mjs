import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateReleaseContract } from './lib/release-contract-core.mjs';
import { validateCodexPluginConsistency } from './lib/codex-plugin-consistency-core.mjs';
import { checkPublishGap } from './lib/publish-gap-check.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const payload = validateReleaseContract(args.projectRoot);

// Feature 213（A1，FR-009）：release:check 薄壳同样直调 codex-plugin-consistency 矩阵，
// 扁平合并进既有 {contractPath, status, checks, errors} 输出结构（不引入嵌套字段，
// 保持既有消费方对该 shape 的假设）；check id 前缀风格对齐 repo-maintenance 的 namespaceCheck。
const codexResult = validateCodexPluginConsistency({ projectRoot: args.projectRoot });
payload.checks = [
  ...(payload.checks ?? []),
  ...codexResult.checks.map((c) => ({ ...c, id: `codex-plugin-consistency:${c.id}` })),
];
payload.errors = [
  ...(payload.errors ?? []),
  ...codexResult.errors.map((e) => `[codex-plugin-consistency] ${e}`),
];
// 矩阵 warnings（如陈旧 waiver 提示）也并入，保持 repo:check / release:check 两链可见性对称。
// validateReleaseContract 自身当前不产出 warnings，缺失时以空数组起底。
payload.warnings = [
  ...(payload.warnings ?? []),
  ...codexResult.warnings.map((w) => `[codex-plugin-consistency] ${w}`),
];
// Feature 265（G0-2，FR-010/FR-013）：第三个合并源——发布断层领先量判据。
// 与上面两个源的关键差异：**只并 checks 与 warnings，绝不并进 payload.errors**。
// checkPublishGap() 的返回值在结构上就没有 errors 键（见该模块顶部的不变量说明），
// 因此本判据无论怎么判都不可能把 release:check 弄红——`prepublishOnly` 串着这条链，
// 判据能变红就等于发布路径被自己堵死。
const publishGapResult = checkPublishGap({ projectRoot: args.projectRoot });
payload.checks = [
  ...(payload.checks ?? []),
  ...publishGapResult.checks.map((c) => ({ ...c, id: `publish-gap:${c.id}` })),
];
payload.warnings = [
  ...(payload.warnings ?? []),
  ...publishGapResult.warnings.map((w) => `[publish-gap] ${w}`),
];

payload.status = payload.errors.length > 0 ? 'fail' : payload.status;

/**
 * warning 的唯一输出出口。
 *
 * Feature 265（对抗审查 W-4）：warning 此前只走 stderr 的一行 `! ...`，而 CI 上
 * 「判据正常且无 warning」与「判据整个坏死」的观感完全一致——两者都是一片绿。
 * GitHub Actions 环境下额外发一条 workflow command，让 warning 出现在 job 的
 * annotation 区，肉眼扫一眼就知道这条链还活着、且它说了什么。
 *
 * 走 stderr 而非 stdout：runner 对两个流一并做 workflow command 解析，而 stdout
 * 必须给 `--json` 模式留作纯 JSON 通道，不能被注解行污染。
 */
function reportWarning(warning) {
  console.warn(`! ${warning}`);
  if (process.env.GITHUB_ACTIONS !== undefined) {
    console.warn(`::warning::${warning}`);
  }
}

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (payload.status === 'pass') {
  console.log(`Release contract valid (${payload.contractPath})`);
  for (const warning of payload.warnings) {
    reportWarning(warning);
  }
} else {
  console.error(`Release contract invalid (${payload.contractPath})`);
  for (const error of payload.errors) {
    console.error(`- ${error}`);
  }
  for (const warning of payload.warnings) {
    reportWarning(warning);
  }
}

if (payload.status !== 'pass') {
  process.exitCode = 1;
}
