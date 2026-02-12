/**
 * 三阶段流水线端到端集成测试
 * 验证骨架准确性、上下文预算、只读安全性（SC-002, FR-023, FR-024）
 *
 * 注：此测试不调用真实 LLM API，仅验证流水线的非 LLM 阶段
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { analyzeFile, resetProject } from '../../src/core/ast-analyzer.js';
import { redact } from '../../src/core/secret-redactor.js';
import { assembleContext } from '../../src/core/context-assembler.js';
import { parseLLMResponse, buildSystemPrompt } from '../../src/core/llm-client.js';
import { generateFrontmatter } from '../../src/generator/frontmatter.js';
import { generateClassDiagram } from '../../src/generator/mermaid-class-diagram.js';
import { initRenderer, renderSpec, resetRenderer } from '../../src/generator/spec-renderer.js';
import { scanFiles } from '../../src/utils/file-scanner.js';

/** 测试 fixture 目录 */
let fixtureDir: string;

/** 创建测试 fixture */
function setupFixtures(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));

  // 创建一个典型的 TypeScript 模块
  fs.writeFileSync(
    path.join(dir, 'user-service.ts'),
    `
/**
 * 用户服务模块
 * 管理用户的创建、查询和更新
 */
import { EventEmitter } from 'node:events';

/** 用户数据结构 */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

/** 用户创建参数 */
export interface CreateUserInput {
  name: string;
  email: string;
}

/** 用户服务 */
export class UserService extends EventEmitter {
  private users: Map<string, User> = new Map();

  /** 创建新用户 */
  public createUser(input: CreateUserInput): User {
    const user: User = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    this.emit('user:created', user);
    return user;
  }

  /** 按 ID 查询用户 */
  public getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  /** 获取所有用户 */
  public listUsers(): User[] {
    return Array.from(this.users.values());
  }

  /** 删除用户 */
  public deleteUser(id: string): boolean {
    const deleted = this.users.delete(id);
    if (deleted) {
      this.emit('user:deleted', id);
    }
    return deleted;
  }
}

/** 工厂函数 */
export function createUserService(): UserService {
  return new UserService();
}

/** 导出类型别名 */
export type UserList = User[];
`.trim(),
  );

  // 创建一个包含敏感信息的文件
  fs.writeFileSync(
    path.join(dir, 'config.ts'),
    `
export const config = {
  apiKey: "AKIAIOSFODNN7EXAMPLE",
  dbUrl: "postgres://admin:secret@db.example.com/mydb",
  port: 3000,
};
`.trim(),
  );

  return dir;
}

