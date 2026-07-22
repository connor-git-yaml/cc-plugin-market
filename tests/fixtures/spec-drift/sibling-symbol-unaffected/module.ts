/**
 * check fixture（SC-002）：同文件两个 top-level symbol。
 * 锚定 anchoredSymbol 后改动 siblingSymbol，MUST NOT 误伤本锚。
 */
export function anchoredSymbol(a: number, b: number): number {
  return a + b;
}

export function siblingSymbol(x: number): number {
  return x * 2;
}
