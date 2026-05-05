/**
 * Feature 150 Phase 4D — TypeScript / TSX Call Site AST Extractor
 *
 * 输入 source root（绝对路径，含 *.ts / *.tsx），输出真实调用点 truth set。
 *
 * 抽取规则（plan.md §Tree-sitter query 关键模式 + 实地探查 web-tree-sitter
 * tree-sitter-typescript@0.24 grammar）：
 *   - call_expression：identifier→function / member_expression→method /
 *     parenthesized_expression(arrow)→arrow / arrow_function→arrow /
 *     import token→unresolved-dynamic / 'eval' callee→unresolved
 *   - new_expression：'Function' callee→unresolved-dynamic / 其它→constructor
 *   - decorator > call_expression → 按 method 处理（plan 表）
 *
 * caller 形态：`<rel-path>:<Class.method | functionName | <top-level>>`
 *
 * tsx 限制：本仓 tree-sitter-typescript.wasm 不含 tsx 子 grammar（实测 JSX 触发
 * ERROR），.tsx 走 parse-error + skip 路径（spec edge case "语法错误源文件"）。
 *
 * 契约源：spec.md FR-005/008/009/010；plan.md "共享接口契约"；tasks.md T-013~T-015。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  loadTreeSitterGrammar,
  walkSourceFiles,
  createWarningsArray,
  buildMetadataHeader,
} from './extractor-helpers.mjs';

const EXTRACTOR_VERSION = '1.0.0';
const TS_EXTENSIONS = Object.freeze(['.ts', '.tsx']);

// ── 类型 JSDoc ──

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file - 相对 sourceRoot 的路径
 * @property {number} line - 1-based 行号
 * @property {'method'|'function'|'arrow'|'constructor'|'unresolved'} kind
 */

/**
 * @typedef {Object} ExtractWarning
 * @property {string} file
 * @property {number} [line]
 * @property {string} code
 * @property {string} [message]
 */

/**
 * @typedef {Object} ExtractOptions
 * @property {string} sourceRoot
 * @property {{repo?: string, commit?: string, scope: string}} [baseline]
 * @property {{extractorVersion?: string}} [options]
 */

/**
 * @typedef {Object} ExtractResult
 * @property {'ts'} language
 * @property {TruthCall[]} truthCalls
 * @property {ExtractWarning[]} warnings
 * @property {object} [baseline] - 元数据头（FR-014），仅当 options.baseline 提供时输出
 */

// ── 工具函数 ──

/** tree-sitter row 是 0-based，统一返回 1-based 行号 */
export function _nodeLine(node) {
  const row = node && node.startPosition ? node.startPosition.row : 0;
  return row + 1;
}

/**
 * 给定 call_expression 的 callee 子节点，返回 callee 名 + kind 分类。
 *
 * 设计：
 *   - identifier："foo"   → {name:'foo', kind:'function'} 或 unresolved（eval）
 *   - member_expression："a.b" / "this.b" / "super.b" → {name:'b', kind:'method'}
 *   - parenthesized_expression(arrow) / arrow_function：IIFE → {name:'<arrow>', kind:'arrow'}
 *   - import (token / namespace):动态 import('./x') → {name:'import', kind:'unresolved'}
 *   - 其它（call_expression chained / 复杂表达式）：取 text 截断 + kind=unresolved
 *
 * @param {object} calleeNode tree-sitter named child node (call_expression 第一个 child)
 * @returns {{name: string, kind: 'method'|'function'|'arrow'|'unresolved', dynamicReason?: string}}
 */
