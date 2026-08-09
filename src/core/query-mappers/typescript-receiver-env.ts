/**
 * TS/JS 文件级**接收者类型绑定环境** — F260 P3（plan §5 变更 #8）。
 *
 * 职责：给定一棵已解析的 tree-sitter `Parser.Tree`，**先全文件走一遍**建立两张表，
 * 供 `typescript-mapper` 在走调用点时查询接收者的真实类名。
 *
 * ## 为什么是两遍式（H4）
 *
 * 边建环境边产出调用点，会让「同名第二个绑定 ⇒ 歧义弃权」只对**之后**的调用点生效——
 * 文件开头的调用点已经带着错误类型出去了。所以环境必须先建完再走调用点。
 *
 * ## 两张**互不相交**的表（plan D2）
 *
 * - **表 1（类名绑定点计数表）**：key = 类名，value = 该名字在本文件的绑定点总数 +
 *   其中来自 import 的个数。只服务 A1 判据（`receiverTypeSoleImportBinding`）。
 * - **表 2（接收者名 → 类名环境）**：key = 接收者名（`this.x` 按 `ClassName#x` 分桶），
 *   value = 推断出的类名，或**中毒**（歧义 / 类型不可知）。只服务 `receiverType`。
 *
 * 两表**语义不同、不可合并**：表 1 数的是「这个名字在本文件被绑了几次」（含纯类型侧的
 * `interface` / `type` / 泛型形参），表 2 记的是「这个名字当前指向哪个类」。
 * 合并会让 `const Foo = …` 这类同名值绑定污染类名计数，故刻意分开两个 Map。
 *
 * ⚠️ 两表的 key 域**有交集**（M1 收口后）：凡在本文件产生**值级绑定**的名字
 * （import / function / class / enum / namespace / 具名函数与类表达式）都要同时进表 2
 * 并**中毒**。它们对本环境而言类型不可知，若只进表 1，另一处同名且带类型注解的形参
 * 就会成为该名字在表 2 里的唯一答案 —— 那是一条确定性假边（plan §13 M1 的三个实测反例）。
 *
 * ## 判据来源
 *
 * A1（绑定点计数）/ A3（`this.x` 宿主分桶与三类宿主弃权）/ A4（赋值也是绑定点）/
 * A5（类型节点形状白名单）/ H7（构造器名走 AST）全部原样承接 `plan.md`，本文件不重新论证。
 *
 * ## 已知取舍（如实登记）
 *
 * 本环境是**文件级**的，不感知块级作用域：不同函数里的同名局部变量共用一个 key。
 * 处置是「歧义即弃权」——同名出现第二个不同类型绑定就整体剔除（plan R-8 登记项）。
 * 这与 `suppressedDynamicAliases` 是同款既定取舍：宁可少出边，不可出错边。
 */
import type Parser from 'web-tree-sitter';

/** 接收者绑定结论：类名 + A1 判据结果。 */
export interface ReceiverBinding {
  /** 推断出的接收者类名 */
  receiverType: string;
  /** 该类名在本文件恰好 1 个绑定点且来自 import（A1 正向许可） */
  soleImportBinding: boolean;
}

/** 文件级接收者类型环境（只读查询接口）。 */
export interface ReceiverTypeEnv {
  /** 表 2 查询：接收者 key → 类名；未登记 / 中毒均返回 `undefined`。 */
  lookupReceiverType(key: string): string | undefined;
  /** 表 1 查询：A1 判据（恰好 1 个绑定点且来自 import）。 */
  isSoleImportBinding(className: string): boolean;
}

/** 表 1 的槽位：绑定点总数 + 其中 import 来源的个数。 */
interface NameBindingSlot {
  total: number;
  fromImport: number;
}

/** 表 2 的槽位；`type === null` 表示**中毒**（歧义或类型不可知），永不再恢复。 */
interface ReceiverSlot {
  type: string | null;
}

// ============================================================
// 节点类型集合
// ============================================================

