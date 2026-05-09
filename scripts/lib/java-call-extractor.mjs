/**
 * Feature 150 Phase 4B — Java Call Site AST Extractor
 *
 * 输入 source root（绝对路径，含 *.java），输出真实调用点 truth set。
 *
 * 抽取规则（plan.md §Tree-sitter query 关键模式 Java 部分，2026-05-05 修订后真实
 * tree-sitter-java grammar node types，由 probe-java.mjs 实测验证）：
 *
 *   - method_invocation：基础方法调用，含字段：
 *       - object（可选，receiver；type=super 时 → kind=super；其它 → kind=method）
 *       - name（identifier，callee 名）
 *       - arguments（argument_list）
 *   - object_creation_expression：new ClassName() 或 new Generic<T>()
 *       - type 字段：type_identifier 或 generic_type（含 type_identifier 内层）
 *       - 数组创建（new int[]{...} / new String[10]）属于 array_creation_expression，
 *         **不在抽取范围**
 *   - explicit_constructor_invocation：构造器内 super() / this()
 *       - constructor 字段 type=super 或 type=this（keyword）→ kind=super
 *
 * caller 形态：`<rel-path>:<Class.method | Class.<init> | <lambda:line:col> | <top-level>>`
 *   - method_declaration：用 field name；外层 class_declaration / interface_declaration
 *     的 field name 作前缀
 *   - constructor_declaration：method 名替换为 `<init>`（JVM convention，区分构造器）
 *   - lambda_expression：`<lambda:line:col>`（Phase 4D Codex round 2 修订：行+列唯一化
 *     避免同行嵌套两 lambda 碰撞）
 *
 * Codex Phase 4D 经验教训预防（CRITICAL #1~#4）：
 *   1. rootNode.hasError 不整文件 skip → 仅记录 parse-error-partial 警告，节点级 walk
 *   2. ERROR / MISSING 节点跳过子树
 *   3. _resolveJavaCaller 嵌套优先：从最近 method/constructor/lambda scope 立即返回
 *   4. phantom call 防护：method_invocation / object_creation_expression 检查 callee
 *      子树 hasError + sibling 中是否有 ERROR / MISSING；phantom 时 **仅 skip 抽取，
 *      children 仍 walk**（避免内层真实 call 被误杀）
 *   5. POSIX path 归一：`path.relative().split(path.sep).join('/')`
 *
 * 契约源：spec.md FR-007 / FR-013 / FR-014；plan.md "共享接口契约"；tasks.md T-006~T-008。
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
const JAVA_EXTENSIONS = Object.freeze(['.java']);

// ── 类型 JSDoc ──

/**
 * @typedef {Object} TruthCall
 * @property {string} caller
 * @property {string} callee
 * @property {string} file - 相对 sourceRoot 的路径
 * @property {number} line - 1-based 行号
 * @property {'method'|'static'|'constructor'|'super'|'unresolved'} kind
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
 * @property {'java'} language
 * @property {TruthCall[]} truthCalls
 * @property {ExtractWarning[]} warnings
 * @property {object} [baseline]
 */

// ── 工具函数 ──