export function _classifyCallExpressionCallee(calleeNode) {
  if (!calleeNode) {
    return { name: '<unknown>', kind: 'unresolved', dynamicReason: 'missing-callee' };
  }
  const t = calleeNode.type;

  if (t === 'identifier') {
    const name = calleeNode.text;
    if (name === 'eval') {
      return { name, kind: 'unresolved', dynamicReason: 'eval-call' };
    }
    return { name, kind: 'function' };
  }

  if (t === 'member_expression') {
    // 末端 property_identifier 是 callee 名（this.foo / super.foo / a.b.c → 取最末 prop）
    const property =
      typeof calleeNode.childForFieldName === 'function'
        ? calleeNode.childForFieldName('property')
        : null;
    if (property && typeof property.text === 'string') {
      return { name: property.text, kind: 'method' };
    }
    // fallback：取 namedChildren 最后一个为 property（grammar 边界情况）
    const named = Array.isArray(calleeNode.namedChildren) ? calleeNode.namedChildren : [];
    const last = named[named.length - 1];
    if (last && typeof last.text === 'string') {
      return { name: last.text, kind: 'method' };
    }
    return { name: typeof calleeNode.text === 'string' ? calleeNode.text : '<member>', kind: 'method' };
  }

  if (t === 'parenthesized_expression') {
    // (expr)() — 进一步拆 inner，常见 IIFE：(() => x)()
    const named = Array.isArray(calleeNode.namedChildren) ? calleeNode.namedChildren : [];
    const inner = named[0];
    if (inner) {
      if (inner.type === 'arrow_function' || inner.type === 'function_expression') {
        return { name: '<arrow>', kind: 'arrow' };
      }
      return _classifyCallExpressionCallee(inner);
    }
    return { name: '<arrow>', kind: 'arrow' };
  }

  if (t === 'arrow_function' || t === 'function_expression') {
    return { name: '<arrow>', kind: 'arrow' };
  }

  if (t === 'import') {
    return { name: 'import', kind: 'unresolved', dynamicReason: 'dynamic-import' };
  }

  // call_expression chained ("a()()") / 模板复杂表达式 / generic instantiation
  // → callee 静态不可解析，标 unresolved
  if (t === 'call_expression') {
    return { name: '<chained-call>', kind: 'unresolved', dynamicReason: 'chained-callee' };
  }

  return { name: calleeNode.text ?? '<expr>', kind: 'unresolved', dynamicReason: 'unknown-callee-type' };
}

/**
 * 给定 new_expression 的 constructor 子节点，返回构造名 + kind。
 * - new Function('x','return x') → unresolved + dynamicReason
 * - new Map<T>() / new Foo()     → constructor
 *
 * @param {object} calleeNode
 * @returns {{name: string, kind: 'constructor'|'unresolved', dynamicReason?: string}}
 */
export function _classifyNewExpressionCallee(calleeNode) {
  if (!calleeNode) {
    return { name: '<unknown>', kind: 'unresolved', dynamicReason: 'missing-ctor' };
  }
  const name = calleeNode.text ?? '<expr>';
  if (name === 'Function') {
    return { name, kind: 'unresolved', dynamicReason: 'new-Function-ctor' };
  }
  return { name, kind: 'constructor' };
}

/**
 * 向上查找当前节点所在的 caller scope（最近的 method_definition / function_declaration / arrow_function）。
 *
 * 返回 caller 字符串，形如：
 *   - "rel/path.ts:ClassName.method"
 *   - "rel/path.ts:functionName"
 *   - "rel/path.ts:<top-level>"
 *
 * @param {object} node tree-sitter node
 * @param {string} relPath
 * @returns {string}
 */
export function _resolveCaller(node, relPath) {
  // Codex Phase 4D CRITICAL #3 修订：嵌套 function/arrow 内调用应归属"最近的" scope，
  // 不能继续向外走到 class 把所有嵌套调用错算到 Class.method。
  //
  // 算法：从调用点向上遍历，遇到第一个 function-like scope（method_definition /
  // function_declaration / arrow_function / function_expression）立即决定 caller，
  // 不再继续向外。这样：
  //   class Foo { bar() { arr.map((x) => x.baz()); } }
  // x.baz() 的 caller 是 "rel:<arrow:line>" 而不是 "rel:Foo.bar"
  let cursor = node.parent;

  while (cursor) {
    const t = cursor.type;

    if (t === 'method_definition') {
      const propIdent = cursor.namedChildren?.find?.((c) => c.type === 'property_identifier');
      const methodName = propIdent ? propIdent.text : '<anon-method>';
      // 找最近 enclosing class（method_definition 必在 class_body 内）
      let classCursor = cursor.parent;
      while (classCursor && classCursor.type !== 'class_declaration' && classCursor.type !== 'class') {
        classCursor = classCursor.parent;
      }
      if (classCursor) {
        const typeIdent = classCursor.namedChildren?.find?.((c) => c.type === 'type_identifier');
        const className = typeIdent ? typeIdent.text : '<anon-class>';
        return `${relPath}:${className}.${methodName}`;
      }
      return `${relPath}:${methodName}`;
    }

    if (t === 'function_declaration') {
      const ident = cursor.namedChildren?.find?.((c) => c.type === 'identifier');
      const fnName = ident ? ident.text : '<anon-fn>';
      return `${relPath}:${fnName}`;
    }

    if (t === 'arrow_function' || t === 'function_expression') {
      // arrow / 函数表达式通常匿名；上溯到 variable_declarator 取 name 作为 hint
      const declarator = cursor.parent;
      if (declarator?.type === 'variable_declarator') {
        const ident = declarator.namedChildren?.find?.((c) => c.type === 'identifier');
        if (ident) {
          return `${relPath}:${ident.text}`;
        }
      }
      // 仍然返回（最近 scope），用 <arrow:line:col> 标识匿名 arrow caller
      // Codex Phase 4D round 2 WARNING 修订：加 column 唯一化，避免同行嵌套两个 arrow
      // (如 hono context.test.ts:83) 多条 edge caller 字段相同碰撞
      const line = _nodeLine(cursor);
      const col = cursor.startPosition?.column ?? 0;
      return `${relPath}:<arrow:${line}:${col}>`;
    }

    cursor = cursor.parent;
  }

  return `${relPath}:<top-level>`;
}

