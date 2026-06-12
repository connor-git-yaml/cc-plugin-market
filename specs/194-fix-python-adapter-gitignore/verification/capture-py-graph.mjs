// 捕获 PythonLanguageAdapter 在目标项目上的 module graph / 符号提取口径（fix 前后对比用）
// 用法：npx tsx specs/194-fix-python-adapter-gitignore/verification/capture-py-graph.mjs <projectRoot>
import { PythonLanguageAdapter } from '../../../src/adapters/python-adapter.ts';
const target = process.argv[2];
const adapter = new PythonLanguageAdapter();
const graph = await adapter.buildModuleGraph(target);
const symbols = await adapter.extractSymbolNodes(target);
const out = {
  target,
  moduleCount: graph.modules.length,
  moduleSources: graph.modules.map(m => m.source).sort(),
  edgeCount: graph.dependencies?.length ?? graph.edges?.length ?? null,
  symbolResultCount: symbols.length,
  symbolFiles: symbols.map(r => r.nodes.find(n => n.kind === 'module')?.id ?? '?').sort(),
};
console.log(JSON.stringify(out, null, 2));
