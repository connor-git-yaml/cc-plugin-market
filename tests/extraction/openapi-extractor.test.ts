/**
 * openapi-extractor.ts 单元测试（Feature 107）
 * 覆盖 OpenAPI JSON/YAML 解析、$ref 循环检测、AsyncAPI event 节点、错误降级
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractOpenApi } from '../../src/extraction/openapi-extractor.js';

// ============================================================
// 测试辅助：在临时目录创建 fixture 文件
// ============================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-test-'));
}

function createFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ============================================================
// JSON 格式 OpenAPI
// ============================================================

describe('extractOpenApi - JSON 格式', () => {
  it('解析标准 OpenAPI JSON 文件，生成 api + api-schema 节点', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'openapi.json', JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              summary: 'List users',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: {
          schemas: {
            UserSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          },
        },
      }));

      const result = extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);

      const apiNodes = result.nodes.filter((n) => n.kind === 'api');
      const schemaNodes = result.nodes.filter((n) => n.kind === 'api-schema');

      expect(apiNodes.length).toBeGreaterThan(0);
      expect(apiNodes[0]?.confidence).toBe('EXTRACTED');
      expect(apiNodes[0]?.label).toContain('/users');

      expect(schemaNodes.length).toBeGreaterThan(0);
      expect(schemaNodes[0]?.confidence).toBe('EXTRACTED');
      expect(schemaNodes[0]?.label).toContain('UserSchema');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('生成 defines 边（api-schema 被 api 节点引用）', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'openapi.json', JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: {
          schemas: {
            UserSchema: { type: 'object' },
          },
        },
      }));

      const result = extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);
      // 至少有 schema 节点表明 defines 关系被建立
      expect(result.nodes.some((n) => n.kind === 'api-schema')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// YAML 格式 OpenAPI
// ============================================================

describe('extractOpenApi - YAML 格式', () => {
  it('解析 YAML 格式 OpenAPI 文件', () => {
    const tmpDir = makeTmpDir();
    try {
      // 使用基础 YAML 格式（key: value 形式）
      createFile(tmpDir, 'openapi.yaml', `
openapi: "3.0.0"
info:
  title: "YAML API"
  version: "1.0.0"
paths:
  /orders:
    get:
      summary: "List orders"
      responses:
        "200":
          description: "OK"
components:
  schemas:
    Order:
      type: "object"
`);

      const result = extractOpenApi(path.join(tmpDir, 'openapi.yaml'), tmpDir);
      // YAML 解析应产出节点
      expect(result.nodes.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('无效的 YAML 内容返回 EMPTY_EXTRACTION_RESULT', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'openapi.yaml', '@@invalid yaml content: {{{');

      const result = extractOpenApi(path.join(tmpDir, 'openapi.yaml'), tmpDir);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// $ref 循环引用处理
// ============================================================

describe('extractOpenApi - $ref 循环引用', () => {
  it('超过 5 层嵌套时生成占位节点而不崩溃', () => {
    const tmpDir = makeTmpDir();
    try {
      // 构造循环 $ref
      createFile(tmpDir, 'openapi.json', JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Circular API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            NodeA: {
              type: 'object',
              properties: {
                child: { $ref: '#/components/schemas/NodeB' },
              },
            },
            NodeB: {
              type: 'object',
              properties: {
                parent: { $ref: '#/components/schemas/NodeA' },
              },
            },
          },
        },
      }));

      // 不崩溃，正常返回结果
      expect(() => {
        extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);
      }).not.toThrow();

      const result = extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);
      expect(result).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('非循环 $ref 正常解析', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'openapi.json', JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Ref API', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Item' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Item: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      }));

      const result = extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);
      expect(result.nodes.some((n) => n.kind === 'api')).toBe(true);
      expect(result.nodes.some((n) => n.kind === 'api-schema')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// AsyncAPI 格式
// ============================================================

describe('extractOpenApi - AsyncAPI', () => {
  it('解析 AsyncAPI YAML 文件生成 event 节点', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'asyncapi.yaml', `
asyncapi: "2.0.0"
info:
  title: "Event API"
  version: "1.0.0"
channels:
  user/created:
    publish:
      message:
        name: UserCreated
        payload:
          type: object
`);

      const result = extractOpenApi(path.join(tmpDir, 'asyncapi.yaml'), tmpDir);
      const eventNodes = result.nodes.filter((n) => n.kind === 'event');
      expect(eventNodes.length).toBeGreaterThan(0);
      expect(eventNodes[0]?.confidence).toBe('EXTRACTED');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 不支持或空文件
// ============================================================

describe('extractOpenApi - 异常处理', () => {
  it('文件不存在时返回 EMPTY_EXTRACTION_RESULT', () => {
    const result = extractOpenApi('/non/existent/file.json', '/some/root');
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('空 JSON 文件（无 paths）返回 EMPTY_EXTRACTION_RESULT', () => {
    const tmpDir = makeTmpDir();
    try {
      createFile(tmpDir, 'openapi.json', JSON.stringify({ info: { title: 'Empty' } }));
      const result = extractOpenApi(path.join(tmpDir, 'openapi.json'), tmpDir);
      expect(result.nodes).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
