// 入口文件 — 同时引用 .mjs 与 .cjs 文件，验证 CRIT-3 v2
// .mjs 通过 ES import；.cjs 通过 require() 引入
import { helloFromMjs } from './lib.mjs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacy = require('./legacy.cjs') as { helloFromCjs: () => string };

export function run(): string {
  return helloFromMjs() + ':' + legacy.helloFromCjs();
}
