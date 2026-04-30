/**
 * ky type definitions — KyOptions / Hooks 接口契约。
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface BeforeRequestHook {
  (request: Request): Request | Promise<Request>;
}

export interface AfterResponseHook {
  (request: Request, response: Response): Response | Promise<Response>;
}

export interface Hooks {
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
}

export interface KyOptions {
  method?: HttpMethod;
  body?: BodyInit | null;
  json?: unknown;
  hooks?: Hooks;
  timeout?: number;
  retry?: number | { limit: number; methods?: HttpMethod[] };
}
