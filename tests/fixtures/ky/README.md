# ky (fixture snapshot)

Tiny & elegant HTTP client based on the browser Fetch API. Provides a hooks pipeline
to extend request lifecycle, retry support, JSON parsing, and timeouts.

## Core Abstractions

- `Ky` — main client class wrapping fetch with extensions
- `KyOptions` — request configuration including hooks, retry, timeout
- `Hooks` — array of pre-request, post-response, and error handlers
- `Retrier` — exponential backoff retry logic

## Architectural Decisions

- 请求生命周期通过 **hooks pipeline** 扩展，每个 hook 处理一个独立关注点
  （beforeRequest / afterResponse / beforeRetry / beforeError）
- 不依赖任何 polyfill — 纯 Fetch API，浏览器兼容性由调用方负责
- TypeScript 严格模式 — 所有 public API 都有完整类型签名
