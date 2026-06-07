// 覆盖相对父级 import（../util.js → ../util.ts）+ 动态 import
import { add } from '../util.js';

export function helper(n: number): number {
  return add(n, n);
}

export async function lazy(): Promise<number> {
  const mod = await import('../util.js');
  return mod.add(1, 2);
}
