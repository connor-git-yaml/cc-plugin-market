// fixture: 跨行 import——from 与 specifier 分处不同行
import { a, b, c } from
  '../lib/foo.mjs';

export function noop() {
  return a + b + c;
}
