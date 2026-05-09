// AC-11 4 类 import 验收 fixture
//   1. static    : import ... from
//   2. dynamic   : await import(...)
//   3. type-only : import type ... from
//   4. commonjs-require : require(...)

import { staticHello } from './static-target';
import type { TypeOnlyShape } from './type-only-target';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cjs = require('./cjs-target.cjs') as { cjsHello: () => string };

export async function run(): Promise<string> {
  const dyn = await import('./dynamic-target');
  const shape: TypeOnlyShape = { kind: 'type-only', value: 'v' };
  return [staticHello(), dyn.dynamicHello(), shape.value, cjs.cjsHello()].join(':');
}