/**
 * 遍历 AST 抽 call sites。
 *
 * @param {object} root tree-sitter rootNode
 * @param {string} relPath 相对路径（用于 caller / file 字段）
 * @param {{items: TruthCall[]}} truthCallsBuf
 * @param {{append: (w: ExtractWarning) => void}} warnings
 */
export function _walkAst(root, relPath, truthCallsBuf, warnings) {
  // 迭代式 DFS，避免大文件递归爆栈
  /** @type {object[]} */
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const t = node.type;

    // Codex Phase 4D CRITICAL #1+#2 修订：节点级跳过 ERROR / MISSING 子树
    // tree-sitter 在遇到 syntax error / 不识别的语法（如 TSX）时会插入 ERROR 节点，
    // 此处 skip 整个子树，但允许同文件兄弟节点继续被 walk，从而保留 salvage truth calls。
    if (t === 'ERROR' || node.isMissing === true) {
      continue;
    }

    // Codex Phase 4D round 4 CRITICAL #1+#2 修订（最终版）：
    //
    // round 2 用 call_expression.hasError 整 skip 粒度过粗（误杀 recovery 区域内真实 call）。
    // round 3 用 callee.hasError 漏 sibling ERROR（如 `a.b.()` 抽 phantom callee=b）。
    // round 4 综合修订：
    //   1. phantom 检测：callee 子树含 ERROR 或 直接 children 中含 ERROR/MISSING sibling
    //   2. phantom 时 **仅 skip 抽 truth call，不跳过 children 入栈**（避免外层 broken
    //      但 args 内含真实嵌套 call 的整子树被误杀，例 `[...].filter(remainder.search(...))` ）。
    let isPhantomCall = false;
    if (t === 'call_expression' || t === 'new_expression') {
      const calleeForCheck = Array.isArray(node.namedChildren) ? node.namedChildren[0] : null;
      const allChildren = Array.isArray(node.children) ? node.children : [];
      const hasCalleeError = calleeForCheck && calleeForCheck.hasError === true;
      const hasSiblingError = allChildren.some(
        (c) => c && (c.type === 'ERROR' || c.isMissing === true),
      );
      isPhantomCall = !!hasCalleeError || hasSiblingError;
    }

    if (t === 'call_expression' && !isPhantomCall) {
      const named = Array.isArray(node.namedChildren) ? node.namedChildren : [];
      const callee = named[0] ?? null;
      const cls = _classifyCallExpressionCallee(callee);
      const line = _nodeLine(node);

      // plan §Tree-sitter query 关键模式：decorator 内的 call_expression 按 method 处理
      // 当 call_expression 直接挂在 decorator 节点下时（@Foo() / @Foo(args)），覆盖 kind=method
      let kind = cls.kind;
      if (kind === 'function' && node.parent?.type === 'decorator') {
        kind = 'method';
      }

      truthCallsBuf.items.push({
        caller: _resolveCaller(node, relPath),
        callee: cls.name,
        file: relPath,
        line,
        kind,
      });

      if (kind === 'unresolved' && cls.dynamicReason) {
        warnings.append({
          file: relPath,
          line,
          code: 'unresolved-dynamic',
          message: cls.dynamicReason,
        });
      }
    } else if (t === 'new_expression' && !isPhantomCall) {
      // new_expression 通常 namedChildren[0] 是构造名（identifier 或 type_identifier）
      const named = Array.isArray(node.namedChildren) ? node.namedChildren : [];
      const calleeNode =
        named.find(
          (c) => c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'member_expression',
        ) ?? named[0];

      const cls = _classifyNewExpressionCallee(calleeNode);
      const line = _nodeLine(node);
      truthCallsBuf.items.push({
        caller: _resolveCaller(node, relPath),
        callee: cls.name,
        file: relPath,
        line,
        kind: cls.kind,
      });
      if (cls.kind === 'unresolved' && cls.dynamicReason) {
        warnings.append({
          file: relPath,
          line,
          code: 'unresolved-dynamic',
          message: cls.dynamicReason,
        });
      }
    }

    // 入栈所有 namedChildren（继续 DFS 子节点）
    const children = node.namedChildren;
    if (children && children.length > 0) {
      // 倒序入栈以保证 left-to-right DFS（不影响正确性，仅便于行号顺序）
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  }
}

