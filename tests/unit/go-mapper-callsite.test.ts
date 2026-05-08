/**
 * Feature 153 T-013 — GoMapper.extractCallSites 单测（FR-1 ~ FR-7 + EC-Go-* 边界）
 *
 * 5 核心场景（FR-8 必须 ≥ 5）+ 6 边界用例：
 * 1. regular function call → free
 * 2. package-qualified call (fmt.Println) → cross-module + qualifier
 * 3. receiver method call (s.GetAddr 在 (s *Server) Start 内) → member + qualifier=undefined
 * 4. interface method call (free function 上下文 w.Write) → free + qualifier=undefined
 * 5. generic call (MakeMap[T]() 实测落 identifier 行 #1) → free
 *
 * 边界：
 * 6. reflect.ValueOf → unresolved
 * 7. nested selector (s.listener.Accept) → free + qualifier=undefined
 * 8. parenthesized type conversion ((*Server)(nil) / (*sql.DB)(nil)) → free / cross-module
 * 9. 大文件 size guard (> 1MB) → []
 * 10. defer / go statement (EC-Go-2) → 内层 call 仍被抽取
 * 11. 嵌套指针 receiver (EC-Go-3) → callerContext="NestedPtr.M"
 *
 * 路径：单测直接调 TreeSitterAnalyzer.analyze，落到 mapper.extractCallSites。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';

let analyzer: TreeSitterAnalyzer;

beforeAll(() => {
  analyzer = TreeSitterAnalyzer.getInstance();
});

async function analyzeSnippet(code: string): Promise<{
  callSites: Array<{
    calleeName: string;
    calleeKind: string;
    line: number;
    column?: number;
    callerContext?: string;
    calleeQualifier?: string;
  }>;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-go-cs-'));
  const filePath = path.join(tmpDir, 'snippet.go');
  fs.writeFileSync(filePath, code, 'utf-8');
  try {
    const skeleton = await analyzer.analyze(filePath, 'go', {
      extractCallSites: true,
    });
    return { callSites: skeleton.callSites ?? [] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('GoMapper.extractCallSites — 5 核心场景 (FR-8)', () => {
  it('case 1 — regular function call (helper()) → free + 同模块 callerContext', async () => {
    const code = `package main

func helper() {}

func main() {
	helper()
}
`;
    const { callSites } = await analyzeSnippet(code);
    const helperCall = callSites.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
    expect(helperCall?.calleeKind).toBe('free');
    expect(helperCall?.calleeQualifier).toBeUndefined();
    expect(helperCall?.callerContext).toBe('main');
  });

  it('case 2 — package-qualified call (fmt.Println) → cross-module + qualifier="fmt"', async () => {
    const code = `package main

import "fmt"

func main() {
	fmt.Println("hello")
}
`;
    const { callSites } = await analyzeSnippet(code);
    const printlnCall = callSites.find((c) => c.calleeName === 'Println');
    expect(printlnCall).toBeDefined();
    expect(printlnCall?.calleeKind).toBe('cross-module');
    expect(printlnCall?.calleeQualifier).toBe('fmt');
    expect(printlnCall?.callerContext).toBe('main');
  });

  it('case 3 — receiver method call ((s *Server) Start { s.GetAddr() }) → member + qualifier=undefined', async () => {
    const code = `package main

type Server struct{}

func (s *Server) GetAddr() string {
	return ""
}

func (s *Server) Start() {
	s.GetAddr()
}
`;
    const { callSites } = await analyzeSnippet(code);
    const getAddrCall = callSites.find((c) => c.calleeName === 'GetAddr');
    expect(getAddrCall).toBeDefined();
    expect(getAddrCall?.calleeKind).toBe('member');
    expect(getAddrCall?.calleeQualifier).toBeUndefined();
    expect(getAddrCall?.callerContext).toBe('Server.Start');
  });

  it('case 4 — interface method call in free function (w.Write) → free + qualifier=undefined', async () => {
    const code = `package main

import "io"

func usewriter(w io.Writer, buf []byte) {
	w.Write(buf)
}
`;
    const { callSites } = await analyzeSnippet(code);
    const writeCall = callSites.find((c) => c.calleeName === 'Write');
    expect(writeCall).toBeDefined();
    // free function 上下文：receiverVarStack 顶为 null，operand "w" != null → 行 #8 free
    expect(writeCall?.calleeKind).toBe('free');
    expect(writeCall?.calleeQualifier).toBeUndefined();
    expect(writeCall?.callerContext).toBe('usewriter');
  });

  it('case 5 — generic call (MakeMap[string, int]()) → free + name="MakeMap" (实测 grammar 行 #1)', async () => {
    const code = `package main

func MakeMap[K comparable, V any]() map[K]V {
	return make(map[K]V)
}

func main() {
	_ = MakeMap[string, int]()
}
`;
    const { callSites } = await analyzeSnippet(code);
    // tree-sitter-go 实测：MakeMap[T]() callee = identifier "MakeMap" → 行 #1 free
    const makeMapCall = callSites.find((c) => c.calleeName === 'MakeMap');
    expect(makeMapCall).toBeDefined();
    expect(makeMapCall?.calleeKind).toBe('free');
    expect(makeMapCall?.callerContext).toBe('main');
  });
});

describe('GoMapper.extractCallSites — 边界用例', () => {
  it('case 6 — reflect.ValueOf(x) → unresolved (EC-Go-1)', async () => {
    const code = `package main

import "reflect"

func main() {
	_ = reflect.ValueOf(1)
}
`;
    const { callSites } = await analyzeSnippet(code);
    const valueOfCall = callSites.find((c) => c.calleeName === 'ValueOf');
    expect(valueOfCall).toBeDefined();
    expect(valueOfCall?.calleeKind).toBe('unresolved');
  });

  it('case 7 — nested selector (s.listener.Accept) → free + qualifier=undefined (EC-Go-7 / FR-2 行 #9)', async () => {
    const code = `package main

type Listener struct{}

func (l *Listener) Accept() {}

type Server struct {
	listener *Listener
}

func (s *Server) Start() {
	s.listener.Accept()
}
`;
    const { callSites } = await analyzeSnippet(code);
    const acceptCall = callSites.find((c) => c.calleeName === 'Accept');
    expect(acceptCall).toBeDefined();
    // 最外层 selector_expression operand 是 selector_expression(s, listener)，非 identifier → 行 #9 free
    expect(acceptCall?.calleeKind).toBe('free');
    expect(acceptCall?.calleeQualifier).toBeUndefined();
    expect(acceptCall?.callerContext).toBe('Server.Start');
  });

  it('case 8a — parenthesized type conversion ((*Server)(nil)) → free + name="Server" (EC-Go-7)', async () => {
    const code = `package main

type Server struct{}

func main() {
	_ = (*Server)(nil)
}
`;
    const { callSites } = await analyzeSnippet(code);
    const serverCall = callSites.find((c) => c.calleeName === 'Server');
    expect(serverCall).toBeDefined();
    expect(serverCall?.calleeKind).toBe('free');
  });

  it('case 8b — parenthesized cross-module conversion ((*sql.DB)(nil)) → cross-module + qualifier="sql"', async () => {
    const code = `package main

import "database/sql"

func main() {
	_ = (*sql.DB)(nil)
}
`;
    const { callSites } = await analyzeSnippet(code);
    const dbCall = callSites.find((c) => c.calleeName === 'DB');
    expect(dbCall).toBeDefined();
    expect(dbCall?.calleeKind).toBe('cross-module');
    expect(dbCall?.calleeQualifier).toBe('sql');
  });

  it('case 9 — 大文件 size guard (source > 1MB) → []', async () => {
    // 构造 ~1.1MB Go 源码：header + 大量空函数（合法 Go 语法）
    const header = 'package main\n\n';
    const oneFunc = 'func f() { _ = 1 }\n';
    // 每行约 20 字节；需要 > 1_000_000 字节 → 50000+ 行
    const body = oneFunc.repeat(60_000);
    const code = header + body;
    expect(code.length).toBeGreaterThan(1_000_000);
    const { callSites } = await analyzeSnippet(code);
    expect(callSites).toEqual([]);
  });

  it('case 10 — defer / go statement (EC-Go-2) → 内层 call 仍被抽取', async () => {
    const code = `package main

import "fmt"

func worker() {}

func main() {
	defer fmt.Println("done")
	go worker()
}
`;
    const { callSites } = await analyzeSnippet(code);
    const printlnCall = callSites.find((c) => c.calleeName === 'Println');
    const workerCall = callSites.find((c) => c.calleeName === 'worker');
    expect(printlnCall).toBeDefined();
    expect(printlnCall?.calleeKind).toBe('cross-module');
    expect(printlnCall?.calleeQualifier).toBe('fmt');
    expect(workerCall).toBeDefined();
    expect(workerCall?.calleeKind).toBe('free');
  });

  it('case 11 — 嵌套指针 receiver ((s **NestedPtr)) → callerContext="NestedPtr.M" (EC-Go-3)', async () => {
    const code = `package main

type NestedPtr struct{}

func (s **NestedPtr) M() {
	helper()
}

func helper() {}
`;
    const { callSites } = await analyzeSnippet(code);
    const helperCall = callSites.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
    expect(helperCall?.callerContext).toBe('NestedPtr.M');
  });

  it('case 12 — dot import (import . "fmt") → Println bare call 走行 #1 free (EC-Go-4)', async () => {
    const code = `package main

import . "fmt"

func main() {
	Println("hi")
}
`;
    const { callSites } = await analyzeSnippet(code);
    const printlnCall = callSites.find((c) => c.calleeName === 'Println');
    expect(printlnCall).toBeDefined();
    // dot import 不入 alias 集合 → Println() 是 bare identifier call → 行 #1 free
    expect(printlnCall?.calleeKind).toBe('free');
    expect(printlnCall?.calleeQualifier).toBeUndefined();
  });

  it('case 13 — blank import (import _ "lib") → 不参与 alias，无 callSite 副作用 (EC-Go-5)', async () => {
    const code = `package main

import _ "database/sql"

func main() {}
`;
    const { callSites } = await analyzeSnippet(code);
    // blank import 仅副作用导入，main 函数空 → callSites 应为空数组
    expect(callSites).toEqual([]);
  });
});

describe('GoLanguageAdapter — Feature 153 callSites 透传（FR-4 / FR-9 NFR-4 守门）', () => {
  // Codex Round-1 implement WARNING C 修订：透传测试必须走 GoLanguageAdapter.analyzeFile 路径，
  // 不能直接 analyzer.analyze（那只测 analyzer 不测 adapter）
  it('GoLanguageAdapter.analyzeFile(path) 不传 flag 时 skeleton.callSites === undefined', async () => {
    const { GoLanguageAdapter } = await import('../../src/adapters/go-adapter.js');
    const adapter = new GoLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-go-bc-'));
    const filePath = path.join(tmpDir, 'a.go');
    fs.writeFileSync(filePath, 'package main\nfunc main() {}\n', 'utf-8');
    try {
      const skeleton = await adapter.analyzeFile(filePath);
      expect(skeleton.callSites).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('GoLanguageAdapter.analyzeFile(path, { extractCallSites: true }) 时 skeleton.callSites 是数组', async () => {
    const { GoLanguageAdapter } = await import('../../src/adapters/go-adapter.js');
    const adapter = new GoLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-go-bc-'));
    const filePath = path.join(tmpDir, 'a.go');
    fs.writeFileSync(filePath, 'package main\nfunc main() { f() }\nfunc f() {}\n', 'utf-8');
    try {
      const skeleton = await adapter.analyzeFile(filePath, { extractCallSites: true });
      expect(skeleton.callSites).toBeDefined();
      expect(Array.isArray(skeleton.callSites)).toBe(true);
      expect(skeleton.callSites!.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('GoLanguageAdapter.analyzeFile(path, { extractCallSites: false }) 时 skeleton.callSites === undefined', async () => {
    const { GoLanguageAdapter } = await import('../../src/adapters/go-adapter.js');
    const adapter = new GoLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-go-bc-'));
    const filePath = path.join(tmpDir, 'a.go');
    fs.writeFileSync(filePath, 'package main\nfunc main() { f() }\nfunc f() {}\n', 'utf-8');
    try {
      const skeleton = await adapter.analyzeFile(filePath, { extractCallSites: false });
      expect(skeleton.callSites).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('GoMapper.extractCallSites — Codex Round-1 implement WARNING E + CRITICAL 补强', () => {
  it('case 14 — closure 嵌套栈协议（method 内 closure 内 call 用 method receiver var）→ 内层 ctx 是 closure', async () => {
    const code = `package main

import "sync"

type Server struct {
	mu sync.Mutex
}

func (s *Server) GetAddr() string { return "" }

func (s *Server) Start() {
	defer func() {
		// closure scope：callerContext 应是 <closure:line:col>，且 receiverVarStack 顶为 null
		// 内部如果调 s.GetAddr()，operand "s" 不等于 closure 的 receiver var name (null) → 落 #8 free
		s.GetAddr()
	}()
	s.GetAddr()
}
`;
    const { callSites } = await analyzeSnippet(code);
    const getAddrCalls = callSites.filter((c) => c.calleeName === 'GetAddr');
    expect(getAddrCalls.length).toBe(2);
    // 直接在 method body 内的 s.GetAddr() → callerContext "Server.Start"，member（栈顶 receiver=s）
    const inMethod = getAddrCalls.find((c) => c.callerContext === 'Server.Start');
    expect(inMethod).toBeDefined();
    expect(inMethod?.calleeKind).toBe('member');
    // closure 内的 s.GetAddr() → callerContext 是 closure:line:col，free（栈顶 receiver=null）
    const inClosure = getAddrCalls.find((c) => c.callerContext?.startsWith('<closure:'));
    expect(inClosure).toBeDefined();
    expect(inClosure?.calleeKind).toBe('free');
  });

  it('case 15 — 栈协议正确 pop（method 后回到 free function 上下文）', async () => {
    const code = `package main

type Foo struct{}

func (f *Foo) Bar() {}

func freeFn() {
	helper()
}

func helper() {}
`;
    const { callSites } = await analyzeSnippet(code);
    const helperCall = callSites.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
    // freeFn 在 method declaration 之后；如果栈协议出错，callerContext 可能错误指向 Foo.Bar
    expect(helperCall?.callerContext).toBe('freeFn');
  });

  it('case 16 — phantom call 防御（rootNode.hasError = true 时仍部分 walk，与 extractor 行为一致）', async () => {
    // 故意构造语法错误的 Go 源（缺 } ）— mapper 应不抛异常，且不会因 hasError 整体放弃
    const code = `package main

func helper() {}

func main() {
	helper()
	// 故意缺 } — 让 tree-sitter rootNode.hasError = true
`;
    const { callSites } = await analyzeSnippet(code);
    // helper() 在 main 内，是合法的 call_expression，应该被抽出（除非 phantom 检测把它排除）
    // 这里验证：mapper 不抛异常 + 不返回 null
    expect(Array.isArray(callSites)).toBe(true);
    // 行为对齐 go-call-extractor.mjs：parse error 部分仍尝试 walk，不要求严格抽到 helper
    // （tree-sitter-go 在 unmatched brace 上的行为可能让 helper() 被 wrap 进 ERROR 子树而 skip）
  });
});
