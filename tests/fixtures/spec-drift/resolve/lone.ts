/**
 * resolve fixture：文件内只有唯一 symbol。
 *
 * 用途：拼写错误的 file-qualified ref 在此文件上只会产生**单个** levenshtein 候选，
 * 且 levenshtein 层置信度上限（0.75）恒低于 auto-resolve floor（0.9），
 * 因此既不会自动绑定、也不构成多候选 ambiguous —— MUST 落 unresolved。
 */
export function lonelyHelper(input: string): string {
  return input.trim();
}
