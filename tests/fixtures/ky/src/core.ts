/**
 * ky core — Ky 主类，执行 hooks pipeline + retry 逻辑包裹 fetch。
 */
import type { KyOptions, Hooks } from './types.js';
import { Retrier } from './retrier.js';

export class Ky {
  private readonly url: string;
  private readonly options: KyOptions;
  private readonly retrier: Retrier;

  constructor(url: string, options: KyOptions = {}) {
    this.url = url;
    this.options = options;
    const retryLimit = typeof options.retry === 'number' ? options.retry : (options.retry?.limit ?? 2);
    this.retrier = new Retrier(retryLimit);
  }

  async execute(): Promise<Response> {
    while (true) {
      try {
        const request = await this.applyBeforeRequestHooks();
        let response = await fetch(request);
        response = await this.applyAfterResponseHooks(request, response);
        return response;
      } catch (err) {
        const method = (this.options.method ?? 'GET') as Parameters<Retrier['shouldRetry']>[0];
        if (!this.retrier.shouldRetry(method, err as Error)) {
          throw err;
        }
        await this.retrier.waitBeforeRetry();
      }
    }
  }

  private async applyBeforeRequestHooks(): Promise<Request> {
    const init: RequestInit = {};
    if (this.options.method) init.method = this.options.method;
    if (this.options.body != null) init.body = this.options.body;
    let request = new Request(this.url, init);
    const hooks = this.options.hooks?.beforeRequest ?? [];
    for (const hook of hooks) {
      request = await hook(request);
    }
    return request;
  }

  private async applyAfterResponseHooks(request: Request, response: Response): Promise<Response> {
    const hooks = this.options.hooks?.afterResponse ?? [];
    let current = response;
    for (const hook of hooks) {
      current = await hook(request, current);
    }
    return current;
  }
}
