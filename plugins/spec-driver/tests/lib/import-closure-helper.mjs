/**
 * import-closure-helper.mjs
 * Feature 236 — FR-002b 守卫解析器的子进程 helper（需 --experimental-vm-modules）
 *
 * 静态 import 闭包一律交给 Node 官方词法解析：`vm.SourceTextModule(src).moduleRequests`。
 * 这是 ground truth，一次性根治手写 tokenizer 的全部词法边角（控制语句后 regex、
 * postfix ++/--、独立 CR / U+2028 / U+2029 / NBSP / BOM 空白、specifier 转义等）。
 *
 * dynamic import 不在 moduleRequests 中枚举。守卫的立场是：只保证「静态 import 闭包」
 * 正确；dynamic import 是判定器当前不使用的形态。用保守粗检扫描源码是否出现 dynamic
 * import 调用（`import` 后跟 `(`，中间允许 空白 / 块注释 / 行注释 任意间隔；排除
 * `import.meta` 与 static `import…from`），一旦命中即整体 fail-closed，请人工确认
 * JUDGE_FILE_SET。误报无害（只是多要人看一眼）。
 *
 * 由 import-closure-parser.mjs 通过 spawnSync 调用；两模式：
 *   --entry <absPath>   : BFS 静态 import 闭包 → { ok:true, files:[abs...] } | { ok:false, unsupported }
 *   --extract-stdin     : 单文件（从 stdin 读源码）→ { ok:true, refs:[spec...] } | { ok:false, unsupported }
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 保守粗检：源码是否出现 dynamic import 调用。
 * 匹配 `import` 关键字后跟 `(`，两者之间允许 空白 / 块注释 / 行注释 任意间隔
 * （合法 dynamic import 允许 `import/* x *\/("...")` 与 `import// x\n("...")` 形态）。
 * `import` 前不得为 `.` / 标识符字符，以排除 `import.meta`（无 `(`）、`foo.import(`
 * 成员访问、以及粘连标识符。
 *
 * 【已知限制】粗检不区分代码上下文——字符串 / 注释 / 模板原文里出现的 `import(`
 * 会被保守命中（误报），方向安全：多要人工确认一眼，绝不静默放行真实 dynamic import。
 * 返回命中位置的字符偏移量供诊断精确定位（null 表示未命中）。
 * @returns {number|null} 命中处 `import` 关键字的字符偏移；未命中返回 null
 */
function findDynamicImport(source) {
  // 间隔允许：\s（含所有 Unicode 空白）| 块注释 /* ... */ | 行注释 // ...\n
  const re = /(^|[^.\w$])import(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/;
  const m = re.exec(source);
  if (!m) return null;
  // m.index 指向前缀字符（或 ^ 时为 0）；真实 `import` 关键字位于其后。
  const prefixLen = m[1] ? m[1].length : 0;
  return m.index + prefixLen;
}

/**
 * 用 Node 官方解析拿到该源码的静态 import specifier 列表。
 * 静态 import specifier 由 Node 官方词法解析权威给出：优先 `moduleRequests`
 * （Node 22.20+/24.4+），回退 `dependencySpecifiers`（Node 20+ string[]）——
 * 两者均为 Node 内建解析结果，不引入任何手写 tokenizer。
 * @returns {{ok:true,specifiers:string[]}|{ok:false,kind:string,detail:string,offset?:number}}
 */
function staticSpecifiers(source) {
  const dynOffset = findDynamicImport(source);
  if (dynOffset !== null) {
    return { ok: false, kind: 'dynamic-import', detail: '检测到 dynamic import 调用', offset: dynOffset };
  }
  let mod;
  try {
    mod = new vm.SourceTextModule(source);
  } catch (err) {
    return { ok: false, kind: 'unrecognized-syntax', detail: err && err.message ? err.message : 'parse-error' };
  }
  // moduleRequests（新）: {specifier}[]；dependencySpecifiers（Node 20）: string[]
  const specs = mod.moduleRequests
    ? mod.moduleRequests.map((r) => r.specifier)
    : mod.dependencySpecifiers;
  return { ok: true, specifiers: specs };
}

/** 由字符偏移定位行号 + 行内容（供人工定位诊断命中处） */
function locateOffset(source, offset) {
  if (typeof offset !== 'number' || offset < 0) return { line: 0, snippet: '' };
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const snippet = source.split('\n')[line - 1] ?? '';
  return { line, snippet };
}

/** 单文件提取（--extract-stdin） */
function extractFromSource(source) {
  const res = staticSpecifiers(source);
  if (!res.ok) {
    const loc = res.kind === 'dynamic-import' ? locateOffset(source, res.offset) : { line: 0, snippet: res.detail };
    return {
      ok: false,
      unsupported: [{ file: '', line: loc.line, snippet: loc.snippet, kind: res.kind }],
    };
  }
  // 去重（同一 specifier 可能被多条语句引用）
  return { ok: true, refs: [...new Set(res.specifiers)] };
}

/** BFS 静态 import 闭包（--entry） */
function resolveClosure(entryAbsPath) {
  const visited = new Set();
  const queue = [path.resolve(entryAbsPath)];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let source;
    try {
      source = fs.readFileSync(current, 'utf8');
    } catch {
      return {
        ok: false,
        unsupported: [{ file: current, line: 0, snippet: '', kind: 'unrecognized-syntax' }],
      };
    }

    const res = staticSpecifiers(source);
    if (!res.ok) {
      const loc = res.kind === 'dynamic-import' ? locateOffset(source, res.offset) : { line: 0, snippet: res.detail };
      return {
        ok: false,
        unsupported: [{ file: current, line: loc.line, snippet: loc.snippet, kind: res.kind }],
      };
    }

    for (const spec of res.specifiers) {
      // 仅遍历相对引用（./ 或 ../）；忽略裸包名与 node:*
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const resolved = path.resolve(path.dirname(current), spec);
        if (!visited.has(resolved)) queue.push(resolved);
      }
    }
  }

  return { ok: true, files: [...visited] };
}

function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];

  let result;
  if (mode === '--entry') {
    const entry = argv[1];
    if (!entry) {
      process.stderr.write('缺少入口路径参数\n');
      process.exit(2);
      return;
    }
    result = resolveClosure(entry);
  } else if (mode === '--extract-stdin') {
    let source = '';
    try {
      source = fs.readFileSync(0, 'utf8');
    } catch {
      source = '';
    }
    result = extractFromSource(source);
  } else {
    process.stderr.write(`未知模式: ${mode}\n`);
    process.exit(2);
    return;
  }

  process.stdout.write(JSON.stringify(result));
}

main();