/** tree-sitter row 是 0-based，统一返回 1-based 行号 */
export function _javaNodeLine(node) {
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

// Codex Phase 4B CRITICAL #2 修订（Round 2 扩充：CRITICAL #3 add Constructor / Proxy 反射）：
// 反射 method 名集合（按 callee 名识别 unresolved-reflection）。Java 标准反射 API；callee 名匹配时
// 标 unresolved 触发 FR-009 fallback + warnings (FR-010)。
//
// Codex Round 2 CRITICAL #4 known limitation: 用户自定义同名 method（如 `c.invoke()`）会被误标
// unresolved（false positive）。但 false negative cost（漏检反射违反 FR-009）通常更大。当前
// 接受 false positive 的小概率风险；后续可结合 receiver 类型约束（需符号解析）做精细化。
// Feature 154 — 顶部 export 三常量供 mapper TS 测试做"集合相等"同源校验
// （仅加 export 关键字，集合内容、辅助函数和 extractJavaCallSites 行为不变）
export const REFLECTION_METHOD_NAMES = new Set([
  'forName', // Class.forName(...)
  'invoke', // Method.invoke(...) / Constructor.invoke(...)
  'newInstance', // Class.newInstance() / Constructor.newInstance(...)
  'getDeclaredMethod', // Class.getDeclaredMethod(...)
  'getMethod', // Class.getMethod(...)
  'getDeclaredField', // Class.getDeclaredField(...)
  'getField', // Class.getField(...)
  // Codex Round 2 CRITICAL #3 修订：补 Constructor 反射 + Proxy
  'getConstructor', // Class.getConstructor(...)
  'getDeclaredConstructor', // Class.getDeclaredConstructor(...)
  'getConstructors', // Class.getConstructors()
  'getDeclaredConstructors', // Class.getDeclaredConstructors()
  'newProxyInstance', // Proxy.newProxyInstance(...)
]);

/**
 * Codex Round 3 CRITICAL 修订：Java 标准库 acronym 类型白名单。
 *
 * 这些类型名全大写但属于 Java 标准库类型 (不是常量)。`java.util.UUID.randomUUID()`、
 * `java.net.URL.create()`、`org.json.JSON.parse()` 等都需要被分类为 static。
 *
 * 不要添加: LOGGER / MAX / MIN / DB_URL / SQL_TIMEOUT 等 — 这些是常量名而非类型名。
 */
export const JAVA_ACRONYM_TYPE_NAMES = new Set([
  'URL', 'URI', 'UUID', // java.net.URL / URI; java.util.UUID
  'XML', 'JSON', 'CSV', // 第三方解析库
  'API', 'JDBC', 'JNDI', // Java EE
  'AWS', 'TCP', 'UDP', // 网络
  'SQL', 'JPA', // ORM
  'IO', // java.io 抽象（少见但存在）
]);

/**
 * Codex Round 4 修订（CRITICAL fix）：Java 包根名白名单。
 *
 * 用于 FQN type access 检测：只有 leftmost 是已知包根 + 中间层全是小写 package segment 时
 * 才认定为 FQN 类型路径。这避免了 `obj.foo.LOGGER.debug()` 形态被误判为 static
 * （leftmost "obj" 虽然 lowercase 但是局部变量名而非包名）。
 *
 * 包含 Java 标准/扩展、Jakarta EE、TLD 反向（com / org / net / io / edu / gov / mil）。
 * 二级 TLD（uk / cn / au / de）不常见做包根，暂不入集合。
 */
export const JAVA_PACKAGE_ROOT_NAMES = new Set([
  'java', 'javax', 'jakarta', // JDK / Jakarta EE
  'com', 'org', 'net', // 商业/组织/网络 TLD 反向
  'io', 'edu', 'gov', 'mil', // 其它 TLD 反向
]);

/**
 * Codex Round 2 CRITICAL #1 修订（Round 3 扩充：acronym 白名单）：
 * 判断 identifier text 是否是 Java 类型名。
 *
 * Java 命名约定：
 *   - 类型 (PascalCase)：首字母大写 + 至少一个小写字母（Math, Logger, Class, FileInputStream）
 *   - 类型 (Acronym)：全大写 ≥ 2 字符，属于 Java 标准库类型（URL, UUID, XML — 见白名单）
 *   - 常量 (SCREAMING_SNAKE_CASE)：全大写 + 可能含下划线（LOGGER, MAX_SIZE, DB_URL）
 *   - 单字符：边界情况（X 既可作泛型参数也可作类名），按"无小写字母 + 不在白名单"归到 instance
 *
 * @param {string} text identifier 的 text
 * @returns {boolean} 是否符合 Java 类型命名
 */
function _isJavaTypeName(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // 必须首字母大写
  if (!/^[A-Z]/.test(text)) return false;
  // Path 1: PascalCase (含小写) — Math / Logger / FileInputStream
  if (/[a-z]/.test(text)) return true;
  // Path 2 (Round 3 修订): 全大写 acronym 在 Java 标准库白名单中 — URL / UUID / XML
  if (JAVA_ACRONYM_TYPE_NAMES.has(text)) return true;
  return false;
}

/**
 * Codex Round 2 CRITICAL #2 修订（Round 3 扩充：FQN package walk）：
 * 判断 field_access 节点的末段 field 名是否是嵌套类型。
 *
 * 形态：
 *   field_access
 *     ├ object: identifier "Outer" 或又一个 field_access (recursive)
 *     └ field: identifier "Inner"
 *
 * 三层判定：
 *   1. 末段 field 是 PascalCase → 类型路径 → static (Outer.Inner / java.util.List)
 *   2. 末段 field 在 acronym 白名单 → 类型路径 → static (java.net.URL)
 *   3. (Round 3) 末段 field 全大写 + 整条链最左 identifier 是小写 → 推断为 FQN 路径下的
 *      acronym 类型 → static (java.util.UUID, com.fasterxml.jackson.JSON)
 *      此 path 比白名单更通用，能识别第三方/项目自定义 acronym 类型。
 *
 * @param {object} node tree-sitter field_access node
 * @returns {boolean} 末段 field 名是类型名
 */
function _fieldAccessTerminalIsType(node) {
  if (!node || typeof node.childForFieldName !== 'function') return false;
  const fieldNameNode = node.childForFieldName('field');
  if (!fieldNameNode || typeof fieldNameNode.text !== 'string') return false;
  const fieldText = fieldNameNode.text;
  // Path 1+2: PascalCase 或 acronym 白名单
  if (_isJavaTypeName(fieldText)) return true;
  // Path 3 (Round 4 CRITICAL fix): 全大写 field + 整条链是已知 Java 包路径 → FQN type
  // 替代 Round 3 的"leftmost lowercase"启发式，避免 `obj.foo.LOGGER.debug()` 误判为 static
  if (/^[A-Z]/.test(fieldText)) {
    if (_looksLikePackageQualifiedType(node)) return true;
  }
  return false;
}

/**
 * Codex Round 4 修订（CRITICAL fix）：判断 field_access 链是否是 "包路径.类型" 形态。
 *
 * 收集 field_access 链的所有 segment（从 leftmost identifier 到末段 field），
 * 然后验证：
 *   1. 链至少 3 段（leftmost + 至少 1 个 middle + 末段类型）
 *   2. leftmost 是已知 Java 包根（java/javax/jakarta/com/org/net/io/edu/gov/mil）
 *   3. 除末段外每段都是 lowercase package segment 形态（^[a-z][a-z0-9_]*$）
 *
 * 示例：
 *   - `java.util.UUID` → segments=[java,util,UUID]，leftmost=java(包根)，中间 util(lowercase) → ✓
 *   - `com.foo.bar.SomeClass` → segments=[com,foo,bar,SomeClass]，✓
 *   - `obj.foo.LOGGER` → segments=[obj,foo,LOGGER]，leftmost=obj 不在包根 → ✗ (修复 Round 4 CRITICAL)
 *   - `com.LOGGER` → segments=[com,LOGGER]，长度 < 3 → ✗ (避免短链误判)
 *
 * @param {object} node field_access 起点
 * @returns {boolean} 是否符合包路径.类型 形态
 */
function _looksLikePackageQualifiedType(node) {
  const segments = _fieldAccessSegments(node);
  if (!segments || segments.length < 3) return false;
  const packageSegments = segments.slice(0, -1); // 末段是类型，前面都该是 package
  if (!JAVA_PACKAGE_ROOT_NAMES.has(packageSegments[0])) return false;
  return packageSegments.every((s) => /^[a-z][a-z0-9_]*$/.test(s));
}

/**
 * Codex Round 4 修订：把 field_access 链拆为 [leftmost, ..., field] 的 segment 数组。
 *
 * 例如 `java.util.UUID` 树形：
 *   field_access(field="UUID")
 *     └ field_access(field="util")
 *         └ identifier "java"
 * 返回 ["java", "util", "UUID"]。
 *
 * 任一节点缺 'object'/'field' 字段或非预期类型 → 返回 null（不可解析）。
 *
 * @param {object} node field_access 起点
 * @returns {string[]|null}
 */
function _fieldAccessSegments(node) {
  // 自底向上收集 field 名，最后反转 + push 最左 identifier
  const reversedSegments = [];
  let cursor = node;
  while (
    cursor &&
    cursor.type === 'field_access' &&
    typeof cursor.childForFieldName === 'function'
  ) {
    const fieldNode = cursor.childForFieldName('field');
    if (!fieldNode || typeof fieldNode.text !== 'string') return null;
    reversedSegments.push(fieldNode.text);
    cursor = cursor.childForFieldName('object');
  }
  if (!cursor || cursor.type !== 'identifier' || typeof cursor.text !== 'string') {
    return null; // leftmost 不是简单 identifier (可能是 method_invocation 等) → 非典型 FQN
  }
  reversedSegments.push(cursor.text);
  return reversedSegments.reverse();
}

/**
 * 给定 method_invocation 节点，返回 callee 名 + kind。
 *
 * 分类规则（基于 field "object" 的 type，"name" 是 callee 名，Codex Phase 4B CRITICAL 修订后）：
 *   - object.type === 'super'                           → kind=super
 *   - callee 名 in REFLECTION_METHOD_NAMES               → kind=unresolved (反射, FR-009)
 *   - object 是 type_identifier / scoped_type_identifier → kind=static (大写命名空间)
 *   - object 是 identifier 且 text 首字母大写            → kind=static (Java 命名约定: ClassName)
 *   - object 不存在 / 其它形态                          → kind=method
 *
 * @param {object} node tree-sitter method_invocation
 * @returns {{name: string, kind: 'method'|'static'|'super'|'unresolved', dynamicReason?: string}}
 */
export function _classifyMethodInvocation(node) {
  if (!node) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-method-invocation',
    };
  }

  // childForFieldName 不可用 → unresolved
  if (typeof node.childForFieldName !== 'function') {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'no-childForFieldName',
    };
  }

  const nameNode = node.childForFieldName('name');
  if (!nameNode || typeof nameNode.text !== 'string') {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-name-field',
    };
  }
  const name = nameNode.text;

  const objectNode = node.childForFieldName('object');

  // 1. super.foo() → kind=super
  if (objectNode && objectNode.type === 'super') {
    return { name, kind: 'super' };
  }

  // 2. Codex Phase 4B CRITICAL #2: 反射调用 → unresolved
  // 检测 Class.forName / Method.invoke 等。callee 名匹配反射集合 + receiver 不是 instance 命名风格
  if (REFLECTION_METHOD_NAMES.has(name)) {
    return {
      name,
      kind: 'unresolved',
      dynamicReason: 'unresolved-reflection',
    };
  }

  // 3. Codex Phase 4B CRITICAL #1+Round 2 修订：static call vs instance method 区分
  // - object 是 type_identifier (List.of() 的 List) / scoped_type_identifier (Outer.Inner.method) → static
  // - object 是 identifier 且 text 是 PascalCase (含小写字母) → static (Math.max, Logger.getLogger)
  //   * 排除 SCREAMING_SNAKE_CASE 常量 (LOGGER, MAX_SIZE) — Round 2 CRITICAL #1 fix
  //   * 排除单字符大写 (X) — 多为泛型参数或保守归入 instance
  // - object 是 field_access 且末段是 PascalCase → static (Outer.Inner.foo / com.foo.Bar.baz)
  //   * Round 2 CRITICAL #2 fix: tree-sitter 在表达式上下文把 nested type qualifier
  //     parse 为 field_access，需用 field 末段名识别
  // - 其它 (this / 小写 identifier instance / 嵌套 field 但末段非类型) → method
  if (objectNode) {
    if (objectNode.type === 'type_identifier' || objectNode.type === 'scoped_type_identifier') {
      return { name, kind: 'static' };
    }
    if (objectNode.type === 'identifier' && typeof objectNode.text === 'string') {
      // Codex Round 2 CRITICAL #1: 用 _isJavaTypeName 替代 /^[A-Z]/，排除 LOGGER 等常量
      if (_isJavaTypeName(objectNode.text)) {
        return { name, kind: 'static' };
      }
    }
    // Codex Round 2 CRITICAL #2: field_access 末段是类型名 → static (nested / FQN type access)
    if (objectNode.type === 'field_access' && _fieldAccessTerminalIsType(objectNode)) {
      return { name, kind: 'static' };
    }
  }

  // 4. 无 object 或其它形态 → method（裸调用 / instance method / chained call）
  return { name, kind: 'method' };
}