/**
 * **值级**声明绑定：`name` 字段即绑定名，来源恒为「非 import」。
 *
 * 这些形态在本文件产生一个**值**绑定，因此除了进表 1（遮蔽计数），还必须进表 2 **中毒**
 * （M1）：表 2 的全部安全性建立在「同名第二个绑定即中毒」上，只要有一个值级绑定形态不进表 2，
 * 另一处带类型注解的同名形参就会成为该名字的文件级**唯一**答案，直接产出假边。
 */
const VALUE_DECLARATION_TYPES = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'enum_declaration',
  'function_declaration',
  'generator_function_declaration',
  'function_signature', // declare function f(): void
  'internal_module', // namespace Foo {}
  'module', // module Foo {}
]);

/**
 * **类型级**声明绑定：只占用类型名空间，不产生值绑定。
 *
 * 只进表 1（它们确实遮蔽同名 import 的类型含义，A1 必须计数），**不进表 2**——
 * 表 2 装的是值侧名字，把纯类型名塞进去会白掉不相关的接收者变量。
 * `type_parameter` 是 M3 的收口点：泛型形参名在函数 / 类作用域内彻底遮蔽同名 import。
 */
const TYPE_ONLY_DECLARATION_TYPES = new Set([
  'interface_declaration',
  'type_alias_declaration',
  'type_parameter', // function g<Foo>() / class Box<Foo>（M3）
]);

/** 具名函数 / 类**表达式**：名字只在自身作用域可见，但同样是值级绑定 ⇒ 与声明同档处理。 */
const NAMED_VALUE_EXPRESSION_TYPES = new Set([
  'class', // const K = class Foo {}
  'function_expression', // const f = function foo() {}
  'generator_function', // const f = function* foo() {}
]);

/**
 * 赋值左值中**真正重绑名字**的形态白名单（W-B）。
 *
 * `member_expression` / `subscript_expression`（`a.b = 1` / `a[k] = 1`）改的是**属性**，
 * 名字 `a` 所指未变，必须排除在外。
 *
 * 两个入口共用同一张表（P5b-3）：`assignment_expression` 系列与 `for_in_statement`——
 * for-of / for-in 的左值同样允许是赋值目标（`for (rec.slot of xs)`）。
 * 同一判据分两处各写一份即 F259 型不对称隐患，故只留这一个事实源。
 */
const ASSIGNMENT_BINDING_TARGET_TYPES = new Set(['identifier', 'object_pattern', 'array_pattern']);

/** 会重新绑定 `this` 的函数形态——`this.x` 一旦跨过它就无法再归属到宿主 class（A3）。 */
const THIS_REBINDING_FUNCTION_TYPES = new Set([
  'function',
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
]);

// ============================================================
// AST 小工具
// ============================================================

/**
 * 逐个接缝剥括号（向下）。
 *
 * 不变量照 `ast-analyzer.ts:575-581`：任意深度的 `parenthesized_expression` 出现在任何接缝上
 * 都不得改变形态识别结果，因此必须循环剥到底，**不能只剥一层**。
 */
function stripParens(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
  let cur = node;
  while (cur?.type === 'parenthesized_expression') {
    cur = cur.namedChild(0);
  }
  return cur;
}

/** 向上逐个接缝剥括号。 */
function skipParenParents(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
  let cur = node;
  while (cur?.parent?.type === 'parenthesized_expression') {
    cur = cur.parent;
  }
  return cur;
}

/** `import('...')` 动态 import 调用（D2 判据表，禁文本正则）。 */
function isDynamicImportCall(node: Parser.SyntaxNode | null): boolean {
  return node?.type === 'call_expression' && node.childForFieldName('function')?.type === 'import';
}

/** `require('...')` 调用（D2 判据表，禁文本正则）。 */
function isRequireCall(node: Parser.SyntaxNode | null): boolean {
  if (node?.type !== 'call_expression') return false;
  const fn = node.childForFieldName('function');
  return fn?.type === 'identifier' && fn.text === 'require';
}

