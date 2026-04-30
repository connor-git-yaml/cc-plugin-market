/**
 * ky Retrier — 指数退避重试逻辑。
 */
import type { HttpMethod } from './types.js';

export class Retrier {
  private readonly limit: number;
  private readonly methods: Set<HttpMethod>;
  private attempt: number = 0;

  constructor(limit: number = 2, methods: HttpMethod[] = ['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS']) {
    this.limit = limit;
    this.methods = new Set(methods);
  }

  shouldRetry(method: HttpMethod, error?: Error): boolean {
    if (this.attempt >= this.limit) return false;
    if (!this.methods.has(method)) return false;
    return true;
  }

  async waitBeforeRetry(): Promise<void> {
    this.attempt++;
    const backoffMs = Math.min(1000 * Math.pow(2, this.attempt - 1), 10000);
    return new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  reset(): void {
    this.attempt = 0;
  }
}