/**
 * 给定 object_creation_expression 节点，返回构造名 + kind=constructor。
 *
 * type 字段可能是：
 *   - type_identifier（new Foo()）
 *   - generic_type（new ArrayList<Integer>()）→ 内层 type_identifier
 *
 * @param {object} node tree-sitter object_creation_expression
 * @returns {{name: string, kind: 'constructor'|'unresolved', dynamicReason?: string}}
 */
export function _classifyObjectCreation(node) {
  if (!node) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-object-creation',
    };
  }
  if (typeof node.childForFieldName !== 'function') {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'no-childForFieldName',
    };
  }
  const typeNode = node.childForFieldName('type');
  if (!typeNode) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-type-field',
    };
  }

  if (typeNode.type === 'type_identifier' && typeof typeNode.text === 'string') {
    return { name: typeNode.text, kind: 'constructor' };
  }

  if (typeNode.type === 'generic_type') {
    // 拆出内层 type_identifier / scoped_type_identifier 作为 callee
    // Round 2 W1 修订：scoped_type_identifier 也作 first-pass 候选（new Outer.Inner<T>()）
    const named = Array.isArray(typeNode.namedChildren) ? typeNode.namedChildren : [];
    const inner = named.find(
      (c) => c && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier'),
    );
    if (inner && typeof inner.text === 'string') {
      return { name: _normalizeJavaTypeName(inner.text), kind: 'constructor' };
    }
    // 没拿到内层 type_identifier → 退回 generic_type.text 但先剥离 type arguments
    // Codex Round 2 W1 修订：避免输出 "ArrayList<String>" / "Inner<T>"（破坏 label-only 对齐）
    if (typeof typeNode.text === 'string') {
      return { name: _normalizeJavaTypeName(_stripTypeArgs(typeNode.text)), kind: 'constructor' };
    }
  }

  // Codex Phase 4B WARNING #3 修订：scoped_type_identifier (e.g. Outer.Inner) → 取末尾段
  // 避免 callee="Outer.Inner" 跟 graph 中 "Inner" label 失配（label-only 匹配规则）
  if (typeNode.type === 'scoped_type_identifier' && typeof typeNode.text === 'string') {
    return { name: _normalizeJavaTypeName(typeNode.text), kind: 'constructor' };
  }

  // 其它边界 → 取 text 末段作 callee（先剥泛型参数防御）
  if (typeof typeNode.text === 'string' && typeNode.text.length > 0) {
    return {
      name: _normalizeJavaTypeName(_stripTypeArgs(typeNode.text)),
      kind: 'constructor',
    };
  }

  return {
    name: '<unknown>',
    kind: 'unresolved',
    dynamicReason: 'unrecognized-type-field',
  };
}