/** 判断某个类节点是否带 `extends`（A3：带 extends 的宿主对 `this.x` 一律弃权）。 */
function hasExtendsClause(classNode: Parser.SyntaxNode): boolean {
  for (let i = 0; i < classNode.childCount; i++) {
    const child = classNode.child(i);
    if (child?.type !== 'class_heritage') continue;
    for (let j = 0; j < child.childCount; j++) {
      if (child.child(j)?.type === 'extends_clause') return true;
    }
    // heritage 存在但没识别出 extends_clause：形态未知，按 fail-closed 当作有 extends
    return /\bextends\b/.test(child.text);
  }
  return false;
}

/**
 * 类节点 → `this.x` 的分桶名（A3）。
 *
 * 匿名类（无 `name`）与带 `extends` 的类**一律返回 null（弃权）**：
 * 前者形不成稳定的 key，后者的父类可能声明同名字段而本文件看不到。
 *
 * W-A：**类表达式**（`type === 'class'`，如 `const K = class Same {}`）同样弃权。
 * 类表达式的名字只在自身作用域可见，同一文件里完全可以有两个都叫 `Same` 的无关类表达式，
 * 而分桶键只有类名一维 ⇒ 两者的 `this.x` 会串到同一个桶（一方声明字段、另一方没有时，
 * 后者会白拿前者的类型），故不给类表达式分桶。
 */
function classBucketName(classNode: Parser.SyntaxNode | null): string | null {
  if (classNode == null) return null;
  if (classNode.type !== 'class_declaration' && classNode.type !== 'abstract_class_declaration') {
    return null;
  }
  const name = classNode.childForFieldName('name');
  if (!name) return null;
  if (hasExtendsClause(classNode)) return null;
  return name.text;
}

/** 类成员节点（字段 / 方法）→ 宿主分桶名；宿主是对象字面量时返回 null。 */
function memberHostBucket(memberNode: Parser.SyntaxNode): string | null {
  const body = memberNode.parent;
  if (body?.type !== 'class_body') return null;
  return classBucketName(body.parent);
}

/**
 * 从调用点向上定位 `this` 的宿主分桶（A3）。
 *
 * 箭头函数不重绑 `this`，继续上溯；普通函数 / 对象字面量方法 / 静态块一律弃权。
 */
function resolveThisHostBucket(node: Parser.SyntaxNode): string | null {
  let cur: Parser.SyntaxNode | null = node;
  while (cur != null) {
    const t = cur.type;
    if (t === 'arrow_function') {
      cur = cur.parent;
      continue;
    }
    if (THIS_REBINDING_FUNCTION_TYPES.has(t)) return null;
    if (t === 'class_static_block') return null; // 静态块里的 this 是类本身，不是实例
    if (t === 'method_definition') {
      // M2：静态方法里的 `this` 是类本身，查的应是**静态**字段——而注册侧对静态字段
      // 显式 fail-closed 跳过（只建实例字段桶）。这里若不同样对 static 弃权，
      // 静态方法的 `this.x` 就会去查同名**实例**字段建的桶，拿到另一个类型（假边）。
      // 与 `class_static_block` 同档处理。
      if (findChildType(cur, 'static')) return null;
      // parent 是 class_body 才是类方法；是 `object` 就是对象字面量方法 ⇒ 弃权
      return memberHostBucket(cur);
    }
    if (t === 'class_body') return classBucketName(cur.parent); // 字段初始化器里的 this
    if (t === 'object') return null;
    cur = cur.parent;
  }
  return null;
}

/**
 * A5 裁决 — 从 `type_annotation` 取类名。
 *
 * 只接受**裸 `type_identifier`**，或 `generic_type` 的 name 部分（`Foo<T>` → `Foo`）。
 * `union_type` / `intersection_type` / `conditional_type` / `nested_type_identifier`（`NS.Foo`）/
 * `type_query`（`typeof x`）/ `array_type` 等一律返回 null。
 */
function classNameFromTypeAnnotation(annotation: Parser.SyntaxNode | null): string | null {
  const typeNode = annotation?.type === 'type_annotation' ? annotation.namedChild(0) : null;
  if (!typeNode) return null;
  if (typeNode.type === 'type_identifier') return typeNode.text;
  if (typeNode.type === 'generic_type') {
    const name = typeNode.childForFieldName('name') ?? typeNode.namedChild(0);
    return name?.type === 'type_identifier' ? name.text : null;
  }
  return null;
}

