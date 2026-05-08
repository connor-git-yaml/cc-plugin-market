/**
 * Feature 151 T-009 — PythonMapper.extractCallSites 单测（FR-5 + CL-04 + EC-12/14/15）
 *
 * 7 个 Python case + 边界覆盖：
 * 1. free function `foo()`
 * 2. self.method()
 * 3. Class.method()
 * 4. dunder __add__ via `a + b`
 * 5. super().__init__()
 * 6. 带参 @decorator
 * 7. cross-module module.func()
 *
 * 边界：
 * - bare decorator (@staticmethod) 不记录（CL-04）
 * - dynamic call (getattr / eval) skip（EC-12）
 * - 大文件 1MB+ 跳过（EC-14）
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

let analyzer: TreeSitterAnalyzer;

beforeAll(() => {
  analyzer = TreeSitterAnalyzer.getInstance();
});

async function analyzeSnippet(code: string): Promise<{
  callSites: Array<{ calleeName: string; calleeKind: string; line: number; callerContext?: string }>;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-cs-'));
  const filePath = path.join(tmpDir, 'snippet.py');
  fs.writeFileSync(filePath, code, 'utf-8');
  try {
    const skeleton = await analyzer.analyze(filePath, 'python', {
      extractCallSites: true,
    });
    return { callSites: skeleton.callSites ?? [] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('PythonMapper.extractCallSites — 7 Python case (FR-5)', () => {
  it('case 1 — free function `foo()`', async () => {
    const code = `
def foo():
    pass

def main():
    foo()
`;
    const { callSites } = await analyzeSnippet(code);
    const fooCall = callSites.find((c) => c.calleeName === 'foo' && c.calleeKind === 'free');
    expect(fooCall).toBeDefined();
    expect(fooCall?.callerContext).toBe('main');
  });

  it('case 2 — self.method()', async () => {
    const code = `
class Value:
    def forward(self):
        self.compute()
    def compute(self):
        pass
`;
    const { callSites } = await analyzeSnippet(code);
    const memberCall = callSites.find(
      (c) => c.calleeName === 'compute' && c.calleeKind === 'member',
    );
    expect(memberCall).toBeDefined();
    expect(memberCall?.callerContext).toBe('Value.forward');
  });

  it('case 3 — Class.method() (静态调用，识别为 member)', async () => {
    const code = `
class Engine:
    @staticmethod
    def helper():
        pass

def main():
    Engine.helper()
`;
    const { callSites } = await analyzeSnippet(code);
    const classCall = callSites.find((c) => c.calleeName === 'helper' && c.calleeKind === 'member');
    expect(classCall).toBeDefined();
  });

  it('case 4 — dunder `__add__` 通过 `a + b` (EC-3)', async () => {
    const code = `
def add(a, b):
    return a + b
`;
    const { callSites } = await analyzeSnippet(code);
    const addCall = callSites.find((c) => c.calleeName === '__add__');
    expect(addCall).toBeDefined();
    expect(addCall?.calleeKind).toBe('dunder');
  });

  it('case 5 — super().__init__()', async () => {
    const code = `
class Parent:
    def __init__(self):
        pass

class Child(Parent):
    def __init__(self):
        super().__init__()
`;
    const { callSites } = await analyzeSnippet(code);
    const superCall = callSites.find(
      (c) => c.calleeName === '__init__' && c.calleeKind === 'super',
    );
    expect(superCall).toBeDefined();
    expect(superCall?.callerContext).toBe('Child.__init__');
  });

  it('case 6 — 带参 @decorator (`@app.route("/x")`)', async () => {
    const code = `
class App:
    def route(self, path):
        def deco(fn): return fn
        return deco

app = App()

@app.route("/x")
def handler():
    pass
`;
    const { callSites } = await analyzeSnippet(code);
    const decoCall = callSites.find(
      (c) => c.calleeName === 'route' && c.calleeKind === 'decorator',
    );
    expect(decoCall).toBeDefined();
  });

  it('case 7 — cross-module `module.func()`', async () => {
    const code = `
import numpy

def use():
    arr = numpy.array([1, 2, 3])
    return arr
`;
    const { callSites } = await analyzeSnippet(code);
    const cmCall = callSites.find(
      (c) => c.calleeName === 'array' && c.calleeKind === 'cross-module',
    );
    expect(cmCall).toBeDefined();
    expect(cmCall?.callerContext).toBe('use');
  });
});

describe('PythonMapper.extractCallSites — Edge Cases (CL-04 + EC-12/14/15)', () => {
  it('CL-04: bare decorator (@staticmethod) 不记录', async () => {
    const code = `
class A:
    @staticmethod
    def helper():
        pass
`;
    const { callSites } = await analyzeSnippet(code);
    // 不应包含 staticmethod 作为 callSite
    const staticCall = callSites.find((c) => c.calleeName === 'staticmethod');
    expect(staticCall).toBeUndefined();
  });

  it('CL-04: bare attribute decorator (@app.route) 不记录', async () => {
    const code = `
app = type('App', (), {'route': lambda self: lambda fn: fn})()

@app.route
def handler():
    pass
`;
    const { callSites } = await analyzeSnippet(code);
    // bare attribute 不应记录为 decorator
    const decoCall = callSites.find(
      (c) => c.calleeName === 'route' && c.calleeKind === 'decorator',
    );
    expect(decoCall).toBeUndefined();
  });

  it('EC-12: getattr() 动态调用 skip', async () => {
    const code = `
def use(obj, name):
    fn = getattr(obj, name)
    return fn()
`;
    const { callSites } = await analyzeSnippet(code);
    // getattr 本身不应记录
    const getattrCall = callSites.find((c) => c.calleeName === 'getattr');
    expect(getattrCall).toBeUndefined();
  });

  it('EC-12: 字符串拼接 attribute (subscript) skip', async () => {
    const code = `
def use(obj, name):
    return obj['key']()
`;
    const { callSites } = await analyzeSnippet(code);
    // subscript 调用不应被记录为 cross-module
    expect(callSites.length).toBe(0);
  });

  it('EC-15: async function 内 call 正常抽取', async () => {
    const code = `
async def fetch():
    helper()

def helper():
    pass
`;
    const { callSites } = await analyzeSnippet(code);
    const helperCall = callSites.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
    expect(helperCall?.callerContext).toBe('fetch');
  });

  it('EC-15: generator function 内 call 正常抽取', async () => {
    const code = `
def gen():
    while True:
        yield helper()

def helper():
    return 1
`;
    const { callSites } = await analyzeSnippet(code);
    const helperCall = callSites.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
    expect(helperCall?.callerContext).toBe('gen');
  });

  it('EC-14: 大文件 (>1MB) skip — callSites 为空', async () => {
    // 构造 1.1 MB 的 Python 文件
    const bigCode = '# big file\n' + 'pass\n'.repeat(220_000); // > 1 MB
    const { callSites } = await analyzeSnippet(bigCode);
    expect(callSites).toEqual([]);
  });

  it('EC-14: parse error 不阻塞 — 仍返回 callSites（best effort）', async () => {
    const code = `
def main():
    foo()
    invalid syntax !!!
`;
    const { callSites } = await analyzeSnippet(code);
    // foo() 在错误之前应该被抽到
    const fooCall = callSites.find((c) => c.calleeName === 'foo');
    expect(fooCall).toBeDefined();
  });

  it('extractCallSites 默认关闭 — 不传 flag 则 callSites=undefined', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-cs-'));
    const filePath = path.join(tmpDir, 'snippet.py');
    fs.writeFileSync(filePath, 'def foo(): pass\nfoo()', 'utf-8');
    try {
      const skeleton = await analyzer.analyze(filePath, 'python');
      // 不传 extractCallSites=true 时不输出
      expect(skeleton.callSites).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
