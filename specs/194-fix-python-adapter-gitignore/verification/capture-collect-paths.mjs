// 捕获 batch 层两条 skeleton 收集路径的文件集口径（fix 前后对比用，路径 2/3）
// 用法：npx tsx capture-collect-paths.mjs <projectRoot> [--py-only]
import { collectPythonCodeSkeletons, collectTsJsCodeSkeletons } from '../../../src/batch/batch-orchestrator.ts';
import * as path from 'node:path';
const target = process.argv[2];
const pyOnly = process.argv.includes('--py-only');
const rel = (m) => [...m.keys()].map(k => path.relative(path.resolve(target), k).split(path.sep).join('/')).sort();
const py = await collectPythonCodeSkeletons(target);
const out = { target, pyFileCount: py.size, pyFiles: rel(py) };
if (!pyOnly) {
  const ts = await collectTsJsCodeSkeletons(target);
  out.tsJsFileCount = ts.size;
  out.tsJsFiles = rel(ts);
}
console.log(JSON.stringify(out, null, 2));
