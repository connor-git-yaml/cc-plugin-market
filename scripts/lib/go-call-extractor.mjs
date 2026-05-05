/**
 * Feature 150 Phase 4C — Go Call Site AST Extractor
 *
 * 输入 source root（绝对路径，含 *.go），输出真实调用点 truth set。
 *
 * 抽取规则（plan.md §Tree-sitter query 关键模式 Go 部分，2026-05-05 修订后真实
 * tree-sitter-go grammar node types，由 probe-go.mjs 实测验证）：
 *
 *   - call_expression：基础调用形态，含字段：
 *       - function（callee；可为 identifier / selector_expression / 其它）
 *       - arguments（argument_list）
 *   - selector_expression：方法调用 / 包级调用，含字段：
 *       - operand（receiver；可为 identifier / call_expression / 其它）
 *       - field（field_identifier，被调名）
 *   - import_declaration / import_spec：扫描收集 package alias 集合，用于
 *     selector_expression 的 method vs static 区分
 *
 * kind 分类（FR-006 label-only 模式）：
 *   - function：callee = identifier (bare call / type conversion)
 *   - method：callee = selector_expression，operand 不在 import alias
 *   - static：callee = selector_expression，operand 在 import alias 集合
 *   - unresolved：反射调用（reflect.* / unsafe.*）/ 其它无法识别形态
 *
 * caller 形态：`<rel-path>:<funcName | Type.method | <closure:line:col> | <top-level>>`
 *   - function_declaration：用 field name；无外层
 *   - method_declaration：receiver type 名 + method 名（值 receiver / 指针 receiver 都识别）
 *   - func_literal：`<closure:line:col>`（同 ts/java extractor 风格）
 *
 * Codex Phase 4D / 4B 经验教训预防（CRITICAL #1~#5）：
 *   1. rootNode.hasError 不整文件 skip → 仅记录 parse-error-partial 警告，节点级 walk
 *   2. ERROR / MISSING 节点跳过子树
 *   3. _resolveGoCaller 嵌套优先：从最近 function/method/closure scope 立即返回
 *   4. phantom call 防护：call_expression 检查 callee 子树 hasError + sibling ERROR；
 *      phantom 时仅 skip 抽取，children 仍 walk
 *   5. POSIX path 归一：`path.relative().split(path.sep).join('/')`
 *
 * 契约源：spec.md FR-006 / FR-008 / FR-009 / FR-010 / FR-016；plan.md "共享接口契约"；
 *         tasks.md T-010 / T-011 / T-012。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  loadTreeSitterGrammar,
  walkSourceFiles,
  createWarningsArray,
  buildMetadataHeader,
  DEFAULT_IGNORE_DIRS,
} from './extractor-helpers.mjs';

const EXTRACTOR_VERSION = '1.0.0';
const GO_EXTENSIONS = Object.freeze(['.go']);

// ── 类型 JSDoc ──

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file - 相对 sourceRoot 的路径
 * @property {number} line - 1-based 行号
 * @property {'method'|'function'|'static'|'unresolved'} kind
 * @property {string} [dynamicReason]
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
 * @property {readonly string[]} [ignoreDirs] - 跳过的目录名数组（按 basename 匹配）。
 *   缺省使用 walkSourceFiles 默认（node_modules/.git/vendor/...）；GORM 顶层包 scope
 *   场景下传入 ['callbacks','clause','internal','logger','migrator','schema','tests','utils']
 *   等子包名实现"仅顶层 .go"语义。
 * @property {{extractorVersion?: string}} [options]
 */

/**
 * @typedef {Object} ExtractResult
 * @property {'go'} language
 * @property {TruthCall[]} truthCalls
 * @property {ExtractWarning[]} warnings
 * @property {object} [baseline]
 */

// ── 工具函数 ──

/** tree-sitter row 是 0-based，统一返回 1-based 行号 */
export function _goNodeLine(node) {
  const row = node && node.startPosition ? node.startPosition.row : 0;
  return row + 1;
}

/**
 * 安全读 field name 子节点（防御 childForFieldName 不存在的场景）
 */
function _getField(node, fieldName) {
  if (!node || typeof node.childForFieldName !== 'function') {
    return null;
  }
  return node.childForFieldName(fieldName);
}