/** H7 — `new Foo()` 的构造器名走 AST 取，非裸 identifier 一律返回 null（禁文本正则）。 */
function classNameFromNewExpression(node: Parser.SyntaxNode | null): string | null {
  if (node?.type !== 'new_expression') return null;
  const ctor = node.childForFieldName('constructor');
  return ctor?.type === 'identifier' ? ctor.text : null;
}

/** 收集一个绑定模式（identifier / object_pattern / array_pattern / …）里的所有绑定名。 */
function collectPatternNames(node: Parser.SyntaxNode | null, out: string[]): void {
  if (!node) return;
  if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') {
    out.push(node.text);
    return;
  }
  // pair_pattern 的 key 是属性名不是绑定名，只递归 value 侧
  if (node.type === 'pair_pattern') {
    collectPatternNames(node.childForFieldName('value'), out);
    return;
  }
  // 结构冗余守卫（非承重判据）：`property_identifier` 是属性名不是绑定名 —— 但它同时是叶子节点，
  // 删掉这条 return 后通用递归照样采不到它（p5-attribution §2.2 实测删除后行为不变）。
  // 真正挡住它的是上面 `out.push` 的白名单；本通路的守护力由用例 N43b 承担。保留本行只为让意图显式。
  if (node.type === 'property_identifier') return;
  for (let i = 0; i < node.namedChildCount; i++) {
    collectPatternNames(node.namedChild(i), out);
  }
}

/**
 * D2 判据表 — `variable_declarator` 的初值是否为 import 来源。
 *
 * 覆盖两行：`await import(...)`（含 `const {X} = await import(...)`）与 `require(...)`。
 * 判不出来的一律按「否」处理（fail-closed，登记 R-9）。
 */
function declaratorValueIsImportSourced(declarator: Parser.SyntaxNode): boolean {
  const value = stripParens(declarator.childForFieldName('value'));
  if (!value) return false;
  if (value.type === 'await_expression') {
    return isDynamicImportCall(stripParens(value.namedChild(0)));
  }
  return isRequireCall(value);
}

/**
 * D2 判据表 — 形参是否为 `import('...').then(cb)` 回调的**首个**形参。
 *
 * 只有首参承载模块命名空间 / 解构绑定，其余形参与 import 无关。
 */
function paramIsImportThenFirstParam(paramNode: Parser.SyntaxNode): boolean {
  let fn = paramNode.parent;
  if (fn?.type === 'formal_parameters') {
    if (fn.namedChild(0)?.id !== paramNode.id) return false;
    fn = fn.parent;
  } else if (fn?.type === 'arrow_function') {
    // 单形参无括号形态：`import('x').then(m => …)`
    if (fn.childForFieldName('parameter')?.id !== paramNode.id) return false;
  } else {
    return false;
  }
  if (fn == null) return false;
  if (fn.type !== 'arrow_function' && !THIS_REBINDING_FUNCTION_TYPES.has(fn.type)) return false;

  const callbackArg = skipParenParents(fn);
  const args = callbackArg?.parent;
  if (args?.type !== 'arguments' || args.namedChild(0)?.id !== callbackArg?.id) return false;
  const call = args.parent;
  if (call?.type !== 'call_expression') return false;
  const callee = call.childForFieldName('function');
  if (callee?.type !== 'member_expression') return false;
  if (callee.childForFieldName('property')?.text !== 'then') return false;
  return isDynamicImportCall(stripParens(callee.childForFieldName('object')));
}

/** 参数是否带可见性修饰（`constructor(private x: Foo)` 的参数属性形态）。 */
function isParameterProperty(paramNode: Parser.SyntaxNode): boolean {
  for (let i = 0; i < paramNode.childCount; i++) {
    const t = paramNode.child(i)?.type;
    if (t === 'accessibility_modifier' || t === 'readonly') return true;
  }
  return false;
}

