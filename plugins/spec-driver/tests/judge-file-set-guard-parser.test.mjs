/**
 * judge-file-set-guard-parser.test.mjs
 * Feature 236 — FR-002b 解析器 fixture 单测（Node moduleRequests 架构）
 *
 * 对 extractModuleReferences（内部走 spawnSync 子进程 + vm.SourceTextModule.moduleRequests）
 * 独立喂 5 类 fixture + codex 四轮刁钻构造 + dynamic import 形态，逐条断言。
 * 防止"只靠改 JUDGE_FILE_SET 看红"掩盖解析器本身的 bug（data-model.md §7.5）。
 *
 * 静态 import 闭包由 Node 官方词法解析权威保证；dynamic import 一律 fail-closed。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractModuleReferences } from './lib/import-closure-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'judge-file-set-guard');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

/** 断言 ok 且 refs 集合（无序）与期望完全相等 */
function assertExactRefs(src, expected) {
  const r = extractModuleReferences(src);
  assert.equal(r.ok, true, `期望 ok:true，实际 ${JSON.stringify(r)}`);
  assert.deepStrictEqual([...r.refs].sort(), [...expected].sort(), `refs=${JSON.stringify(r.refs)}`);
}

/** 断言 fail-closed（ok:false）且 unsupported 非空 */
function assertFailClosed(src, kind) {
  const r = extractModuleReferences(src);
  assert.equal(r.ok, false, `期望 fail-closed，实际 ${JSON.stringify(r)}`);
  assert.ok(Array.isArray(r.unsupported) && r.unsupported.length > 0, `unsupported 应非空: ${JSON.stringify(r)}`);
  if (kind) assert.ok(r.unsupported.every((u) => u.kind === kind), `kind 应为 ${kind}: ${JSON.stringify(r.unsupported)}`);
}

describe('extractModuleReferences — 5 类 fixture（静态形态由 moduleRequests 权威提取）', () => {
  it('1. 跨行 import → refs 含 ../lib/foo.mjs', () => {
    const r = extractModuleReferences(readFixture('cross-line-import.mjs'));
    assert.equal(r.ok, true);
    assert.ok(r.refs.includes('../lib/foo.mjs'), `refs=${JSON.stringify(r.refs)}`);
  });

  it('2. specifier 行内含注释 → refs 只含 ../lib/foo.mjs，不含注释内 ../fake.mjs', () => {
    const r = extractModuleReferences(readFixture('inline-comment.mjs'));
    assert.equal(r.ok, true);
    assert.ok(r.refs.includes('../lib/foo.mjs'));
    assert.ok(!r.refs.includes('../fake.mjs'), `不应含注释内伪引用: ${JSON.stringify(r.refs)}`);
  });

  it('3. re-export（export{} from + export * from）→ 均计入 refs', () => {
    const r = extractModuleReferences(readFixture('re-export.mjs'));
    assert.equal(r.ok, true);
    assert.ok(r.refs.includes('../lib/foo.mjs'));
    assert.ok(r.refs.includes('../lib/bar.mjs'));
  });

  it('4. side-effect import → 计入 refs', () => {
    const r = extractModuleReferences(readFixture('side-effect.mjs'));
    assert.equal(r.ok, true);
    assert.ok(r.refs.includes('../lib/side-effect.mjs'));
  });

  it('5. 注释掉的伪 import → refs 不含该行内容，真实 import 仍识别', () => {
    const r = extractModuleReferences(readFixture('commented-out.mjs'));
    assert.equal(r.ok, true);
    assert.ok(!r.refs.includes('../not-a-real-dependency.mjs'));
    assert.ok(!r.refs.includes('../another-fake.mjs'));
    assert.ok(r.refs.includes('../lib/foo.mjs'));
  });
});

describe('extractModuleReferences — dynamic import 一律 fail-closed', () => {
  it('字面量 dynamic import → fail-closed（判定器不使用该形态，改由人工确认）', () => {
    assertFailClosed("await import('../lib/dyn.mjs');\n", 'dynamic-import');
  });

  it('变量 dynamic import → fail-closed', () => {
    assertFailClosed("const p = './x.mjs';\nawait import(p);\n", 'dynamic-import');
  });

  it('模板 dynamic import → fail-closed', () => {
    assertFailClosed('const p = "./x.mjs";\nawait import(`${p}`);\n', 'dynamic-import');
  });

  it('字符串拼接式 dynamic import → fail-closed', () => {
    assertFailClosed("await import('../lib/' + 'foo.mjs');\n", 'dynamic-import');
  });

  it('模板字面量内嵌 dynamic import（codex #4）→ 粗检命中 → fail-closed', () => {
    assertFailClosed('const t = `${await import("./dep.mjs")}`;\n', 'dynamic-import');
  });

  it('块注释间隔 import/**/(...)（codex 第五轮）→ 粗检命中 → fail-closed', () => {
    assertFailClosed('await import/**/("./dep.mjs");\n', 'dynamic-import');
  });

  it('行注释间隔 import// gap\\n(...)（codex 第五轮）→ 粗检命中 → fail-closed', () => {
    assertFailClosed('await import// gap\n("./dep.mjs");\n', 'dynamic-import');
  });
});