/**
 * 反射类调用 receiver 集合（Go 标准库）。
 *
 * - reflect.ValueOf / TypeOf / Indirect / DeepEqual ... → unresolved
 * - unsafe.Pointer / Sizeof / Alignof / Offsetof ... → unresolved
 *
 * 检测策略：selector_expression operand 是这些 receiver 名字时，整个调用标
 * `kind=unresolved + dynamicReason=unresolved-reflection`。
 *
 * 注：Go 中 reflect.Value 的链式 method 调用（如 v.Call(args)）当前 receiver 是变量
 * 名（如 v），无法仅靠 receiver 识别为反射；该形态在 label-only 模式归为 method。
 */
const GO_REFLECTION_RECEIVERS = new Set(['reflect', 'unsafe']);

/**
 * 从 import_spec 节点的 path 字段取出 package alias。
 *
 * tree-sitter-go grammar：
 *   import_spec
 *     ├ name (optional): package_identifier | dot | blank_identifier
 *     └ path: interpreted_string_literal （含引号）
 *
 * 处理：
 *   - name 是 package_identifier（自定义 alias）→ 用 alias 名
 *   - name 是 dot (`.`) → 跳过（dot import 引入未限定名，不入 alias 集合）
 *   - name 是 blank_identifier (`_`) → 跳过（blank import 仅为副作用，不能用名字引用）
 *   - 无 name → 取 path 末段 segment 作 alias（标准 Go 行为）
 *
 * @param {object} importSpec tree-sitter import_spec node
 * @returns {string|null} alias 名，或 null（应跳过）
 */
