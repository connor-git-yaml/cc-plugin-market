// fixture: 混合 default + type-only named 形态（WARN-1 v2）
//   `import Foo, { type Bar } from './foo'` 必须归 'static'（default 是运行时值导入）
import Foo, { type Bar } from './foo';

export type X = Bar;
export const x: typeof Foo = Foo;
