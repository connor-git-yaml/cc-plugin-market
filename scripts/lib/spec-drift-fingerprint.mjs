/**
 * Spec Drift —— symbol 级内容指纹（C1 **过渡态**实现，plan §7 / FR-003 / FR-009b）。
 *
 * ⚠️ 本阶段迁移自 F189 prototype `fingerprint.ts` 的「symbol 源切片 + 逐行空白归一化」，
 * `NORMALIZATION_PROFILE = 'source-slice-whitespace-v1'`。
 * SC-001 承诺的「注释 / JSDoc / 格式化免疫」是 **C3** 的验收目标，本阶段**尚未成立**：
 * span 内的注释改动此刻仍会判 stale。C3（T031）会把本模块升级为 canonical AST 序列化，
 * 并把 profile bump 为 `ts-morph-canonical-v1`，旧 profile 的锚届时统一转
 * fingerprint-unavailable（不与新算法混合比较）。
 *
 * 依赖方向：叶子模块，MUST NOT import 任何上层 spec-drift 模块（plan §6.2）。
 * ts-morph 是既有 npm 依赖，直接 import（不走 dist 动态加载）。
 */
import { createHash } from 'node:crypto';
import { Project } from 'ts-morph';

/** lock 记录的哈希 schema 版本（粗粒度，FR-009b / plan §7.4） */
export const FINGERPRINT_VERSION = '1';

/** canonical token 产生规则的算法家族版本（C1 过渡态取值） */
export const NORMALIZATION_PROFILE = 'source-slice-whitespace-v1';

/**
 * 逐行空白归一化（不剥注释）：折叠每行内空格 / Tab、去行首尾、丢弃空行，
 * **但保留换行结构**。
 *
 * 保留换行的理由（F189 Codex WARNING-1 的既有结论）：把换行一并折叠会让
 * `return\n1` 与 `return 1` 归一成同一串，而 JS ASI 规则下二者语义不同——
 * 那是「语义变了却判 fresh」的漏报。
 */
export function normalizeWhitespace(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * 按 1-based 闭区间 span 切片源码并计算指纹。
 *
 * span 越界（起止行落在文件之外 / 顺序颠倒）时返回 `null`——调用方 MUST 据此判
 * fingerprint-unavailable，**禁止**静默产出一个基于错误切片的指纹。
 *
 * @param {{sourceText:string, startLine:number, endLine:number}} input
 * @returns {string|null} 形如 `sha256:<hex>`
 */
export function computeCanonicalFingerprint({ sourceText, startLine, endLine }) {
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    return null;
  }
  const lines = sourceText.split('\n');
  // 两端都要判越界：只判 startLine 时 `slice` 会静默截断，
  // 令 `1..999` 与合法的 `1..2` 得到完全相同的哈希（越界被伪装成有效指纹）。
  if (startLine > lines.length || endLine > lines.length) return null;
  const slice = lines.slice(startLine - 1, endLine).join('\n');
  const normalized = normalizeWhitespace(slice);
  return hashCanonicalSequence(normalized);
}

/** 对已归一化的序列做 SHA-256（C3 升级后与 canonical token 序列共用同一出口） */
export function hashCanonicalSequence(sequence) {
  return `sha256:${createHash('sha256').update(sequence, 'utf8').digest('hex')}`;
}

/**
 * 单次运行内共享的 ts-morph Project（只解析目标文件本身，不递归其 import 依赖）。
 */
export function createSharedProject() {
  return new Project({
    skipFileDependencyResolution: true,
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
    compilerOptions: { allowJs: true },
  });
}

/**
 * 显式 parser-health 判定（plan §9.1 步骤 4b）。
 *
 * 只取**语法诊断**：`getSyntacticDiagnostics` 在 API 层即只返回语法类诊断，
 * 因此不需要（也 MUST NOT）用 `getPreEmitDiagnostics()` + `category === Error` 过滤——
 * 实测语法错误(1109) 与纯类型错误(2322) 在后者中同为 category=Error，
 * 按 category 过滤会把「语法完全可解析、只是类型不完整」的文件误判成 parser-degrade。
 *
 * `refresh=true` 时强制从磁盘重读已缓存的 SourceFile：竞态重试路径下文件内容已变，
 * 复用 project 缓存会拿旧文本做诊断（TOCTOU 修复的一部分）。
 *
 * @returns {{ok:true, hasErrors:boolean} | {ok:false, reason:string}}
 */
export function hasSyntacticErrors(project, absFilePath, { refresh = false } = {}) {
  try {
    let sourceFile = project.getSourceFile(absFilePath);
    if (sourceFile !== undefined && refresh) sourceFile.refreshFromFileSystemSync();
    sourceFile = sourceFile ?? project.addSourceFileAtPath(absFilePath);
    const diagnostics = project
      .getProgram()
      .compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode);
    return { ok: true, hasErrors: diagnostics.length > 0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
