// 演示 baseUrl + 多候选 paths（CRIT-2 v2 fixture）
// (a) `@app/lib-only` 仅落在 packages/lib/src/lib-only.ts —— 多候选 alias 第二个候选命中
// (b) `@app/utils/format` 命中更长前缀 `@app/utils/*`（最长前缀优先）
import { libOnly } from '@app/lib-only';
import { format } from '@app/utils/format';

// (c) baseUrl 解析：specifier 不带相对前缀且无 alias 命中，按 baseUrl + specifier 解析
//     `packages/app/src/local` 在 baseUrl=. 下解析为 ./packages/app/src/local.ts
import { localFn } from 'packages/app/src/local';

export function entry(): string {
  return [libOnly(), format('x'), localFn()].join('|');
}
