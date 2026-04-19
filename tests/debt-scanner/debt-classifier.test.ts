/**
 * debt-classifier 单元测试
 */
import { describe, it, expect } from 'vitest';
import { classifyCommentRegion, SEVERITY_MAP } from '../../src/debt-scanner/comments/debt-classifier.js';
import type { CommentRegion } from '../../src/debt-scanner/types.js';

function region(text: string, kind: 'line' | 'block' = 'line'): CommentRegion {
  return { kind, text, startLine: 1, endLine: 1 };
}

describe('debt-classifier', () => {
  it('识别纯 TODO 行注释', () => {
    const out = classifyCommentRegion(region('TODO: refactor'));
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('TODO');
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.text).toBe('refactor');
  });

  it('识别 FIXME / HACK 为 critical', () => {
    expect(classifyCommentRegion(region('FIXME broken'))[0]?.severity).toBe('critical');
    expect(classifyCommentRegion(region('HACK workaround'))[0]?.severity).toBe('critical');
  });

  it('识别 NOTE / XXX 为 informational', () => {
    expect(classifyCommentRegion(region('NOTE trivia'))[0]?.severity).toBe('informational');
    expect(classifyCommentRegion(region('XXX weird'))[0]?.severity).toBe('informational');
  });

  it('支持 TODO(connor): 语法，owner 被提取', () => {
    const out = classifyCommentRegion(region('TODO(connor): check this'));
    expect(out[0]?.owner).toBe('connor');
    expect(out[0]?.text).toBe('check this');
  });

  it('支持 TODO@user 语法', () => {
    const out = classifyCommentRegion(region('TODO@alice fix later'));
    expect(out[0]?.owner).toBe('alice');
  });

  it('大小写不敏感', () => {
    expect(classifyCommentRegion(region('todo minor'))).toHaveLength(1);
    expect(classifyCommentRegion(region('Fixme serious'))).toHaveLength(1);
  });

  it('冒号可选', () => {
    const out = classifyCommentRegion(region('TODO refactor later'));
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('refactor later');
  });

  it('块注释内多行各自独立产生条目', () => {
    const r = region('TODO: one\nFIXME: two\nnormal line\nHACK three', 'block');
    const out = classifyCommentRegion(r);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.kind)).toEqual(['TODO', 'FIXME', 'HACK']);
    expect(out[1]?.lineOffset).toBe(1);
    expect(out[2]?.lineOffset).toBe(3);
  });

  it('非债务注释返回空数组', () => {
    expect(classifyCommentRegion(region('just a normal comment'))).toHaveLength(0);
  });

  it('SEVERITY_MAP 映射正确', () => {
    expect(SEVERITY_MAP.FIXME).toBe('critical');
    expect(SEVERITY_MAP.TODO).toBe('warning');
    expect(SEVERITY_MAP.NOTE).toBe('informational');
  });
});
