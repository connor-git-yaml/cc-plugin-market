/**
 * 文件制品分类器（Feature 107）
 * 根据文件扩展名和路径规则判断文件类型，支持敏感文件过滤
 * 参考 Graphify detect.py 的文件分类策略
 */
import * as path from 'node:path';
import type { ArtifactKind } from './extraction-types.js';

// ============================================================
// 路径扫描排除规则（硬编码边界）
// ============================================================

/** 永远跳过的目录前缀（与 projectRoot 无关，基于路径片段匹配） */
export const EXCLUDED_DIR_SEGMENTS = new Set(['node_modules', 'dist', '.git', 'specs']);

// ============================================================
// 扩展名映射
// ============================================================

/** Markdown 文档扩展名 → document */
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx']);

/** API 规范扩展名 → api-spec（须配合文件名模式过滤） */
const API_SPEC_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

/** 支持的图像扩展名 → image（仅 PNG/JPG/JPEG/SVG，其余跳过） */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg']);

// ============================================================
// 敏感文件模式（参考 Graphify detect.py::_is_sensitive()）
// ============================================================

/**
 * 敏感文件名正则列表
 * 匹配 .env 系列、私钥、证书、密钥文件等
 */
const SENSITIVE_FILENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,           // .env, .env.local, .env.production 等
  /\.(pem|key|crt|cer|pfx|p12|p8)$/i,  // 证书和私钥
  /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/i,  // SSH 密钥
  /^credentials(\..+)?$/i,     // credentials 文件
  /^secret(\..+)?$/i,          // secret 文件
  /\.keystore$/i,              // Java KeyStore
  /\.jks$/i,                   // Java KeyStore 别名
];

// ============================================================
// 公开 API
// ============================================================

/**
 * 判断文件是否在排除目录中（不应扫描）
 * 检查路径中所有片段，匹配到任意排除目录即返回 true
 */
function isInExcludedDir(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments.some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

/**
 * 判断文件是否为敏感文件（应跳过处理）
 * 仅匹配文件名部分，路径无关
 *
 * @param filePath - 文件路径（绝对或相对）
 * @returns 是否为敏感文件
 */
export function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

/**
 * 判断文件是否应被扫描为 API 规范
 * 除了扩展名匹配，还要求文件名包含 openapi / swagger / asyncapi 关键字
 * 避免将普通 JSON/YAML 配置文件误判为 API 规范
 */
function isApiSpecFile(filePath: string): boolean {
  if (!API_SPEC_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return false;
  }
  const basename = path.basename(filePath).toLowerCase();
  return (
    basename.includes('openapi') ||
    basename.includes('swagger') ||
    basename.includes('asyncapi')
  );
}

/**
 * 对文件路径进行制品类型分类
 *
 * @param filePath - 文件路径（绝对或相对）
 * @returns ArtifactKind（文件类型），或 null（不支持/应跳过）
 */
export function classifyFile(filePath: string): ArtifactKind | null {
  // 排除目录边界检查（specs/、node_modules/、dist/、.git/）
  if (isInExcludedDir(filePath)) {
    return null;
  }

  // 敏感文件跳过
  if (isSensitiveFile(filePath)) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();

  // Markdown 文档
  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return 'document';
  }

  // API 规范（需文件名关键字匹配）
  if (isApiSpecFile(filePath)) {
    return 'api-spec';
  }

  // 图像
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }

  return null;
}
