import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateReleaseContract } from './lib/release-contract-core.mjs';
import { validateCodexPluginConsistency } from './lib/codex-plugin-consistency-core.mjs';

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
payload.status = payload.errors.length > 0 ? 'fail' : payload.status;

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (payload.status === 'pass') {
  console.log(`Release contract valid (${payload.contractPath})`);
  for (const warning of payload.warnings) {
    console.warn(`! ${warning}`);
  }
} else {
  console.error(`Release contract invalid (${payload.contractPath})`);
  for (const error of payload.errors) {
    console.error(`- ${error}`);
  }
  for (const warning of payload.warnings) {
    console.warn(`! ${warning}`);
  }
}

if (payload.status !== 'pass') {
  process.exitCode = 1;
}
