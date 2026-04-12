import { describe, it, expect } from 'vitest';
import { resolveGraphJsonPath } from '../../src/panoramic/graph/graph-paths.js';
import path from 'node:path';

describe('resolveGraphJsonPath', () => {
  it('返回 {cwd}/specs/_meta/graph.json', () => {
    expect(resolveGraphJsonPath('/project')).toBe(
      path.join('/project', 'specs', '_meta', 'graph.json')
    );
  });

  it('与 graph.ts 生产者 outputDir 约定一致', () => {
    const cwd = '/my/project';
    const producerDefault = path.join(cwd, 'specs');
    const producerOutput = path.join(producerDefault, '_meta', 'graph.json');
    expect(resolveGraphJsonPath(cwd)).toBe(producerOutput);
  });

  it('结尾路径段固定为 specs/_meta/graph.json', () => {
    const result = resolveGraphJsonPath('/any/cwd');
    expect(result.endsWith(path.join('specs', '_meta', 'graph.json'))).toBe(true);
  });

  it('支持不同 cwd 前缀', () => {
    const cwd1 = '/home/user/project';
    const cwd2 = '/var/app';
    expect(resolveGraphJsonPath(cwd1)).toBe(path.join(cwd1, 'specs', '_meta', 'graph.json'));
    expect(resolveGraphJsonPath(cwd2)).toBe(path.join(cwd2, 'specs', '_meta', 'graph.json'));
  });
});
