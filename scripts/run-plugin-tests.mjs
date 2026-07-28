#!/usr/bin/env node
// 递归枚举 plugins/spec-driver/tests 下的 *.test.mjs 文件，交给 `node --test` 逐个文件执行。
//
// 背景（F232 fix-report 链 A）：`node --test "<glob>"` 的 glob 展开是 Node 21+ runner 能力，
// CI 固定 Node 20 会把 glob 模式当字面路径（`Could not find '<glob>'` 后 exit 1），
// 导致 13 个文件 / 807 个用例从未在 CI 执行。
// 目录参数写法（`node --test <dir>`）会把 Node 20 的假红翻转成 Node 24 的真红，同样不可取。
// 改为「Node 自己递归枚举出文件列表」后，Node 20 / Node 24 双版本均可跑通全部用例（已实测）。
//
// 枚举写法刻意不传 `withFileTypes`：Dirent 的目录字段跨版本改名（Node 20 只有 `.path`，
// Node 24 已移除 `.path` 只剩 `.parentPath`），不传该选项直接拿相对路径字符串，绕开这一跨版本假设。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const TESTS_ROOT = path.join(REPO_ROOT, 'plugins/spec-driver/tests');

function enumerateTestFiles(root) {
  // recursive: true 需要 Node ≥20.1.0；engines 声明的 >=20.0.0 存在理论缝隙，见 plan.md「已知限界」。
  return readdirSync(root, { recursive: true })
    .filter((rel) => rel.endsWith('.test.mjs'))
    .sort()
    .map((rel) => path.join(root, rel));
}

const testFiles = enumerateTestFiles(TESTS_ROOT);

if (testFiles.length === 0) {
  // 零文件不得静默 exit 0——否则未来测试目录被误挪/改名会让本门禁「悄悄通过」，
  // 正是本次要消灭的失效模式（F201 mjs gate 从落地起就从未真正执行过任何用例）。
  console.error(
    `[run-plugin-tests] 未在 ${TESTS_ROOT} 下枚举到任何 *.test.mjs 文件，判定为失败（而非静默跳过）。`,
  );
  process.exit(1);
}

console.error(`[run-plugin-tests] 枚举到 ${testFiles.length} 个测试文件`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