/**
 * Codex Phase 4B WARNING #3 修订：把 scoped type name (e.g. Outer.Inner / com.foo.Bar)
 * normalize 到末尾段，确保 label-only 匹配在 graph compare 时与 graph 节点 label 对齐。
 */
function _normalizeJavaTypeName(name) {
  if (typeof name !== 'string' || name.length === 0) return name;
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? name : name.slice(lastDot + 1);
}

/**
 * Codex Round 2 WARNING #1 修订：剥离 generic_type.text 中的 type arguments，
 * 例如 "ArrayList<String>" → "ArrayList" / "Outer.Inner<T,K>" → "Outer.Inner"。
 * 用于 generic_type fallback 路径（无内层 type_identifier 命中时）。
 */
function _stripTypeArgs(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const ltIdx = text.indexOf('<');
  return ltIdx === -1 ? text : text.slice(0, ltIdx);
}

/**
 * 给定 explicit_constructor_invocation 节点（构造器内 super() / this()），
 * 返回 callee=super|this，kind=super。
 *
 * @param {object} node
 * @returns {{name: string, kind: 'super'|'unresolved', dynamicReason?: string}}
 */
export function _classifyExplicitConstructorInvocation(node) {
  if (!node) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-explicit-constructor',
    };
  }
  if (typeof node.childForFieldName !== 'function') {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'no-childForFieldName',
    };
  }
  const ctorNode = node.childForFieldName('constructor');
  if (!ctorNode) {
    return {
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-constructor-field',
    };
  }
  const t = ctorNode.type;
  if (t === 'super' || t === 'this') {
    return { name: t, kind: 'super' };
  }
  return {
    name: typeof ctorNode.text === 'string' ? ctorNode.text : '<unknown>',
    kind: 'unresolved',
    dynamicReason: 'unrecognized-explicit-constructor-kind',
  };
}

