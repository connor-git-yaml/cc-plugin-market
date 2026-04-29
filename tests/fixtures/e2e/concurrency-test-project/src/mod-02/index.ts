/**
 * Feature 146 E2E fixture — module 02
 * 独立模块，无外部依赖，用于触发 batch 多模块并发调度
 */
export interface Mod02Input {
  id: string;
  value: number;
}

export function compute02(input: Mod02Input): number {
  return input.value * 2;
}

export function describe02(input: Mod02Input): string {
  return `mod-02:${input.id}=${compute02(input)}`;
}
