/**
 * llm-enricher 单元测试
 *
 * 覆盖：
 * - enrichFieldDescriptions: 正常增强、保留人工注释、空数据、[AI] 前缀不叠加
 * - enrichConfigDescriptions: 正常增强、保留已有 description、空数据
 * - 降级测试: LLM 不可用、LLM 调用异常、部分批次失败
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataModel } from '../../../src/panoramic/data-model-generator.js';
import type { ConfigFileResult } from '../../../src/panoramic/config-reference-generator.js';

// mock 依赖模块（vi.mock 会被 vitest 提升到文件顶部）
vi.mock('../../../src/auth/auth-detector.js');
vi.mock('@anthropic-ai/sdk');
vi.mock('../../../src/auth/cli-proxy.js');

// 在 vi.mock 之后 import，这些是已被 mock 的模块
import { detectAuth } from '../../../src/auth/auth-detector.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  enrichFieldDescriptions,
  enrichConfigDescriptions,
} from '../../../src/panoramic/utils/llm-enricher.js';

// 获取 mock 引用
const mockDetectAuth = vi.mocked(detectAuth);

// 用于控制 Anthropic SDK mock 的 messages.create
let mockMessagesCreate: ReturnType<typeof vi.fn>;

// ============================================================
// 辅助函数
// ============================================================

/** 构造一个包含空 description 字段的 DataModel */
function createModelWithEmptyFields(): DataModel {
  return {
    name: 'User',
    filePath: 'src/models/user.py',
    language: 'python',
    kind: 'dataclass',
    fields: [
      { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
      { name: 'age', typeStr: 'int', optional: false, defaultValue: null, description: null },
      { name: 'email', typeStr: 'Optional[str]', optional: true, defaultValue: 'None', description: null },
    ],
    bases: [],
    description: null,
  };
}

/** 构造一个包含混合 description 的 DataModel */
function createModelWithMixedFields(): DataModel {
  return {
    name: 'Config',
    filePath: 'src/config.py',
    language: 'python',
    kind: 'pydantic',
    fields: [
      { name: 'host', typeStr: 'str', optional: false, defaultValue: '"localhost"', description: '数据库主机地址' },
      { name: 'port', typeStr: 'int', optional: false, defaultValue: '5432', description: null },
      { name: 'timeout', typeStr: 'float', optional: false, defaultValue: '30.0', description: null },
    ],
    bases: [],
    description: null,
  };
}

/** 构造一个包含 [AI] 前缀的 DataModel */
function createModelWithAiPrefix(): DataModel {
  return {
    name: 'Settings',
    filePath: 'src/settings.py',
    language: 'python',
    kind: 'pydantic',
    fields: [
      { name: 'debug', typeStr: 'bool', optional: false, defaultValue: 'False', description: '[AI] 是否启用调试模式' },
      { name: 'level', typeStr: 'int', optional: false, defaultValue: '1', description: null },
    ],
    bases: [],
    description: null,
  };
}

/** 构造包含空 description 配置项的 ConfigFileResult */
function createConfigFileWithEmptyDesc(): ConfigFileResult {
  return {
    filePath: 'config.yaml',
    format: 'yaml',
    entries: [
      { keyPath: 'app.name', type: 'string', defaultValue: 'my-service', description: '' },
      { keyPath: 'app.port', type: 'number', defaultValue: '3000', description: '' },
      { keyPath: 'app.debug', type: 'boolean', defaultValue: 'false', description: '' },
    ],
  };
}

/** 构造包含混合 description 的 ConfigFileResult */
function createConfigFileWithMixedDesc(): ConfigFileResult {
  return {
    filePath: 'pyproject.toml',
    format: 'toml',
    entries: [
      { keyPath: 'project.name', type: 'string', defaultValue: 'my-tool', description: '项目名称' },
      { keyPath: 'project.version', type: 'string', defaultValue: '1.0.0', description: '' },
      { keyPath: 'tool.uv.dev', type: 'boolean', defaultValue: 'true', description: '' },
    ],
  };
}

/** 设置 detectAuth 返回 API Key 可用 */
function setupAuthAvailable(): void {
  mockDetectAuth.mockReturnValue({
    methods: [{ type: 'api-key', available: true, details: '已设置' }],
    preferred: { type: 'api-key', available: true, details: '已设置' },
    diagnostics: [],
  });
}

/** 设置 detectAuth 返回无可用认证 */
function setupAuthUnavailable(): void {
  mockDetectAuth.mockReturnValue({
    methods: [
      { type: 'api-key', available: false, details: '未设置' },
      { type: 'cli-proxy', available: false, details: '未安装' },
    ],
    preferred: null,
    diagnostics: ['未找到可用的认证方式'],
  });
}

/** 模拟 LLM 返回成功的结果 */
function setupLLMResponse(data: Array<{ name: string; description: string }>): void {
  mockMessagesCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    model: 'claude-3-5-haiku-20241022',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

// ============================================================
// 测试
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();

  // 设置 Anthropic 构造函数 mock，每次 new Anthropic() 都返回带 mockMessagesCreate 的对象
  mockMessagesCreate = vi.fn();
  vi.mocked(Anthropic).mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  }) as any);
});