/**
 * 向上查找当前节点所在的 caller scope（最近的 method_declaration / constructor_declaration /
 * lambda_expression）。
 *
 * 返回 caller 字符串，形如：
 *   - "rel/path.java:ClassName.method"
 *   - "rel/path.java:ClassName.<init>"  (constructor)
 *   - "rel/path.java:<lambda:line:col>"
 *   - "rel/path.java:<top-level>"
 *
 * Codex Phase 4D CRITICAL #3 修订（嵌套优先）：从调用点向上遍历，遇到第一个
 * function-like scope（method_declaration / constructor_declaration / lambda_expression）
 * 立即决定 caller，不再继续向外。这样：
 *   class Foo { void bar() { list.forEach(x -> doIt(x)); } }
 * doIt(x) 的 caller 是 "rel:<lambda:line:col>" 而不是 "rel:Foo.bar"。
 *
 * @param {object} node tree-sitter node
 * @param {string} relPath
 * @returns {string}
 */
export function _resolveJavaCaller(node, relPath) {
  let cursor = node ? node.parent : null;

  while (cursor) {
    const t = cursor.type;

    if (t === 'method_declaration') {
      const nameNode = _getField(cursor, 'name');
      const methodName = nameNode && typeof nameNode.text === 'string' ? nameNode.text : '<anon-method>';
      const className = _findEnclosingTypeName(cursor.parent);
      return className
        ? `${relPath}:${className}.${methodName}`
        : `${relPath}:${methodName}`;
    }

    if (t === 'constructor_declaration') {
      // constructor name === class name；JVM convention 用 "<init>"
      const className = _findEnclosingTypeName(cursor.parent);
      return className
        ? `${relPath}:${className}.<init>`
        : `${relPath}:<init>`;
    }

    // Codex Phase 4B WARNING #1 修订：record types (Java 14+) 的 compact constructor
    // record Point(int x, int y) { Point { /* validation */ } }
    // 形态识别为 compact_constructor_declaration，归一到与 constructor_declaration 一致的 "<init>"。
    if (t === 'compact_constructor_declaration') {
      const className = _findEnclosingTypeName(cursor.parent);
      return className
        ? `${relPath}:${className}.<init>`
        : `${relPath}:<init>`;
    }

    if (t === 'lambda_expression') {
      const line = _javaNodeLine(cursor);
      const col = cursor.startPosition?.column ?? 0;
      return `${relPath}:<lambda:${line}:${col}>`;
    }

    cursor = cursor.parent;
  }

  return `${relPath}:<top-level>`;
}

