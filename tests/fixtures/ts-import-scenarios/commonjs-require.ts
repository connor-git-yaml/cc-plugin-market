// fixture: CommonJS require() 调用（FR-28 / AC-11 CRIT-2 补充，importType='commonjs-require'）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const baz = require('./baz');

export const useBaz = () => baz;