// ============================================================
// US1: enrichFieldDescriptions
// ============================================================

describe('enrichFieldDescriptions', () => {
  // T006: 正常增强
  it('正常增强——mock LLM 返回 JSON，验证 [AI] 前缀和字段匹配', async () => {
    setupAuthAvailable();
    setupLLMResponse([
      { name: 'name', description: '用户的显示名称' },
      { name: 'age', description: '用户年龄' },
      { name: 'email', description: '用户的电子邮箱地址' },
    ]);

    const models = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(models);

    expect(result).toHaveLength(1);
    const fields = result[0]!.fields;
    expect(fields[0]!.description).toBe('[AI] 用户的显示名称');
    expect(fields[1]!.description).toBe('[AI] 用户年龄');
    expect(fields[2]!.description).toBe('[AI] 用户的电子邮箱地址');
  });

  // T007: 保留人工注释
  it('保留人工注释——description 非 null 的字段不被覆盖', async () => {
    setupAuthAvailable();
    setupLLMResponse([
      { name: 'port', description: '服务监听端口' },
      { name: 'timeout', description: '请求超时时间' },
    ]);

    const models = [createModelWithMixedFields()];
    const result = await enrichFieldDescriptions(models);

    const fields = result[0]!.fields;
    // 已有人工注释的字段保持不变
    expect(fields[0]!.description).toBe('数据库主机地址');
    // 空字段被 LLM 增强
    expect(fields[1]!.description).toBe('[AI] 服务监听端口');
    expect(fields[2]!.description).toBe('[AI] 请求超时时间');
  });

  // T008: 空数据
  it('空数据——models=[] 时不调用 LLM', async () => {
    setupAuthAvailable();

    const result = await enrichFieldDescriptions([]);

    expect(result).toEqual([]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  // T009: [AI] 前缀不叠加
  it('[AI] 前缀不叠加——已有 [AI] 前缀的字段跳过', async () => {
    setupAuthAvailable();
    setupLLMResponse([
      { name: 'level', description: '日志级别' },
    ]);

    const models = [createModelWithAiPrefix()];
    const result = await enrichFieldDescriptions(models);

    const fields = result[0]!.fields;
    // 已有 [AI] 前缀的字段保持不变
    expect(fields[0]!.description).toBe('[AI] 是否启用调试模式');
    // null 字段被增强
    expect(fields[1]!.description).toBe('[AI] 日志级别');
  });

  // 不修改原数组
  it('不修改原数组——返回深拷贝', async () => {
    setupAuthAvailable();
    setupLLMResponse([
      { name: 'name', description: '用户的显示名称' },
      { name: 'age', description: '用户年龄' },
      { name: 'email', description: '邮箱' },
    ]);

    const original = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(original);

    // 原始数据未被修改
    expect(original[0]!.fields[0]!.description).toBeNull();
    // 返回值被增强
    expect(result[0]!.fields[0]!.description).toBe('[AI] 用户的显示名称');
  });

  // 所有字段都有 description 时不调用 LLM
  it('所有字段都有 description 时不调用 LLM', async () => {
    setupAuthAvailable();

    const model: DataModel = {
      name: 'FullyDocumented',
      filePath: 'models.py',
      language: 'python',
      kind: 'dataclass',
      fields: [
        { name: 'x', typeStr: 'int', optional: false, defaultValue: null, description: '已有说明' },
      ],
      bases: [],
      description: null,
    };

    const result = await enrichFieldDescriptions([model]);
    expect(result[0]!.fields[0]!.description).toBe('已有说明');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

// ============================================================
// US2: enrichConfigDescriptions
// ============================================================

describe('enrichConfigDescriptions', () => {
  // T013: 正常增强
  it('正常增强——mock LLM 返回 JSON，验证 [AI] 前缀和配置项匹配', async () => {
    setupAuthAvailable();
    // 第一次调用：文件级描述增强
    setupLLMResponse([
      { name: 'config.yaml', description: '应用主配置文件' },
    ]);
    // 第二次调用：配置项级描述增强
    setupLLMResponse([
      { name: 'app.name', description: '应用程序名称' },
      { name: 'app.port', description: '服务监听端口号' },
      { name: 'app.debug', description: '是否启用调试模式' },
    ]);

    const files = [createConfigFileWithEmptyDesc()];
    const result = await enrichConfigDescriptions(files);

    expect(result).toHaveLength(1);
    // 验证文件级描述
    expect(result[0]!.description).toBe('[AI] 应用主配置文件');
    // 验证配置项级描述
    const entries = result[0]!.entries;
    expect(entries[0]!.description).toBe('[AI] 应用程序名称');
    expect(entries[1]!.description).toBe('[AI] 服务监听端口号');
    expect(entries[2]!.description).toBe('[AI] 是否启用调试模式');
  });

  // T014: 保留已有 description
  it('保留已有 description——非空的配置项不被覆盖', async () => {
    setupAuthAvailable();
    // 第一次调用：文件级描述增强
    setupLLMResponse([
      { name: 'pyproject.toml', description: 'Python 项目配置' },
    ]);
    // 第二次调用：配置项级描述增强
    setupLLMResponse([
      { name: 'project.version', description: '项目版本号' },
      { name: 'tool.uv.dev', description: '是否启用开发模式依赖' },
    ]);

    const files = [createConfigFileWithMixedDesc()];
    const result = await enrichConfigDescriptions(files);

    const entries = result[0]!.entries;
    // 已有说明的保持不变
    expect(entries[0]!.description).toBe('项目名称');
    // 空 description 被增强
    expect(entries[1]!.description).toBe('[AI] 项目版本号');
    expect(entries[2]!.description).toBe('[AI] 是否启用开发模式依赖');
  });

  // T015: 空数据
  it('空数据——files=[] 时不调用 LLM', async () => {
    setupAuthAvailable();

    const result = await enrichConfigDescriptions([]);

    expect(result).toEqual([]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  // 不修改原数组
  it('不修改原数组——返回深拷贝', async () => {
    setupAuthAvailable();
    // 第一次调用：文件级描述增强
    setupLLMResponse([
      { name: 'config.yaml', description: '应用配置' },
    ]);
    // 第二次调用：配置项级描述增强
    setupLLMResponse([
      { name: 'app.name', description: '应用名称' },
      { name: 'app.port', description: '端口' },
      { name: 'app.debug', description: '调试' },
    ]);

    const original = [createConfigFileWithEmptyDesc()];
    const result = await enrichConfigDescriptions(original);

    // 原始数据未被修改
    expect(original[0]!.entries[0]!.description).toBe('');
    expect(original[0]!.description).toBeUndefined();
    // 返回值被增强
    expect(result[0]!.entries[0]!.description).toBe('[AI] 应用名称');
    expect(result[0]!.description).toBe('[AI] 应用配置');
  });

  // 所有配置项和文件都有 description 时不调用 LLM
  it('所有配置项和文件都有 description 时不调用 LLM', async () => {
    setupAuthAvailable();

    const files: ConfigFileResult[] = [{
      filePath: 'full.yaml',
      format: 'yaml',
      description: '已有文件说明',
      entries: [
        { keyPath: 'key1', type: 'string', defaultValue: 'val', description: '已有说明' },
      ],
    }];

    const result = await enrichConfigDescriptions(files);
    expect(result[0]!.entries[0]!.description).toBe('已有说明');
    expect(result[0]!.description).toBe('已有文件说明');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

// ============================================================
// US4: 降级测试
// ============================================================

describe('enrichFieldDescriptions 降级', () => {
  // T027: LLM 不可用时静默返回原始数据
  it('LLM 不可用（detectAuth 返回 preferred: null）时静默返回原始数据', async () => {
    setupAuthUnavailable();

    const models = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(models);

    // 原始 null description 保持不变
    expect(result[0]!.fields[0]!.description).toBeNull();
    expect(result[0]!.fields[1]!.description).toBeNull();
    expect(result[0]!.fields[2]!.description).toBeNull();
    // LLM 未被调用
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  // T028: LLM 调用抛出异常时静默降级
  it('LLM 调用抛出异常时静默降级', async () => {
    setupAuthAvailable();
    mockMessagesCreate.mockRejectedValueOnce(new Error('API 连接失败'));

    const models = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(models);

    // 不抛异常，返回原始数据
    expect(result[0]!.fields[0]!.description).toBeNull();
    expect(result[0]!.fields[1]!.description).toBeNull();
  });

  // T029: 部分批次失败
  it('部分批次失败——多个模型中一个失败，其余正常增强', async () => {
    setupAuthAvailable();

    // 第一个模型的 LLM 调用失败
    mockMessagesCreate.mockRejectedValueOnce(new Error('超时'));
    // 第二个模型的 LLM 调用成功
    setupLLMResponse([
      { name: 'role', description: '用户角色标识' },
    ]);

    const model1: DataModel = {
      name: 'User',
      filePath: 'a.py',
      language: 'python',
      kind: 'dataclass',
      fields: [
        { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
      ],
      bases: [],
      description: null,
    };

    const model2: DataModel = {
      name: 'Admin',
      filePath: 'b.py',
      language: 'python',
      kind: 'dataclass',
      fields: [
        { name: 'role', typeStr: 'str', optional: false, defaultValue: null, description: null },
      ],
      bases: [],
      description: null,
    };

    const result = await enrichFieldDescriptions([model1, model2]);

    // 第一个模型失败，保持 null
    expect(result[0]!.fields[0]!.description).toBeNull();
    // 第二个模型成功，有 [AI] 前缀
    expect(result[1]!.fields[0]!.description).toBe('[AI] 用户角色标识');
  });
});

describe('enrichConfigDescriptions 降级', () => {
  // T030: LLM 不可用时静默返回原始数据
  it('LLM 不可用时静默返回原始数据', async () => {
    setupAuthUnavailable();

    const files = [createConfigFileWithEmptyDesc()];
    const result = await enrichConfigDescriptions(files);

    // 原始空 description 保持不变
    expect(result[0]!.entries[0]!.description).toBe('');
    expect(result[0]!.entries[1]!.description).toBe('');
    // LLM 未被调用
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  // LLM 调用抛出异常时静默降级
  it('LLM 调用抛出异常时静默降级', async () => {
    setupAuthAvailable();
    // 文件级增强也会失败
    mockMessagesCreate.mockRejectedValueOnce(new Error('网络错误'));
    // 配置项级增强也会失败
    mockMessagesCreate.mockRejectedValueOnce(new Error('网络错误'));

    const files = [createConfigFileWithEmptyDesc()];
    const result = await enrichConfigDescriptions(files);

    // 不抛异常，空 description 保持不变
    expect(result[0]!.entries[0]!.description).toBe('');
    expect(result[0]!.description).toBeUndefined();
  });
});

// ============================================================
// LLM 返回格式容错
// ============================================================

describe('LLM 返回格式容错', () => {
  it('处理 markdown 代码块包裹的 JSON 响应', async () => {
    setupAuthAvailable();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n[{"name": "name", "description": "用户名"}]\n```',
      }],
      model: 'claude-3-5-haiku-20241022',
      usage: { input_tokens: 50, output_tokens: 30 },
    });

    const models: DataModel[] = [{
      name: 'User',
      filePath: 'a.py',
      language: 'python',
      kind: 'dataclass',
      fields: [
        { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
      ],
      bases: [],
      description: null,
    }];

    const result = await enrichFieldDescriptions(models);
    expect(result[0]!.fields[0]!.description).toBe('[AI] 用户名');
  });

  it('LLM 返回无效 JSON 时静默降级', async () => {
    setupAuthAvailable();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '这不是 JSON' }],
      model: 'claude-3-5-haiku-20241022',
      usage: { input_tokens: 50, output_tokens: 30 },
    });

    const models = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(models);

    // 不抛异常，保持 null
    expect(result[0]!.fields[0]!.description).toBeNull();
  });

  it('LLM 返回空响应时静默降级', async () => {
    setupAuthAvailable();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [],
      model: 'claude-3-5-haiku-20241022',
      usage: { input_tokens: 50, output_tokens: 0 },
    });

    const models = [createModelWithEmptyFields()];
    const result = await enrichFieldDescriptions(models);

    // 不抛异常，保持 null
    expect(result[0]!.fields[0]!.description).toBeNull();
  });
});