describe('三阶段流水线集成测试', () => {
  beforeAll(() => {
    fixtureDir = setupFixtures();
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    resetProject();
    resetRenderer();
  });

  it('阶段 1：AST 分析应正确提取 CodeSkeleton', async () => {
    const skeleton = await analyzeFile(path.join(fixtureDir, 'user-service.ts'));

    // 应提取所有导出
    expect(skeleton.exports.length).toBeGreaterThanOrEqual(4);

    // 检查具体的导出
    const userInterface = skeleton.exports.find((e) => e.name === 'User');
    expect(userInterface).toBeDefined();
    expect(userInterface!.kind).toBe('interface');

    const userService = skeleton.exports.find((e) => e.name === 'UserService');
    expect(userService).toBeDefined();
    expect(userService!.kind).toBe('class');
    expect(userService!.members).toBeDefined();
    expect(userService!.members!.length).toBeGreaterThanOrEqual(3);

    const factory = skeleton.exports.find((e) => e.name === 'createUserService');
    expect(factory).toBeDefined();
    expect(factory!.kind).toBe('function');

    // 签名应来自 AST（Constitution I）
    expect(userService!.signature).toContain('UserService');
    expect(factory!.signature).toContain('createUserService');

    // 元数据
    expect(skeleton.parserUsed).toBe('ts-morph');
    expect(skeleton.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(skeleton.loc).toBeGreaterThan(0);
  });

  it('阶段 1：敏感信息脱敏应正确工作', () => {
    const content = fs.readFileSync(
      path.join(fixtureDir, 'config.ts'),
      'utf-8',
    );
    const result = redact(content);

    // 应检测到 AWS 密钥
    expect(result.detections.length).toBeGreaterThan(0);
    expect(result.redactedContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.redactedContent).toContain('[REDACTED_');
    // 代码结构应保留
    expect(result.redactedContent).toContain('apiKey');
    expect(result.redactedContent).toContain('port: 3000');
  });

  it('阶段 2：上下文组装应在预算内', async () => {
    const skeleton = await analyzeFile(path.join(fixtureDir, 'user-service.ts'));
    const result = await assembleContext(skeleton, {
      maxTokens: 100_000,
      templateInstructions: buildSystemPrompt('spec-generation'),
    });

    // 不应超出预算
    expect(result.tokenCount).toBeLessThan(100_000);
    // 不应被裁剪
    expect(result.truncated).toBe(false);
    // 应包含骨架信息
    expect(result.prompt).toContain('UserService');
    expect(result.prompt).toContain('createUser');
  });

  it('阶段 3：LLM 响应解析应正确提取章节', () => {
    // 模拟 LLM 响应
    const mockResponse = `## 1. 意图
用户服务模块，管理用户的 CRUD 操作。

## 2. 接口定义
- \`User\` 接口：用户数据结构
- \`UserService\` 类：提供 createUser、getUser、listUsers、deleteUser 方法

## 3. 业务逻辑
通过 Map 存储用户数据，创建时分配 UUID，删除时发送事件。

## 4. 数据结构
User 包含 id、name、email、createdAt 字段。

## 5. 约束条件
内存存储，无持久化。

## 6. 边界条件
getUser 对不存在的 ID 返回 undefined。

## 7. 技术债务
[推断: 基于代码分析] 缺少输入验证，无并发保护。

## 8. 测试覆盖
未发现测试文件。

## 9. 依赖关系
依赖 node:events 的 EventEmitter。`;

    const parsed = parseLLMResponse(mockResponse);

    // 9 个章节应全部提取
    expect(parsed.sections.intent).toContain('用户服务');
    expect(parsed.sections.interfaceDefinition).toContain('UserService');
    expect(parsed.sections.businessLogic).toContain('Map');
    expect(parsed.sections.dataStructures).toContain('User');
    expect(parsed.sections.constraints).toContain('内存');
    expect(parsed.sections.edgeCases).toContain('undefined');
    expect(parsed.sections.technicalDebt).toContain('验证');
    expect(parsed.sections.testCoverage).toContain('测试');
    expect(parsed.sections.dependencies).toContain('EventEmitter');

    // 不确定性标记应被提取
    expect(parsed.uncertaintyMarkers).toHaveLength(1);
    expect(parsed.uncertaintyMarkers[0]!.type).toBe('推断');

    // 无解析警告
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('阶段 3：Spec 渲染应生成完整 Markdown', async () => {
    initRenderer();
    const skeleton = await analyzeFile(path.join(fixtureDir, 'user-service.ts'));

    const frontmatter = generateFrontmatter({
      sourceTarget: 'src/user-service',
      relatedFiles: ['user-service.ts'],
      confidence: 'high',
      skeletonHash: skeleton.hash,
    });

    const classDiagram = generateClassDiagram(skeleton);

    const moduleSpec = {
      frontmatter,
      sections: {
        intent: '用户服务模块',
        interfaceDefinition: '导出 UserService 类',
        businessLogic: 'CRUD 操作',
        dataStructures: 'User 接口',
        constraints: '内存存储',
        edgeCases: 'ID 不存在返回 undefined',
        technicalDebt: '缺少验证',
        testCoverage: '无测试',
        dependencies: 'node:events',
      },
      mermaidDiagrams: classDiagram
        ? [{ type: 'classDiagram' as const, source: classDiagram, title: '类图' }]
        : undefined,
      fileInventory: [{ path: 'user-service.ts', loc: skeleton.loc, purpose: '用户服务' }],
      baselineSkeleton: skeleton,
      outputPath: 'specs/user-service.spec.md',
    };

    const markdown = renderSpec(moduleSpec);

    // 验证输出结构
    expect(markdown).toContain('type: module-spec');
    expect(markdown).toContain('## 1. 意图');
    expect(markdown).toContain('## 2. 接口定义');
    expect(markdown).toContain('## 9. 依赖关系');
    expect(markdown).toContain('附录：文件清单');
    // 基线骨架应作为 HTML 注释嵌入
    expect(markdown).toContain('<!-- baseline-skeleton:');
    // Mermaid 图表（如果有类导出）
    if (classDiagram) {
      expect(markdown).toContain('```mermaid');
    }
  });

  it('只读安全性：源文件不应被修改（FR-023）', async () => {
    // 记录源文件的 hash 快照
    const sourceFile = path.join(fixtureDir, 'user-service.ts');
    const originalContent = fs.readFileSync(sourceFile, 'utf-8');
    const originalHash = createHash('sha256').update(originalContent).digest('hex');

    // 运行流水线阶段
    const skeleton = await analyzeFile(sourceFile);
    redact(originalContent, sourceFile);
    await assembleContext(skeleton);

    // 验证源文件未被修改
    const afterContent = fs.readFileSync(sourceFile, 'utf-8');
    const afterHash = createHash('sha256').update(afterContent).digest('hex');
    expect(afterHash).toBe(originalHash);
  });

  it('文件扫描应正确发现 TS 文件', () => {
    const result = scanFiles(fixtureDir);
    expect(result.files).toContain('user-service.ts');
    expect(result.files).toContain('config.ts');
    expect(result.files.length).toBe(2);
  });

  it('Mermaid 类图应正确生成', async () => {
    const skeleton = await analyzeFile(path.join(fixtureDir, 'user-service.ts'));
    const diagram = generateClassDiagram(skeleton);

    expect(diagram).toContain('classDiagram');
    expect(diagram).toContain('UserService');
    // 接口应有 <<interface>> 构造型
    if (diagram.includes('User')) {
      expect(diagram).toContain('<<interface>>');
    }
  });
});
