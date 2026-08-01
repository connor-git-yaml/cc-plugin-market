// fixture: specifier 行内含注释——注释里提到的伪 specifier 不得被计入
import x from '../lib/foo.mjs'; // 提到 import '../fake.mjs' 的注释

export const y = x;