function _extractAliasFromImportSpec(importSpec) {
  if (!importSpec || typeof importSpec.childForFieldName !== 'function') return null;
  const nameNode = importSpec.childForFieldName('name');
  if (nameNode) {
    if (nameNode.type === 'dot' || nameNode.type === 'blank_identifier') {
      return null; // dot / blank import 不入 alias 集合
    }
    if (nameNode.type === 'package_identifier' && typeof nameNode.text === 'string') {
      return nameNode.text;
    }
  }
  // 无 name → 从 path 取末段
  const pathNode = importSpec.childForFieldName('path');
  if (!pathNode || pathNode.type !== 'interpreted_string_literal' || typeof pathNode.text !== 'string') {
    return null;
  }
  // 去掉引号
  const raw = pathNode.text.replace(/^["']|["']$/g, '');
  if (raw.length === 0) return null;
  // 取末段（处理 "github.com/foo/bar" → "bar"）
  const lastSlash = raw.lastIndexOf('/');
  return lastSlash === -1 ? raw : raw.slice(lastSlash + 1);
}

/**
 * 扫描 source_file 根节点的 import_declaration，收集 package alias 集合。
 *
 * tree-sitter-go grammar：
 *   source_file
 *     └ import_declaration (一或多个)
 *         └ import_spec (单个)
 *         └ import_spec_list (多个时)
 *             └ import_spec (一或多个)
 *
 * @param {object} root tree-sitter source_file 根节点
 * @returns {Set<string>} package alias 集合
 */
export function _scanImports(root) {
  const aliases = new Set();
  if (!root || !Array.isArray(root.namedChildren)) return aliases;
  for (const child of root.namedChildren) {
    if (!child || child.type !== 'import_declaration') continue;
    const importSpecs = Array.isArray(child.namedChildren) ? child.namedChildren : [];
    for (const spec of importSpecs) {
      if (!spec) continue;
      if (spec.type === 'import_spec') {
        const alias = _extractAliasFromImportSpec(spec);
        if (alias) aliases.add(alias);
      } else if (spec.type === 'import_spec_list') {
        const inner = Array.isArray(spec.namedChildren) ? spec.namedChildren : [];
        for (const subSpec of inner) {
          if (!subSpec || subSpec.type !== 'import_spec') continue;
          const alias = _extractAliasFromImportSpec(subSpec);
          if (alias) aliases.add(alias);
        }
      }
    }
  }
  return aliases;
}

/**
 * 解开 parenthesized_expression，取内层非 parenthesized 节点。
 * 支持嵌套 ((T))(x) → 一直 unwrap 到 inner type/expr。
 *
 * @param {object} parenNode parenthesized_expression
 * @returns {object|null} 内层节点
 */
function _unwrapParenthesized(parenNode) {
  let cursor = parenNode;
  while (cursor && cursor.type === 'parenthesized_expression') {
    const named = Array.isArray(cursor.namedChildren) ? cursor.namedChildren : [];
    cursor = named[0] ?? null;
  }
  return cursor;
}

/**
 * 把 type_identifier / qualified_type / generic_type 转成 callee 名 + kind。
 *
 * - type_identifier "T" → name="T" kind=function
 * - qualified_type "sql.DB" → name="DB" kind=static (取末段，与 import alias static 同语义)
 * - generic_type "List<int>" 等 → 取内层 type_identifier 末段
 *
 * 用于 (*T)(x) / (sql.DB)(x) 等类型转换调用。
 *
 * @param {object} typeNode tree-sitter type 节点
 * @returns {{name: string, kind: 'function'|'static'|'unresolved', dynamicReason?: string}}
 */
function _typeNameToCallee(typeNode) {
  if (!typeNode) return { name: '<unknown>', kind: 'unresolved', dynamicReason: 'missing-type' };
  if (typeNode.type === 'type_identifier' && typeof typeNode.text === 'string') {
    return { name: typeNode.text, kind: 'function' };
  }
  if (typeNode.type === 'qualified_type' && Array.isArray(typeNode.namedChildren)) {
    // qualified_type: package_identifier "sql" + type_identifier "DB"
    const inner = typeNode.namedChildren.find(
      (c) => c && c.type === 'type_identifier' && typeof c.text === 'string',
    );
    if (inner) return { name: inner.text, kind: 'static' };
  }
  if (typeNode.type === 'generic_type' && Array.isArray(typeNode.namedChildren)) {
    // generic_type 内层可能是 type_identifier 或 qualified_type
    const inner = typeNode.namedChildren.find(
      (c) => c && (c.type === 'type_identifier' || c.type === 'qualified_type'),
    );
    if (inner) return _typeNameToCallee(inner);
  }
  // 兜底：用 text 但截断防止超长
  if (typeof typeNode.text === 'string' && typeNode.text.length <= 60) {
    return { name: typeNode.text, kind: 'unresolved', dynamicReason: 'unrecognized-type-callee' };
  }
  return { name: '<unknown>', kind: 'unresolved', dynamicReason: 'unrecognized-type-callee' };
}

/**
 * 给定 call_expression 节点，返回 callee 名 + kind。
 *
 * 分类规则（label-only，FR-006）：
 *   - function field 是 identifier → kind=function (bare call / type conversion)
 *   - function field 是 selector_expression：
 *     1. operand 是 identifier 且 text 在反射 receiver 集合 → kind=unresolved
 *     2. operand 是 identifier 且 text 在 import alias 集合 → kind=static
 *     3. 其它（chained call / 普通变量名）→ kind=method
 *   - 其它 callee 形态 → kind=unresolved（防御）
 *
 * @param {object} node tree-sitter call_expression
 * @param {Set<string>} importAliases per-file import alias 集合
 * @returns {{name: string, kind: 'method'|'function'|'static'|'unresolved', dynamicReason?: string}}
 */
export function _classifyCallExpression(node, importAliases) {
  if (!node) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-call-expression',
    };
  }
  if (typeof node.childForFieldName !== 'function') {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'no-childForFieldName',
    };
  }

  const fnNode = node.childForFieldName('function');
  if (!fnNode) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-function-field',
    };
  }

  // 1. callee = identifier (bare call / type conversion)
  if (fnNode.type === 'identifier' && typeof fnNode.text === 'string') {
    return { name: fnNode.text, kind: 'function' };
  }

  // 1.5. callee = func_literal — IIFE: defer func(){}() / go func(){}()
  // 用 '<anon-func>' 占位（无名函数 label-only graph compare 不会匹配，但保留 call site 记录）
  if (fnNode.type === 'func_literal') {
    return { name: '<anon-func>', kind: 'function' };
  }

  // 1.6. callee = parenthesized_expression — 通常是 (*T)(x) / (T)(x) 类型转换
  // 解开 parenthesized_expression 取内层 pointer_type / qualified_type / type_identifier
  if (fnNode.type === 'parenthesized_expression') {
    const inner = _unwrapParenthesized(fnNode);
    if (inner) {
      // (*sql.DB)(nil) / (*T)(nil) — pointer_type → qualified_type / type_identifier
      if (inner.type === 'pointer_type' && Array.isArray(inner.namedChildren)) {
        const target = inner.namedChildren.find(
          (c) =>
            c &&
            (c.type === 'type_identifier' ||
              c.type === 'qualified_type' ||
              c.type === 'generic_type'),
        );
        if (target) {
          return _typeNameToCallee(target);
        }
      }
      // (T)(x) / (sql.DB)(x) — 直接 type_identifier / qualified_type
      if (
        inner.type === 'type_identifier' ||
        inner.type === 'qualified_type' ||
        inner.type === 'generic_type'
      ) {
        return _typeNameToCallee(inner);
      }
    }
    return {
      name: '<paren-callee>',
      kind: 'unresolved',
      dynamicReason: 'parenthesized-callee',
    };
  }

  // 2. callee = selector_expression
  if (fnNode.type === 'selector_expression') {
    if (typeof fnNode.childForFieldName !== 'function') {
      return {
        name: '<unknown>',
        kind: 'unresolved',
        dynamicReason: 'selector-no-childForFieldName',
      };
    }
    const operandNode = fnNode.childForFieldName('operand');
    const fieldNode = fnNode.childForFieldName('field');
    if (!fieldNode || typeof fieldNode.text !== 'string') {
      return {
        name: '<unknown>',
        kind: 'unresolved',
        dynamicReason: 'selector-missing-field',
      };
    }
    const calleeName = fieldNode.text;

    // 反射检测优先：operand=reflect/unsafe → unresolved
    if (
      operandNode &&
      operandNode.type === 'identifier' &&
      typeof operandNode.text === 'string' &&
      GO_REFLECTION_RECEIVERS.has(operandNode.text)
    ) {
      return {
        name: calleeName,
        kind: 'unresolved',
        dynamicReason: 'unresolved-reflection',
      };
    }

    // import alias 检测：operand 在 alias 集合 → static
    if (
      operandNode &&
      operandNode.type === 'identifier' &&
      typeof operandNode.text === 'string' &&
      importAliases &&
      typeof importAliases.has === 'function' &&
      importAliases.has(operandNode.text)
    ) {
      return { name: calleeName, kind: 'static' };
    }

    // 默认：method (实例 method / chained / PascalCase 局部变量等)
    return { name: calleeName, kind: 'method' };
  }

  // 3. 其它形态（index_expression / unary_expression 等）→ unresolved
  // 用截断的 text 做 callee 名（避免函数体全文进 fixture）
  const rawText = typeof fnNode.text === 'string' ? fnNode.text : '<unknown>';
  const safeName = rawText.length <= 60 ? rawText : '<unknown>';
  return {
    name: safeName,
    kind: 'unresolved',
    dynamicReason: 'unrecognized-callee-kind',
  };
}