/**
 * 给定 class_body / interface_body / enum_body 等容器节点，回溯到最近
 * class_declaration / interface_declaration / enum_declaration / record_declaration，
 * 取其 name 字段。匿名类（object_creation_expression 直接含 class_body）则返回 <anon-class>。
 *
 * @param {object} node 通常是 class_body 或上层
 * @returns {string|null}
 */
function _findEnclosingTypeName(node) {
  let cursor = node;
  while (cursor) {
    const t = cursor.type;
    if (
      t === 'class_declaration' ||
      t === 'interface_declaration' ||
      t === 'enum_declaration' ||
      t === 'record_declaration' ||
      t === 'annotation_type_declaration'
    ) {
      const nameNode = _getField(cursor, 'name');
      if (nameNode && typeof nameNode.text === 'string') {
        return nameNode.text;
      }
      return '<anon-class>';
    }
    // 匿名类：method_declaration 父 class_body 父是 object_creation_expression
    // 即 new Runnable() { void run() {...} } 的内部 method
    if (t === 'object_creation_expression') {
      return '<anon-class>';
    }
    cursor = cursor.parent;
  }
  return null;
}

/**
 * 检查 method_invocation / object_creation_expression / explicit_constructor_invocation
 * 是否是 phantom call（受 parse error 影响）。phantom 时 truth call 不抽，但 children 仍 walk。
 *
 * Codex Phase 4D round 2-4 修订：
 *   - 单看节点 hasError 粒度过粗（误杀 recovery 区域内真实 call）
 *   - 单看 callee.hasError 漏 sibling ERROR
 *   - 综合检查：callee 子树 hasError OR 直接 children 含 ERROR/MISSING sibling
 *
 * @param {object} node
 * @param {string} kind 'method-invocation' | 'object-creation' | 'explicit-constructor'
 */