/** 参数属性所属的构造器宿主分桶；不是构造器参数属性时返回 null。 */
function constructorPropertyHost(paramNode: Parser.SyntaxNode): string | null {
  if (!isParameterProperty(paramNode)) return null;
  const params = paramNode.parent;
  if (params?.type !== 'formal_parameters') return null;
  const method = params.parent;
  if (method?.type !== 'method_definition') return null;
  if (method.childForFieldName('name')?.text !== 'constructor') return null;
  return memberHostBucket(method);
}

// ============================================================
// 环境构建
// ============================================================

/**
 * 建立文件级接收者类型环境（第一遍：全文件 walk）。
 *
 * @param tree - 已解析的 tree-sitter 树
 */
export function buildReceiverTypeEnv(tree: Parser.Tree): ReceiverTypeEnv {
  /** 表 1：类名 → 绑定点计数 */
  const nameBindings = new Map<string, NameBindingSlot>();
  /** 表 2：接收者 key → 类名 / 中毒 */
  const receivers = new Map<string, ReceiverSlot>();

  /** 登记一个绑定点（表 1）。宁可多记：多记只降 recall，漏记会放行遮蔽。 */
  function bindName(name: string | undefined, fromImport: boolean): void {
    if (!name) return;
    const slot = nameBindings.get(name) ?? { total: 0, fromImport: 0 };
    slot.total += 1;
    if (fromImport) slot.fromImport += 1;
    nameBindings.set(name, slot);
  }

  /** 登记一个接收者绑定（表 2）。`type == null` 或与既有类型冲突即中毒，永不恢复。 */
  function bindReceiver(key: string, type: string | null): void {
    const existing = receivers.get(key);
    if (existing === undefined) {
      receivers.set(key, { type });
      return;
    }
    if (existing.type !== type) existing.type = null;
  }

  /**
   * M1 —— 登记一个**值级**绑定：既进表 1（遮蔽计数），也进表 2 **中毒**。
   *
   * 中毒是必需的而不是保守加码：这些名字对本环境而言类型不可知（import 的真身在别的文件、
   * 函数 / 类 / enum / namespace 的类型不是「某个 class」），若它们只进表 1，
   * 另一处同名且带类型注解的形参就成了该名字在表 2 里的唯一答案 ⇒ 确定性假边。
   *
   * 这一步**不损失真边**：这些形态本来就从不往表 2 写类型，中毒只是把「被别人冒名顶替」
   * 这条路堵死。
   */
  function bindValue(name: string | undefined, fromImport: boolean): void {
    if (!name) return;
    bindName(name, fromImport);
    bindReceiver(name, null);
  }

  function visit(node: Parser.SyntaxNode): void {
    switch (node.type) {
      case 'import_statement':
        registerImportBindings(node, bindValue);
        break;

      case 'variable_declarator': {
        const fromImport = declaratorValueIsImportSourced(node);
        const nameNode = node.childForFieldName('name');
        const names: string[] = [];
        collectPatternNames(nameNode, names);
        for (const n of names) bindName(n, fromImport);

        if (nameNode?.type === 'identifier') {
          const type =
            classNameFromTypeAnnotation(node.childForFieldName('type')) ??
            classNameFromNewExpression(node.childForFieldName('value'));
          bindReceiver(nameNode.text, type);
        } else {
          // 解构绑定的元素类型不可知 ⇒ 一律中毒，避免同名类型绑定被它「借用」
          for (const n of names) bindReceiver(n, null);
        }
        break;
      }

      case 'required_parameter':
      case 'optional_parameter': {
        const fromImport = paramIsImportThenFirstParam(node);
        const pattern = node.childForFieldName('pattern');
        const names: string[] = [];
        collectPatternNames(pattern, names);
        for (const n of names) bindName(n, fromImport);

        const type = classNameFromTypeAnnotation(node.childForFieldName('type'));
        if (pattern?.type === 'identifier') {
          bindReceiver(pattern.text, type);
          // A3：构造器参数属性同时是实例字段，按 `ClassName#x` 分桶再登记一次
          const host = constructorPropertyHost(node);
          if (host != null) bindReceiver(`${host}#${pattern.text}`, type);
        } else {
          for (const n of names) bindReceiver(n, null);
        }
        break;
      }

      case 'arrow_function': {
        // 单形参无括号形态：`x => …`（有括号时走 required_parameter 分支）
        const param = node.childForFieldName('parameter');
        if (param?.type === 'identifier') {
          bindName(param.text, paramIsImportThenFirstParam(param));
          bindReceiver(param.text, null);
        }
        break;
      }

      case 'catch_clause': {
        const names: string[] = [];
        collectPatternNames(node.childForFieldName('parameter'), names);
        for (const n of names) {
          bindName(n, false);
          bindReceiver(n, null);
        }
        break;
      }

      case 'for_in_statement': {
        // `for (const it of xs)` 的绑定名不经 variable_declarator，需单独登记，
        // 否则 `it` 在两张表里都缺席 ⇒ 同名类型绑定会被它错误「借用」。
        //
        // ⚠️ 左值形态必须走与 `assignment_expression` **同一张**白名单（P5b-3）：
        // for-of / for-in 的左值允许是赋值目标而非声明（`for (rec.slot of xs)` /
        // `for (rec[0] of xs)`），此时改的是 `rec` 的**属性**，`rec` 本身不重绑。
        // 不挡住这两种形态就会把接收者 `rec` 误中毒，白掉一批真边。
        // 声明形态（`const` / `let` / `var`）的左值恒为 identifier / object_pattern /
        // array_pattern，全部在白名单内，不受影响。
        const left = node.childForFieldName('left');
        if (!left || !ASSIGNMENT_BINDING_TARGET_TYPES.has(left.type)) break;
        const names: string[] = [];
        collectPatternNames(left, names);
        for (const n of names) {
          bindName(n, false);
          bindReceiver(n, null);
        }
        break;
      }

      case 'public_field_definition': {
        const host = memberHostBucket(node);
        const nameNode = node.childForFieldName('name');
        // 静态字段与实例字段的 `this` 语义不同，静态侧一律不登记（fail-closed）
        if (host == null || nameNode == null || findChildType(node, 'static')) break;
        const type =
          classNameFromTypeAnnotation(node.childForFieldName('type')) ??
          classNameFromNewExpression(node.childForFieldName('value'));
        bindReceiver(`${host}#${nameNode.text}`, type);
        break;
      }

      case 'assignment_expression':
      case 'augmented_assignment_expression': {
        // A4：赋值是一个**类型不可知**的绑定点——它不是声明，上面任何一条都捕获不到，
        // 却真实改变了绑定所指。
        // W-B 收口两面：`||=` / `??=` / `+=` 等增广赋值（同样重绑）与非 identifier 左值
        // （`({x} = p)` / `[x] = arr` 解构赋值，绑定名藏在 pattern 里）。
        //
        // ⚠️ 左值形态必须白名单：`a.b = 1` / `a[k] = 1` **不重绑 `a`**，
        // 若也走 `collectPatternNames` 会把接收者 `a` 误中毒，白掉一批真边。
        const left = node.childForFieldName('left');
        if (!left || !ASSIGNMENT_BINDING_TARGET_TYPES.has(left.type)) break;
        const names: string[] = [];
        collectPatternNames(left, names);
        for (const n of names) {
          bindName(n, false);
          bindReceiver(n, null);
        }
        break;
      }

      default:
        if (VALUE_DECLARATION_TYPES.has(node.type) || NAMED_VALUE_EXPRESSION_TYPES.has(node.type)) {
          bindValue(node.childForFieldName('name')?.text, false);
        } else if (TYPE_ONLY_DECLARATION_TYPES.has(node.type)) {
          bindName(node.childForFieldName('name')?.text, false);
        }
        break;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(tree.rootNode);

  return {
    lookupReceiverType(key: string): string | undefined {
      return receivers.get(key)?.type ?? undefined;
    },
    isSoleImportBinding(className: string): boolean {
      const slot = nameBindings.get(className);
      // A1：≥2 拦（存在遮蔽）/ =1 且非 import 拦 / =0 拦（fail-closed）
      return slot !== undefined && slot.total === 1 && slot.fromImport === 1;
    },
  };
}

/** 查找指定类型的直接子节点（含匿名 token，如 `static`）。 */
function findChildType(node: Parser.SyntaxNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === type) return true;
  }
  return false;
}