/**
 * 从 method_declaration 的 receiver 字段提取 type 名（值 receiver / 指针 / 泛型 / 嵌套指针）。
 *
 * 支持形态（Codex Round 1 WARNING #2 扩充）：
 *   - 值 receiver: `(t T)` → "T"
 *   - 指针 receiver: `(t *T)` → "T"
 *   - 嵌套指针: `(t **T)` → "T"
 *   - 泛型 receiver: `(t MyType[K, V])` → "MyType"
 *   - 泛型指针: `(t *MyType[K])` → "MyType"
 *
 * tree-sitter-go grammar：
 *   method_declaration
 *     ├ receiver: parameter_list
 *     │   └ parameter_declaration
 *     │       ├ identifier "t"          (receiver name; optional)
 *     │       └ pointer_type | type_identifier | generic_type  (receiver type)
 *     │           └ ...递归
 *     └ name: field_identifier
 *
 * @param {object} methodDecl tree-sitter method_declaration node
 * @returns {string|null} type 名（如 "T"）或 null（无法解析）
 */
function _extractReceiverTypeName(methodDecl) {
  const receiverField = _getField(methodDecl, 'receiver');
  if (!receiverField || receiverField.type !== 'parameter_list') return null;
  const named = Array.isArray(receiverField.namedChildren) ? receiverField.namedChildren : [];
  for (const param of named) {
    if (!param || param.type !== 'parameter_declaration') continue;
    const paramChildren = Array.isArray(param.namedChildren) ? param.namedChildren : [];
    for (const child of paramChildren) {
      if (!child) continue;
      // 跳过 receiver 名字（identifier）— 只在 type 节点中找
      if (child.type === 'identifier') continue;
      const typeName = _extractTypeNameRecursive(child);
      if (typeName) return typeName;
    }
  }
  return null;
}