function _isPhantomCall(node, kind) {
  // 注：node 已由调用方（_walkJavaAst）的 `if (!node) continue` 保证非空，
  // 不再单独防御。
  // 1) 关键字段 (callee / type / constructor) 子树 hasError
  let calleeForCheck = null;
  if (kind === 'method-invocation') {
    calleeForCheck = _getField(node, 'name');
  } else if (kind === 'object-creation') {
    calleeForCheck = _getField(node, 'type');
  } else if (kind === 'explicit-constructor') {
    calleeForCheck = _getField(node, 'constructor');
  }
  if (calleeForCheck && calleeForCheck.hasError === true) {
    return true;
  }

  // 2) 直接 children 中含 ERROR / MISSING
  const allChildren = Array.isArray(node.children) ? node.children : [];
  const hasSiblingError = allChildren.some(
    (c) => c && (c.type === 'ERROR' || c.isMissing === true),
  );
  return hasSiblingError;
}

/**
 * 遍历 AST 抽 call sites（迭代式 DFS，避免大文件递归爆栈）。
 *
 * @param {object} root tree-sitter rootNode
 * @param {string} relPath 相对路径
 * @param {{items: TruthCall[]}} truthCallsBuf
 * @param {{append: (w: ExtractWarning) => void}} warnings
 */