// ── 单文件处理（test-friendly export）──

/**
 * 处理单个 TS 文件：read + parse + walk，所有异常归一到 parse-error warning。
 *
 * @param {object} parser tree-sitter Parser 实例
 * @param {string} absPath 文件绝对路径
 * @param {string} relPath 相对 sourceRoot 的路径（用于 caller / file 字段）
 * @param {{items: TruthCall[]}} truthCallsBuf
 * @param {{append: (w: ExtractWarning) => void}} warnings
 */
export function _processOneTsFile(parser, absPath, relPath, truthCallsBuf, warnings) {
  try {
    const source = fs.readFileSync(absPath, 'utf-8');
    const tree = parser.parse(source);
    // Codex Phase 4D CRITICAL #1+#2 修订：hasError 改为节点级跳过而非整文件 skip。
    // _walkAst 内部对 ERROR / MISSING 节点单独 skip 子树，但仍处理同文件其它正常子树。
    // 文件级 hasError 仅记录 warning，不阻止 walk（保留可解析部分的 truth calls）。
    if (tree.rootNode.hasError) {
      warnings.append({
        file: relPath,
        code: 'parse-error-partial',
        message: 'rootNode hasError — 仍尝试抽取非 error 子树（节点级 salvage）',
      });
    }
    _walkAst(tree.rootNode, relPath, truthCallsBuf, warnings);
  } catch (err) {
    warnings.append({
      file: relPath,
      code: 'parse-error',
      message: `extract-error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ── 公开 API ──

/**
 * 从 TS / TSX 源码 root 抽取 truth calls。
 *
 * @param {ExtractOptions} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractTsCallSites(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('extractTsCallSites: options 必须为对象');
  }
  const { sourceRoot, baseline } = options;
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new Error('extractTsCallSites: options.sourceRoot 必须为非空字符串');
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`extractTsCallSites: sourceRoot 不存在 path="${sourceRoot}"`);
  }

  const { parser } = await loadTreeSitterGrammar('ts');
  const files = walkSourceFiles(sourceRoot, TS_EXTENSIONS);

  const truthCallsBuf = { items: /** @type {TruthCall[]} */ ([]) };
  const warnings = createWarningsArray();

  for (const absPath of files) {
    // Codex Phase 4D WARNING #3 修订：跨 OS 分隔符归一为 POSIX (/)，
    // 确保 fixture 在 macOS / Linux / Windows 上 byte-stable
    const relPath = path.relative(sourceRoot, absPath).split(path.sep).join('/');
    _processOneTsFile(parser, absPath, relPath, truthCallsBuf, warnings);
  }

  /** @type {ExtractResult} */
  const result = {
    language: 'ts',
    truthCalls: truthCallsBuf.items,
    warnings: warnings.items,
  };

  if (baseline && typeof baseline === 'object' && typeof baseline.scope === 'string') {
    const meta = buildMetadataHeader({
      language: 'ts',
      baseline,
      extractorVersion: EXTRACTOR_VERSION,
    });
    result.baseline = meta.baseline;
  }

  return result;
}
