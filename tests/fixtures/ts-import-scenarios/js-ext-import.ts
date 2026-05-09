// fixture: TS ESM 惯例 — `import './foo.js'` 实际指向 './foo.ts'（CRIT-1 v2）
import { foo } from './foo.js';

export const useFoo = () => foo;
