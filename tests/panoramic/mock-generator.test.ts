/**
 * MockReadmeGenerator 单元测试
 * 验证 isApplicable / extract / generate / render 四步生命周期
 */
import { describe, it, expect } from 'vitest';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { MockReadmeGenerator } from '../../src/panoramic/mock-readme-generator.js';

// ============================================================
// 辅助函数
// ============================================================

/** 构建包含 package.json 的 ProjectContext */
function createContextWithPackageJson(
  packageJsonContent: string = JSON.stringify({ name: 'my-project', description: 'A test project' }),
): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map([['package.json', packageJsonContent]]),
  };
}

/** 构建不包含 package.json 的 ProjectContext */
function createContextWithoutPackageJson(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map([['tsconfig.json', '{}']]),
  };
}

/** 构建空 configFiles 的 ProjectContext */
function createEmptyContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map(),
  };
}

// ============================================================
// isApplicable
// ============================================================

describe('MockReadmeGenerator.isApplicable', () => {
  const generator = new MockReadmeGenerator();

  it('包含 package.json 的 ProjectContext 返回 true', () => {
    const ctx = createContextWithPackageJson();
    expect(generator.isApplicable(ctx)).toBe(true);
  });

  it('不包含 package.json 的 ProjectContext 返回 false', () => {
    const ctx = createContextWithoutPackageJson();
    expect(generator.isApplicable(ctx)).toBe(false);
  });

  it('空 Map 的 ProjectContext 返回 false', () => {
    const ctx = createEmptyContext();
    expect(generator.isApplicable(ctx)).toBe(false);
  });
});

// ============================================================
// extract
// ============================================================

describe('MockReadmeGenerator.extract', () => {
  const generator = new MockReadmeGenerator();

  it('正确提取 projectName 和 description', async () => {
    const ctx = createContextWithPackageJson(
      JSON.stringify({ name: 'awesome-lib', description: 'An awesome library' }),
    );
    const input = await generator.extract(ctx);
    expect(input.projectName).toBe('awesome-lib');
    expect(input.description).toBe('An awesome library');
    expect(input.hasPackageJson).toBe(true);
  });

  it('缺失字段使用默认值', async () => {
    const ctx = createContextWithPackageJson(JSON.stringify({}));
    const input = await generator.extract(ctx);
    expect(input.projectName).toBe('unknown-project');
    expect(input.description).toBe('No description provided');
    expect(input.hasPackageJson).toBe(true);
  });

  it('无 package.json 时返回降级默认值', async () => {
    const ctx = createContextWithoutPackageJson();
    const input = await generator.extract(ctx);
    expect(input.projectName).toBe('unknown-project');
    expect(input.description).toBe('No description provided');
    expect(input.hasPackageJson).toBe(false);
  });

  it('package.json 内容为无效 JSON 时优雅降级', async () => {
    const ctx = createContextWithPackageJson('not valid json {{{');
    const input = await generator.extract(ctx);
    expect(input.projectName).toBe('unknown-project');
    expect(input.description).toBe('No description provided');
    expect(input.hasPackageJson).toBe(true);
  });
});

// ============================================================
// generate
// ============================================================

describe('MockReadmeGenerator.generate', () => {
  const generator = new MockReadmeGenerator();

  it('输出包含 title、description 和 sections', async () => {
    const input = {
      projectName: 'my-project',
      description: 'A test project',
      hasPackageJson: true,
    };
    const output = await generator.generate(input);
    expect(output.title).toBe('my-project');
    expect(output.description).toBe('A test project');
    expect(Array.isArray(output.sections)).toBe(true);
    expect(output.sections.length).toBeGreaterThan(0);
  });
});

// ============================================================
// render
// ============================================================

describe('MockReadmeGenerator.render', () => {
  const generator = new MockReadmeGenerator();

  it('输出为合法 Markdown（包含 # 标题和段落）', () => {
    const output = {
      title: 'my-project',
      description: 'A test project',
      sections: [
        { heading: 'Installation', content: 'npm install my-project' },
        { heading: 'Usage', content: 'Import and use the library.' },
      ],
    };
    const markdown = generator.render(output);
    expect(markdown).toContain('# my-project');
    expect(markdown).toContain('A test project');
    expect(markdown).toContain('## Installation');
    expect(markdown).toContain('npm install my-project');
    expect(markdown).toContain('## Usage');
  });

  it('sections 为空数组时仅输出 title 和 description', () => {
    const output = {
      title: 'empty-project',
      description: 'No sections',
      sections: [],
    };
    const markdown = generator.render(output);
    expect(markdown).toContain('# empty-project');
    expect(markdown).toContain('No sections');
    // 不应包含二级标题
    expect(markdown).not.toContain('##');
  });
});

// ============================================================
// 全链路 e2e
// ============================================================

describe('MockReadmeGenerator 全链路 e2e', () => {
  const generator = new MockReadmeGenerator();

  it('extract -> generate -> render 顺序调用，最终 Markdown 包含项目名称', async () => {
    const ctx = createContextWithPackageJson(
      JSON.stringify({ name: 'e2e-project', description: 'End-to-end test' }),
    );

    // 1. extract
    const input = await generator.extract(ctx);
    expect(input.projectName).toBe('e2e-project');

    // 2. generate
    const output = await generator.generate(input);
    expect(output.title).toBe('e2e-project');

    // 3. render
    const markdown = generator.render(output);
    expect(markdown).toContain('# e2e-project');
    expect(markdown).toContain('End-to-end test');
    // 确保是有效 Markdown
    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 只读属性检查
// ============================================================

describe('MockReadmeGenerator 只读属性', () => {
  const generator = new MockReadmeGenerator();

  it('id 为 "mock-readme"', () => {
    expect(generator.id).toBe('mock-readme');
  });

  it('name 为 "Mock README Generator"', () => {
    expect(generator.name).toBe('Mock README Generator');
  });

  it('description 非空', () => {
    expect(generator.description.length).toBeGreaterThan(0);
  });
});
