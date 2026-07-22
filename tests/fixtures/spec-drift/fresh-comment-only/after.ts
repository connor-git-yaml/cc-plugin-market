// C3 fixture：仅行内 / 块注释差异，MUST 判 fresh（CL-3 / SC-001）
export function anchored(input: number): number {
  // 全新的注释文案，与旧版毫无关系
  const doubled = input * 2;
  /* 另一段完全不同的块注释
     甚至跨了多行 */
  return doubled;
}