/**
 * 登记一条 `import_statement` 引入的所有绑定名（全部算 import 来源）。
 *
 * M1：传入的 `bindValue` 同时写两张表 —— import 名对本文件而言类型不可知（真身在别的文件），
 * 只进表 1 会让同名形参独占表 2。
 */
function registerImportBindings(
  node: Parser.SyntaxNode,
  bindValue: (name: string | undefined, fromImport: boolean) => void,
): void {
  const visit = (n: Parser.SyntaxNode): void => {
    switch (n.type) {
      case 'import_specifier':
        // 重命名时本地绑定名是 alias，未重命名时是 name
        bindValue((n.childForFieldName('alias') ?? n.childForFieldName('name'))?.text, true);
        return;
      case 'namespace_import': // `* as NS`
      case 'import_require_clause': // `import IE = require('./x')`
        bindValue(n.namedChild(0)?.text, true);
        return;
      default:
        break;
    }
    if (n.type === 'import_clause') {
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (!child) continue;
        // import_clause 直挂的 identifier 就是 default import 绑定名
        if (child.type === 'identifier') bindValue(child.text, true);
        else visit(child);
      }
      return;
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) visit(child);
    }
  };
  visit(node);
}

// ============================================================
// 调用点查询（第二遍：走调用点时调用）
// ============================================================

