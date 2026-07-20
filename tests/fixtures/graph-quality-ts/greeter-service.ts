/**
 * F217 T041 — TS/JS mini fixture 源码。
 *
 * 遵循 plan.md 决策 6 逐语言 fixture 合同表（TS/JS 行）：
 * - ≥1 个 module 级自由函数（formatGreeting）
 * - ≥1 个 class 含 ≥2 member（GreeterService：greet / buildMessage）
 * - ≥1 个 interface（GreetingOptions）
 * - ≥1 个 type 声明（GreetingResult）
 * - class 内方法间至少 1 条可被 AST 解析的调用关系（greet 调用 buildMessage），
 *   驱动 calls 边非空
 */

export interface GreetingOptions {
  loud?: boolean;
}

export type GreetingResult = {
  message: string;
};

export function formatGreeting(name: string, options: GreetingOptions = {}): string {
  const base = `Hello, ${name}!`;
  return options.loud ? base.toUpperCase() : base;
}

export class GreeterService {
  private lastMessage = '';

  greet(name: string): GreetingResult {
    const message = this.buildMessage(name);
    this.lastMessage = message;
    return { message };
  }

  private buildMessage(name: string): string {
    return formatGreeting(name);
  }
}
