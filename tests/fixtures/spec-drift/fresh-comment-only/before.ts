// C3 fixture：仅行内 / 块注释差异，MUST 判 fresh（CL-3 / SC-001）
export function anchored(input: number): number {
  // 旧注释
  const doubled = input * 2;
  /* 旧块注释 */
  return doubled;
}