/**
 * 从一个 member 调用的接收者表达式推断 `ReceiverBinding`。
 *
 * 覆盖三种接收者形态，其余（`this.m()` 的裸 `this`、`super`、下标、调用链…）一律返回
 * `undefined`——**不夺既有 resolver 路径**（plan R12 回归断言）。
 *
 * @param env - `buildReceiverTypeEnv` 产出的环境
 * @param memberNode - `member_expression` / `optional_member_expression` 节点
 */
export function resolveCallSiteReceiver(
  env: ReceiverTypeEnv,
  memberNode: Parser.SyntaxNode,
): ReceiverBinding | undefined {
  const objectNode = memberNode.childForFieldName('object');
  if (!objectNode) return undefined;

  // 形态 1：裸标识符接收者 `a.m()`
  if (objectNode.type === 'identifier') {
    return bind(env, env.lookupReceiverType(objectNode.text));
  }

  // 形态 2：实例字段接收者 `this.x.m()`（A3：按宿主 class 分桶）
  if (objectNode.type === 'member_expression' || objectNode.type === 'optional_member_expression') {
    const inner = objectNode.childForFieldName('object');
    const prop = objectNode.childForFieldName('property');
    if (inner?.type !== 'this' || prop?.type !== 'property_identifier') return undefined;
    // 查表键必须与注册侧同源分桶：宿主判不出（对象字面量方法 / 匿名类 / 带 extends 的类 /
    // 普通 function 重绑 this / 静态块）即弃权，否则跨类同名字段会串台（plan M12b）
    const host = resolveThisHostBucket(objectNode);
    if (host == null) return undefined;
    return bind(env, env.lookupReceiverType(`${host}#${prop.text}`));
  }

  // 形态 3：即用即弃构造 `new Foo().m()`（H7：构造器名走 AST）
  if (objectNode.type === 'new_expression') {
    return bind(env, classNameFromNewExpression(objectNode));
  }

  return undefined;
}

/** 把类名包装成 `ReceiverBinding`；类名缺席即弃权。 */
function bind(env: ReceiverTypeEnv, className: string | null | undefined): ReceiverBinding | undefined {
  if (className == null) return undefined;
  return { receiverType: className, soleImportBinding: env.isSoleImportBinding(className) };
}
