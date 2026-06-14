// F189 prototype 锚定 fixture —— 两个 top-level export，用于演示 symbol 级 drift。
// 此文件是 demo 的「原始」基线；demo 会把它 + 若干变体写到 tmpdir 后再分析，
// 不在仓库内做任何原地改动。

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < b; i++) {
    result = result + a;
  }
  return result;
}