export function _walkJavaAst(root, relPath, truthCallsBuf, warnings) {
  /** @type {object[]} */
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const t = node.type;

    // Codex Phase 4D CRITICAL #1+#2：节点级跳过 ERROR / MISSING 子树（不 walk children）
    if (t === 'ERROR' || node.isMissing === true) {
      continue;
    }

    if (t === 'method_invocation') {
      const phantom = _isPhantomCall(node, 'method-invocation');
      if (!phantom) {
        const cls = _classifyMethodInvocation(node);
        const line = _javaNodeLine(node);
        truthCallsBuf.items.push({
          caller: _resolveJavaCaller(node, relPath),
          callee: cls.name,
          file: relPath,
          line,
          kind: cls.kind,
        });
        if (cls.kind === 'unresolved' && cls.dynamicReason) {
          warnings.append({
            file: relPath,
            line,
            code: 'unresolved-reflection',
            message: cls.dynamicReason,
          });
        }
      }
      // children 仍 walk（即使 phantom 也不跳过，避免内层真实 call 被误杀）
    } else if (t === 'object_creation_expression') {
      const phantom = _isPhantomCall(node, 'object-creation');
      if (!phantom) {
        const cls = _classifyObjectCreation(node);
        const line = _javaNodeLine(node);
        truthCallsBuf.items.push({
          caller: _resolveJavaCaller(node, relPath),
          callee: cls.name,
          file: relPath,
          line,
          kind: cls.kind,
        });
        if (cls.kind === 'unresolved' && cls.dynamicReason) {
          warnings.append({
            file: relPath,
            line,
            code: 'unresolved-reflection',
            message: cls.dynamicReason,
          });
        }
      }
    } else if (t === 'explicit_constructor_invocation') {
      const phantom = _isPhantomCall(node, 'explicit-constructor');
      if (!phantom) {
        const cls = _classifyExplicitConstructorInvocation(node);
        const line = _javaNodeLine(node);
        truthCallsBuf.items.push({
          caller: _resolveJavaCaller(node, relPath),
          callee: cls.name,
          file: relPath,
          line,
          kind: cls.kind,
        });
        if (cls.kind === 'unresolved' && cls.dynamicReason) {
          warnings.append({
            file: relPath,
            line,
            code: 'unresolved-reflection',
            message: cls.dynamicReason,
          });
        }
      }
    }

    // 入栈所有 namedChildren（继续 DFS）
    const children = node.namedChildren;
    if (children && children.length > 0) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  }
}

// ── 单文件处理（test-friendly export）──

/**
 * 处理单个 Java 文件：read + parse + walk，所有异常归一到 parse-error warning。
 *
 * @param {object} parser tree-sitter Parser 实例
 * @param {string} absPath
 * @param {string} relPath
 * @param {{items: TruthCall[]}} truthCallsBuf
 * @param {{append: (w: ExtractWarning) => void}} warnings
 */
export function _processOneJavaFile(parser, absPath, relPath, truthCallsBuf, warnings) {
  try {
    const source = fs.readFileSync(absPath, 'utf-8');
    const tree = parser.parse(source);

    // Codex Phase 4D CRITICAL #1+#2：hasError 改为节点级跳过而非整文件 skip。
    // _walkJavaAst 内对 ERROR / MISSING 节点跳过子树，但仍处理同文件其它正常子树。
    if (tree.rootNode.hasError) {
      warnings.append({
        file: relPath,
        code: 'parse-error-partial',
        message: 'rootNode hasError — 仍尝试抽取非 error 子树（节点级 salvage）',
      });
    }
    _walkJavaAst(tree.rootNode, relPath, truthCallsBuf, warnings);
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
 * 从 Java 源码 root 抽取 truth calls。
 *
 * @param {ExtractOptions} options
 * @returns {Promise<ExtractResult>}
 */
export async function extractJavaCallSites(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('extractJavaCallSites: options 必须为对象');
  }
  const { sourceRoot, baseline } = options;
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new Error('extractJavaCallSites: options.sourceRoot 必须为非空字符串');
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`extractJavaCallSites: sourceRoot 不存在 path="${sourceRoot}"`);
  }

  const { parser } = await loadTreeSitterGrammar('java');
  const files = walkSourceFiles(sourceRoot, JAVA_EXTENSIONS);

  const truthCallsBuf = { items: /** @type {TruthCall[]} */ ([]) };
  const warnings = createWarningsArray();

  for (const absPath of files) {
    // Codex Phase 4D WARNING #3：跨 OS 分隔符归一为 POSIX (/)，确保 fixture byte-stable
    const relPath = path.relative(sourceRoot, absPath).split(path.sep).join('/');
    _processOneJavaFile(parser, absPath, relPath, truthCallsBuf, warnings);
  }

  /** @type {ExtractResult} */
  const result = {
    language: 'java',
    truthCalls: truthCallsBuf.items,
    warnings: warnings.items,
  };

  if (baseline && typeof baseline === 'object' && typeof baseline.scope === 'string') {
    const meta = buildMetadataHeader({
      language: 'java',
      baseline,
      extractorVersion: EXTRACTOR_VERSION,
    });
    result.baseline = meta.baseline;
  }

  return result;
}
