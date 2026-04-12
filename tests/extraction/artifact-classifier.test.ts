/**
 * artifact-classifier.ts 单元测试
 * 覆盖扩展名分类、排除目录、敏感文件检测
 */
import { describe, it, expect } from 'vitest';
import { classifyFile, isSensitiveFile } from '../../src/extraction/artifact-classifier.js';

describe('classifyFile - 正常文件分类', () => {
  it('.md 文件 → document', () => {
    expect(classifyFile('/project/docs/adr-001.md')).toBe('document');
  });

  it('.mdx 文件 → document', () => {
    expect(classifyFile('/project/docs/guide.mdx')).toBe('document');
  });

  it('openapi.yaml → api-spec', () => {
    expect(classifyFile('/project/openapi.yaml')).toBe('api-spec');
  });

  it('openapi.json → api-spec', () => {
    expect(classifyFile('/project/openapi.json')).toBe('api-spec');
  });

  it('swagger.yaml → api-spec', () => {
    expect(classifyFile('/project/api/swagger.yaml')).toBe('api-spec');
  });

  it('asyncapi.yaml → api-spec', () => {
    expect(classifyFile('/project/asyncapi.yaml')).toBe('api-spec');
  });

  it('.png 文件 → image', () => {
    expect(classifyFile('/project/docs/architecture.png')).toBe('image');
  });

  it('.jpg 文件 → image', () => {
    expect(classifyFile('/project/docs/diagram.jpg')).toBe('image');
  });

  it('.jpeg 文件 → image', () => {
    expect(classifyFile('/project/assets/photo.jpeg')).toBe('image');
  });

  it('.svg 文件 → image', () => {
    expect(classifyFile('/project/docs/flowchart.svg')).toBe('image');
  });
});

describe('classifyFile - 应返回 null 的场景', () => {
  it('普通 .yaml 配置文件（不含 openapi/swagger/asyncapi）→ null', () => {
    expect(classifyFile('/project/config.yaml')).toBeNull();
  });

  it('普通 .json 文件（不含 openapi/swagger/asyncapi）→ null', () => {
    expect(classifyFile('/project/package.json')).toBeNull();
  });

  it('.bmp 格式不支持 → null', () => {
    expect(classifyFile('/project/docs/image.bmp')).toBeNull();
  });

  it('.tiff 格式不支持 → null', () => {
    expect(classifyFile('/project/docs/image.tiff')).toBeNull();
  });

  it('.ts 源码文件 → null（不是提取目标）', () => {
    expect(classifyFile('/project/src/auth/auth.ts')).toBeNull();
  });

  it('.py 源码文件 → null', () => {
    expect(classifyFile('/project/src/main.py')).toBeNull();
  });
});

describe('classifyFile - 排除目录', () => {
  it('node_modules 下文件 → null', () => {
    expect(classifyFile('/project/node_modules/some-pkg/README.md')).toBeNull();
  });

  it('dist 下文件 → null', () => {
    expect(classifyFile('/project/dist/docs.md')).toBeNull();
  });

  it('.git 下文件 → null', () => {
    expect(classifyFile('/project/.git/COMMIT_EDITMSG')).toBeNull();
  });

  it('specs 下文件 → null（不扫描 spec 文档）', () => {
    expect(classifyFile('/project/specs/101-some-feature/spec.md')).toBeNull();
  });

  it('嵌套 node_modules → null', () => {
    expect(classifyFile('/project/packages/foo/node_modules/bar/openapi.yaml')).toBeNull();
  });
});

describe('isSensitiveFile', () => {
  it('.env 文件 → 敏感', () => {
    expect(isSensitiveFile('/project/.env')).toBe(true);
  });

  it('.env.local → 敏感', () => {
    expect(isSensitiveFile('/project/.env.local')).toBe(true);
  });

  it('.env.production → 敏感', () => {
    expect(isSensitiveFile('/project/.env.production')).toBe(true);
  });

  it('.pem 文件 → 敏感', () => {
    expect(isSensitiveFile('/project/certs/server.pem')).toBe(true);
  });

  it('.key 文件 → 敏感', () => {
    expect(isSensitiveFile('/project/keys/private.key')).toBe(true);
  });

  it('id_rsa → 敏感', () => {
    expect(isSensitiveFile('/home/user/.ssh/id_rsa')).toBe(true);
  });

  it('id_rsa.pub → 敏感', () => {
    expect(isSensitiveFile('/home/user/.ssh/id_rsa.pub')).toBe(true);
  });

  it('普通 .md 文件 → 不敏感', () => {
    expect(isSensitiveFile('/project/docs/README.md')).toBe(false);
  });

  it('openapi.yaml → 不敏感', () => {
    expect(isSensitiveFile('/project/openapi.yaml')).toBe(false);
  });
});

describe('classifyFile - 敏感文件集成', () => {
  it('敏感文件（.env）即使扩展名匹配也返回 null', () => {
    // .env 没有扩展名，不会匹配到任何 ArtifactKind，但通过敏感过滤
    expect(classifyFile('/project/.env')).toBeNull();
  });

  it('.pem 证书文件 → null（敏感过滤）', () => {
    expect(classifyFile('/project/certs/server.pem')).toBeNull();
  });
});
