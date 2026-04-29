/**
 * Feature 146 E2E fixture — module 04
 * 独立模块，无外部依赖，用于触发 batch 多模块并发调度
 */
export interface Mod04Input {
  id: string;
  value: number;
}

export function compute04(input: Mod04Input): number {
  return input.value * 4;
}

export function describe04(input: Mod04Input): string {
  return `mod-04:${input.id}=${compute04(input)}`;
}
