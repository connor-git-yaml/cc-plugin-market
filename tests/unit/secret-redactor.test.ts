/**
 * secret-redactor 单元测试
 * 验证 AWS/GCP/JWT/私钥检测、脱敏替换、误报过滤、测试文件宽松规则
 */
import { describe, it, expect } from 'vitest';
import { redact } from '../../src/core/secret-redactor.js';

describe('secret-redactor', () => {
  describe('高置信度检测', () => {
    it('应检测并脱敏 AWS Access Key', () => {
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE";';
      const result = redact(content);

      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]!.type).toBe('AWS_ACCESS_KEY_ID');
      expect(result.detections[0]!.confidence).toBe('high');
      expect(result.redactedContent).toContain('[REDACTED_AWS_ACCESS_KEY_ID]');
      expect(result.redactedContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('应检测并脱敏 GCP API Key', () => {
      const content = 'const gcp = "AIzaSyA1234567890abcdefghijklmnopqrstuvw";';
      const result = redact(content);

      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]!.type).toBe('GCP_API_KEY');
      expect(result.redactedContent).toContain('[REDACTED_GCP_API_KEY]');
    });

    it('应检测并脱敏 JWT Token', () => {
      const content =
        'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";';
      const result = redact(content);

      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]!.type).toBe('JWT_TOKEN');
      expect(result.redactedContent).toContain('[REDACTED_JWT_TOKEN]');
    });

    it('应检测并脱敏 Private Key', () => {
      const content = `const key = \`-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2mX3...
-----END RSA PRIVATE KEY-----\`;`;
      const result = redact(content);

      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]!.type).toBe('PRIVATE_KEY');
      expect(result.redactedContent).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('应检测 GitHub Token', () => {
      const content = 'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";';
      const result = redact(content);

      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]!.type).toBe('GITHUB_TOKEN');
    });
  });

  describe('中等置信度检测', () => {
    it('应检测数据库连接串', () => {
      const content = 'const db = "postgres://admin:secret123@db.example.com/mydb";';
      const result = redact(content);

      expect(result.detections.some((d) => d.type === 'DATABASE_URL')).toBe(true);
      expect(result.redactedContent).toContain('[REDACTED_DATABASE_URL]');
    });
  });

  describe('误报过滤', () => {
    it('应过滤已知占位符', () => {
      // api_key 匹配 GENERIC_API_KEY 模式，但值为已知占位符
      const content = 'const api_key = "your-key-here";';
      const result = redact(content);

      // 不应产生检测结果（被过滤为误报）
      expect(result.detections.filter((d) => d.type === 'GENERIC_API_KEY')).toHaveLength(0);
    });

    it('测试文件中的 medium 置信度应被过滤', () => {
      const content = 'const db = "postgres://test:test123@localhost/testdb";';
      const result = redact(content, 'src/__tests__/db.test.ts');

      // medium 置信度在测试文件中不脱敏
      const mediumDetections = result.detections.filter(
        (d) => d.confidence === 'medium',
      );
      expect(mediumDetections).toHaveLength(0);
    });
  });

  describe('输出完整性', () => {
    it('应包含原始内容哈希', () => {
      const content = 'no secrets here';
      const result = redact(content);

      expect(result.originalHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('无敏感信息时应返回原始内容', () => {
      const content = 'export function hello(): string { return "world"; }';
      const result = redact(content);

      expect(result.redactedContent).toBe(content);
      expect(result.detections).toHaveLength(0);
    });

    it('应正确报告行号', () => {
      const content = [
        'const a = 1;',
        'const b = 2;',
        'const key = "AKIAIOSFODNN7EXAMPLE";',
        'const c = 3;',
      ].join('\n');
      const result = redact(content);

      expect(result.detections[0]!.line).toBe(3);
    });

    it('应检测同一文件中的多个敏感信息', () => {
      const content = [
        'const aws = "AKIAIOSFODNN7EXAMPLE";',
        'const gcp = "AIzaSyA1234567890abcdefghijklmnopqrstuvw";',
      ].join('\n');
      const result = redact(content);

      expect(result.detections.length).toBeGreaterThanOrEqual(2);
    });
  });
});
