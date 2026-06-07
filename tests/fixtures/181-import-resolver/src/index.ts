// 入口：覆盖 ESM ext map（./util.js → util.ts）+ 目录 index 解析（./sub）
import { add } from './util.js';
import { helper } from './sub/index.js';
import type { Shape } from './types.js';

export function main(s: Shape): number {
  return add(helper(s.size), 1);
}
