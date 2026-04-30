/**
 * ky public API — single entry point.
 */
import { Ky } from './core.js';
import type { KyOptions, HttpMethod } from './types.js';

export type { KyOptions, Hooks, HttpMethod, BeforeRequestHook, AfterResponseHook } from './types.js';
export { Ky };
export { Retrier } from './retrier.js';

/**
 * Convenience function — `ky('https://example.com', { method: 'POST' })`
 */
export async function ky(url: string, options?: KyOptions): Promise<Response> {
  const client = new Ky(url, options);
  return client.execute();
}

ky.get = (url: string, options?: Omit<KyOptions, 'method'>) => ky(url, { ...options, method: 'GET' });
ky.post = (url: string, options?: Omit<KyOptions, 'method'>) => ky(url, { ...options, method: 'POST' });
