/**
 * 敏感信息检测与脱敏（FR-027）
 * 正则模式匹配 + Shannon 熵分析 + 语义占位符脱敏
 * 参见 research R4
 */
import { createHash } from 'node:crypto';
import type { RedactionResult, SecretDetection } from '../models/module-spec.js';

// ============================================================
// 检测模式定义
// ============================================================

interface DetectionPattern {
  type: string;
  pattern: RegExp;
  confidence: 'high' | 'medium' | 'low';
  placeholder: string;
}

/** 高置信度模式 — 始终脱敏 */
const HIGH_CONFIDENCE_PATTERNS: DetectionPattern[] = [
  {
    type: 'AWS_ACCESS_KEY_ID',
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: 'high',
    placeholder: '[REDACTED_AWS_ACCESS_KEY_ID]',
  },
  {
    type: 'AWS_SECRET_ACCESS_KEY',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/g,
    confidence: 'high',
    placeholder: '[REDACTED_AWS_SECRET_KEY]',
  },
  {
    type: 'GCP_API_KEY',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    confidence: 'high',
    placeholder: '[REDACTED_GCP_API_KEY]',
  },
  {
    type: 'JWT_TOKEN',
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+/g,
    confidence: 'high',
    placeholder: '[REDACTED_JWT_TOKEN]',
  },
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |PGP )?PRIVATE KEY-----/g,
    confidence: 'high',
    placeholder: '[REDACTED_PRIVATE_KEY]',
  },
  {
    type: 'GITHUB_TOKEN',
    pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g,
    confidence: 'high',
    placeholder: '[REDACTED_GITHUB_TOKEN]',
  },
];

/** 中等置信度模式 — 脱敏 + 警告 */
const MEDIUM_CONFIDENCE_PATTERNS: DetectionPattern[] = [
  {
    type: 'DATABASE_URL',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s'"]+/g,
    confidence: 'medium',
    placeholder: '[REDACTED_DATABASE_URL]',
  },
  {
    type: 'GENERIC_API_KEY',
    pattern: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token)\s*[=:]\s*['"]([A-Za-z0-9\-_]{20,})['"]?/gi,
    confidence: 'medium',
    placeholder: '[REDACTED_API_KEY]',
  },
  {
    type: 'BEARER_TOKEN',
    pattern: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/g,
    confidence: 'medium',
    placeholder: '[REDACTED_BEARER_TOKEN]',
  },
];

/** 已知的占位符值（不视为敏感信息） */
const KNOWN_PLACEHOLDERS = new Set([
  'your-key-here',
  'your-api-key',
  'your_api_key',
  'example',
  'test',
  'dummy',
  'placeholder',
  'xxx',
  'changeme',
  'INSERT_KEY_HERE',
  'TODO',
  'FIXME',
]);

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算 Shannon 熵
 * 熵 < 3.5 判定为假阳性（太可预测）
 */
function shannonEntropy(str: string): number {
  if (!str) return 0;

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * 判断是否为已知占位符
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return KNOWN_PLACEHOLDERS.has(lower) || /^(test|example|dummy|mock|fake)/i.test(lower);
}

/**
 * 判断是否在测试文件中
 */
function isTestFile(filePath?: string): boolean {
  if (!filePath) return false;
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) ||
    filePath.includes('__tests__') ||
    filePath.includes('/test/') ||
    filePath.includes('/tests/');
}

/**
 * 获取匹配值在文本中的行号
 */
function getLineNumber(content: string, matchIndex: number): number {
  let line = 1;
  for (let i = 0; i < matchIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 扫描内容中的敏感信息并替换为语义占位符
 *
 * @param content - 待扫描的源代码字符串
 * @param filePath - 可选的文件路径，用于上下文感知过滤
 * @returns RedactionResult
 */
export function redact(content: string, filePath?: string): RedactionResult {
  const originalHash = createHash('sha256').update(content).digest('hex');
  const detections: SecretDetection[] = [];
  let falsePositivesFiltered = 0;
  let redactedContent = content;

  const isTest = isTestFile(filePath);
  const allPatterns = [...HIGH_CONFIDENCE_PATTERNS, ...MEDIUM_CONFIDENCE_PATTERNS];

  for (const { type, pattern, confidence, placeholder } of allPatterns) {
    // 重置正则状态（因为使用了 /g 标志）
    const regex = new RegExp(pattern.source, pattern.flags);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const matchedValue = match[1] ?? match[0]; // 优先取捕获组

      // 误报过滤第 1 层：已知占位符
      if (isPlaceholder(matchedValue)) {
        falsePositivesFiltered++;
        continue;
      }

      // 误报过滤第 2 层：Shannon 熵检查（仅对 medium 置信度）
      if (confidence === 'medium' && shannonEntropy(matchedValue) < 3.5) {
        falsePositivesFiltered++;
        continue;
      }

      // 误报过滤第 3 层：测试文件使用宽松规则（medium 不脱敏）
      if (isTest && confidence === 'medium') {
        falsePositivesFiltered++;
        continue;
      }

      const line = getLineNumber(content, match.index);

      detections.push({
        type,
        line,
        confidence,
        placeholder,
      });

      // 替换匹配内容
      redactedContent = redactedContent.replace(match[0], placeholder);
    }
  }

  return {
    originalHash,
    redactedContent,
    detections,
    falsePositivesFiltered,
  };
}