/**
 * codex 四轮词法边角：Node moduleRequests 是 ground truth，逐例断言静态 import 不被遮蔽。
 * 手写 tokenizer 曾在这些构造上反复被攻破；改用官方解析后应全部精确。
 */
describe('extractModuleReferences — codex 词法边角回归（exact refs）', () => {
  it('#1 控制语句后 regex literal `/[a//]/` 不遮蔽其后 static import', () => {
    assertExactRefs('if(true) /[a\\/\\/]/.test(); import "./dep.mjs";', ['./dep.mjs']);
  });

  it('#1b regex literal 后跟 from-import 不被遮蔽', () => {
    assertExactRefs("const re = /a\\/b/g;\nimport x from './dep.mjs';\n", ['./dep.mjs']);
  });

  it('#2 postfix ++ 后的除法不误判为 regex，其后 static import 正常识别', () => {
    assertExactRefs('let x=1,y=2; x++ / y; import "./dep.mjs";', ['./dep.mjs']);
  });

  it('#3a 独立 CR 空白不破坏解析', () => {
    assertExactRefs('import "./dep.mjs";\rexport const a = 1;', ['./dep.mjs']);
  });

  it('#3b U+2028 / U+2029 行分隔符', () => {
    assertExactRefs('import "./dep.mjs"; const a=1; const b=2;', ['./dep.mjs']);
  });

  it('#3c NBSP / BOM 空白', () => {
    assertExactRefs('﻿import x from "./dep.mjs";', ['./dep.mjs']);
  });

  it('#3d specifier 内 unicode 转义', () => {
    assertExactRefs('import "./de\\u0070.mjs";', ['./dep.mjs']);
  });

  it('字符串内伪 export-from 不误捕（纯字符串、无真实边、无 import( 形态）', () => {
    assertExactRefs('const s = "export x from \'./ghost.mjs\'";', []);
  });

  it('综合：真伪混杂——仅真实 static import/re-export/side-effect 计入', () => {
    const src = [
      'const slash = /\\//;',
      'import a from "./a.mjs";',
      'const fake = "export from ./ghost.mjs";',
      'export { b } from "./b.mjs";',
      'import "./c.mjs";',
    ].join('\n');
    assertExactRefs(src, ['./a.mjs', './b.mjs', './c.mjs']);
  });

  it('loader.import(x) 成员访问不误判为 dynamic import（无 import( 关键字形态）', () => {
    assertExactRefs('loader.import(x);\nimport real from "./real.mjs";\n', ['./real.mjs']);
  });
});

/**
 * CRITICAL 3（codex 第五轮）：helper 若 silent hang（保持事件循环存活却不退出），
 * spawnSync 必须靠 timeout + SIGKILL 收口并 fail-closed，绝不让守卫挂起把 CI 卡死。
 * 通过 env override 注入一个永不退出的 hang helper + 短超时，断言守卫在有界时间内
 * 返回 ok:false 而非阻塞。
 */
describe('runHelper — silent-child 超时 fail-closed（不挂起）', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-hang-helper-'));
  const hangHelper = path.join(tmpDir, 'hang-helper.mjs');
  // 保持事件循环存活但永不主动退出（也不 write stdout），模拟 silent hang。
  fs.writeFileSync(hangHelper, 'setInterval(() => {}, 1000);\n', 'utf8');

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 清理失败无害 */
    }
  });

  it('注入 hang helper + 短超时 → 守卫在有界时间内返回 ok:false（fail-closed）', () => {
    const prevHelper = process.env.SPEC_DRIVER_JUDGE_HELPER_OVERRIDE;
    const prevTimeout = process.env.SPEC_DRIVER_JUDGE_HELPER_TIMEOUT_MS;
    process.env.SPEC_DRIVER_JUDGE_HELPER_OVERRIDE = hangHelper;
    process.env.SPEC_DRIVER_JUDGE_HELPER_TIMEOUT_MS = '500';
    try {
      const started = Date.now();
      const r = extractModuleReferences('import x from "./dep.mjs";\n');
      const elapsed = Date.now() - started;
      assert.equal(r.ok, false, `silent hang 应 fail-closed，实际 ${JSON.stringify(r)}`);
      assert.ok(Array.isArray(r.unsupported) && r.unsupported.length > 0);
      // 有界：短超时 500ms + SIGKILL 开销，远小于默认 10s；给足余量断言未挂起。
      assert.ok(elapsed < 5000, `应在有界时间内返回（未挂起），实际耗时 ${elapsed}ms`);
    } finally {
      if (prevHelper === undefined) delete process.env.SPEC_DRIVER_JUDGE_HELPER_OVERRIDE;
      else process.env.SPEC_DRIVER_JUDGE_HELPER_OVERRIDE = prevHelper;
      if (prevTimeout === undefined) delete process.env.SPEC_DRIVER_JUDGE_HELPER_TIMEOUT_MS;
      else process.env.SPEC_DRIVER_JUDGE_HELPER_TIMEOUT_MS = prevTimeout;
    }
  });
});
