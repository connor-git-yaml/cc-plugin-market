/** resolve fixture：exact / levenshtein / ambiguous 命中面 */
export function computeTotal(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function computeAverage(values: number[]): number {
  return computeTotal(values) / values.length;
}