/**
 * 递归从 type 节点中提取末段 type_identifier 名。
 *
 * Codex Round 1 WARNING #2 修订：支持嵌套 pointer_type / generic_type。
 *
 * @param {object} node 起点（pointer_type / type_identifier / generic_type 等）
 * @returns {string|null}
 */
function _extractTypeNameRecursive(node) {
  if (!node) return null;
  if (node.type === 'type_identifier' && typeof node.text === 'string') {
    return node.text;
  }
  // 指针 / 嵌套指针：递归 unwrap
  if (node.type === 'pointer_type' && Array.isArray(node.namedChildren)) {
    for (const child of node.namedChildren) {
      const inner = _extractTypeNameRecursive(child);
      if (inner) return inner;
    }
  }
  // 泛型：generic_type 含 type_identifier + type_arguments
  if (node.type === 'generic_type' && Array.isArray(node.namedChildren)) {
    const inner = node.namedChildren.find(
      (c) =>
        c &&
        (c.type === 'type_identifier' || c.type === 'qualified_type'),
    );
    if (inner) return _extractTypeNameRecursive(inner);
  }
  // 跨包 type: qualified_type "pkg.T"
  if (node.type === 'qualified_type' && Array.isArray(node.namedChildren)) {
    const inner = node.namedChildren.find(
      (c) => c && c.type === 'type_identifier',
    );
    if (inner && typeof inner.text === 'string') return inner.text;
  }
  return null;
}

/**
 * 向上查找当前节点所在的 caller scope（最近的 function_declaration / method_declaration /
 * func_literal）。
 *
 * 返回 caller 字符串，形如：
 *   - "rel/path.go:funcName"
 *   - "rel/path.go:Type.methodName"
 *   - "rel/path.go:<closure:line:col>"
 *   - "rel/path.go:<top-level>"
 *
 * @param {object} node tree-sitter node
 * @param {string} relPath
 * @returns {string}
 */
export function _resolveGoCaller(node, relPath) {
  let cursor = node ? node.parent : null;

  while (cursor) {
    const t = cursor.type;

    if (t === 'function_declaration') {
      const nameNode = _getField(cursor, 'name');
      const fnName =
        nameNode && typeof nameNode.text === 'string' ? nameNode.text : '<anon-func>';
      return `${relPath}:${fnName}`;
    }

    if (t === 'method_declaration') {
      const nameNode = _getField(cursor, 'name');
      const methodName =
        nameNode && typeof nameNode.text === 'string' ? nameNode.text : '<anon-method>';
      const typeName = _extractReceiverTypeName(cursor);
      return typeName
        ? `${relPath}:${typeName}.${methodName}`
        : `${relPath}:${methodName}`;
    }

    if (t === 'func_literal') {
      const line = _goNodeLine(cursor);
      const col = cursor.startPosition?.column ?? 0;
      return `${relPath}:<closure:${line}:${col}>`;
    }

    cursor = cursor.parent;
  }

  return `${relPath}:<top-level>`;
}

/**
 * 检查 call_expression 是否是 phantom（callee 子树含 ERROR/MISSING 或与 sibling ERROR 共存）。
 *
 * Codex Phase 4D 经验：phantom call 应只 skip 抽取（避免污染 truth set），但 children
 * 仍要 walk（避免误杀真实嵌套 call）。
 *
 * @param {object} callExpr call_expression 节点
 * @returns {boolean} 是否为 phantom
 */
function _isPhantomCall(callExpr) {
  if (!callExpr) return true;
  const fn = _getField(callExpr, 'function');
  if (!fn) return true;
  if (fn.hasError === true) return true;
  if (fn.isMissing && fn.isMissing()) return true;
  // sibling ERROR 检查：parent 的 namedChildren 中有 ERROR/MISSING 兄弟
  const parent = callExpr.parent;
  if (parent && Array.isArray(parent.namedChildren)) {
    for (const sib of parent.namedChildren) {
      if (sib === callExpr) continue;
      if (!sib) continue;
      if (sib.type === 'ERROR' || sib.type === 'MISSING') return true;
    }
  }
  return false;
}

/**
 * 递归 walk Go AST，抽取 call_expression。
 *
 * @param {object} root 起始节点
 * @param {string} relPath
 * @param {{items: TruthCall[]}} truthBuf
 * @param {ExtractWarning[]} warnings
 * @param {Set<string>} importAliases
 */
export function _walkGoAst(root, relPath, truthBuf, warnings, importAliases) {
  if (!root) return;
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    // ERROR / MISSING 节点：跳过子树
    if (node.type === 'ERROR' || node.type === 'MISSING') {
      continue;
    }
    if (typeof node.isMissing === 'function' && node.isMissing()) {
      continue;
    }

    // 抽取 call_expression
    if (node.type === 'call_expression') {
      if (_isPhantomCall(node)) {
        // phantom: 不抽取，但 children 仍 walk
      } else {
        const { name, kind, dynamicReason } = _classifyCallExpression(node, importAliases);
        if (kind === 'unresolved' && dynamicReason) {
          warnings.append({
            file: relPath,
            line: _goNodeLine(node),
            code: dynamicReason,
            message: dynamicReason,
          });
        }
        truthBuf.items.push({
          caller: _resolveGoCaller(node, relPath),
          callee: name,
          file: relPath,
          line: _goNodeLine(node),
          kind,
          ...(dynamicReason ? { dynamicReason } : {}),
        });
      }
    }

    // children 入栈
    const named = Array.isArray(node.namedChildren) ? node.namedChildren : [];
    for (let i = named.length - 1; i >= 0; i--) {
      if (named[i]) stack.push(named[i]);
    }
  }
}

/**
 * 处理单个 .go 文件：parse → 抽取 → 写 truthBuf / warnings。
 *
 * @param {string} absPath
 * @param {string} relPath
 * @param {object} parser
 * @param {{items: TruthCall[]}} truthBuf
 * @param {ExtractWarning[]} warnings
 */
function _processOneGoFile(absPath, relPath, parser, truthBuf, warnings) {
  let source;
  try {
    source = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    warnings.append({
      file: relPath,
      code: 'parse-error',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let tree;
  try {
    tree = parser.parse(source);
  } catch (err) {
    warnings.append({
      file: relPath,
      code: 'parse-error',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const root = tree.rootNode;
  if (root.hasError) {
    warnings.append({
      file: relPath,
      code: 'parse-error-partial',
      message: 'tree-sitter rootNode hasError=true，仍尝试节点级 walk',
    });
  }

  // 收集本文件 import alias 集合
  const importAliases = _scanImports(root);
  _walkGoAst(root, relPath, truthBuf, warnings, importAliases);
}

/**
 * Feature 150 Phase 4C — Go truth set 抽取入口。
 *
 * @param {ExtractOptions} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractGoCallSites(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('extractGoCallSites: options 必须为对象');
  }
  const { sourceRoot, baseline, ignoreDirs } = options;
  if (!sourceRoot || typeof sourceRoot !== 'string') {
    throw new Error('extractGoCallSites: sourceRoot 必须为非空字符串');
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`extractGoCallSites: source root 不存在 path="${sourceRoot}"`);
  }

  const { parser } = await loadTreeSitterGrammar('go');
  const truthBuf = { items: [] };
  const warnings = createWarningsArray();

  // Codex Round 1 WARNING #3 修订：ignoreDirs merge 而非覆盖默认值
  // 之前直接传 ignoreDirs 会让 vendor/.git/node_modules 不再被忽略
  const mergedIgnoreDirs = ignoreDirs
    ? [...DEFAULT_IGNORE_DIRS, ...ignoreDirs]
    : undefined; // undefined → walkSourceFiles 用自己的 DEFAULT_IGNORE_DIRS
  const files = walkSourceFiles(sourceRoot, GO_EXTENSIONS, mergedIgnoreDirs);
  for (const absPath of files) {
    // POSIX 归一（Codex CRITICAL #5）
    const relRaw = path.relative(sourceRoot, absPath);
    const relPath = relRaw.split(path.sep).join('/');
    _processOneGoFile(absPath, relPath, parser, truthBuf, warnings);
  }

  // 排序保证稳定输出（caller asc, line asc, callee asc）
  truthBuf.items.sort((a, b) => {
    if (a.caller !== b.caller) return a.caller < b.caller ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.callee !== b.callee) return a.callee < b.callee ? -1 : 1;
    return 0;
  });

  /** @type {ExtractResult} */
  const result = {
    language: 'go',
    truthCalls: truthBuf.items,
    warnings: warnings.items,
  };

  if (baseline && typeof baseline === 'object' && typeof baseline.scope === 'string') {
    const meta = buildMetadataHeader({
      language: 'go',
      baseline,
      extractorVersion: EXTRACTOR_VERSION,
    });
    result.baseline = meta.baseline;
  }

  return result;
}
