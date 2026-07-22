/**
 * Spec Drift —— symbol 级 canonical AST 指纹（C3 正式实现，plan §7 / FR-003 / FR-009b,c）。
 *
 * 算法：在真实 ts-morph 语法树上行走目标导出声明的**完整 token 流**（`getChildren()`），
 * 产出「结构 kind + 语义 token」序列后取 SHA-256。注释 / JSDoc 是 trivia，天然不在 token
 * 流中；纯标点 token 与括号表达式等书写噪声显式剔除；字面值取「值」而非原始书写。因此
 * SC-001 的「注释 / JSDoc / 格式化免疫」成立，而标识符 / 字面值 / 运算符 / 控制结构 /
 * 声明关键字 / **所有修饰符与类型关键字**变化一律产生不同指纹。
 *
 * ## 为何从 `forEachDescendant` 改为 `getChildren`（C3 审查 CRITICAL 修复）
 *
 * `forEachDescendant` 委托 compiler 的 `forEachChild`，而 **`forEachChild` 不枚举 token
 * 子节点**。所有关键字 / 修饰符 token 因此对指纹隐形，实测同哈希漏报至少包括：
 *   `extends` vs `implements`、`keyof` vs `readonly`、`import(...)` vs `typeof import(...)`。
 * 逐个补洞（`extraSemanticTokens`）补的是一个**开口的洞集**，MUST NOT 继续沿用。
 * `getChildren()` 透传 compiler `getChildren()`，包含全部 token（关键字 + 标点），是封闭解。
 *
 * ## 排除的 token 集与理由
 *
 * - `PUNCTUATION_KINDS`（分号 / 逗号 / 三种括号 / EOF）：纯书写形态，剔除以保持
 *   「可选分号、尾随逗号」免疫。剔除**分号**是安全的：ASI 若改变语义，AST **结构本身**
 *   就已不同（`return\nvalue` 会解析成 `return;` + 独立表达式语句两个节点）。
 * - **例外**：`ForStatement` 的三个子句靠分号定位，全部省略时结构塌陷（实测
 *   `for(;;a++)` 与 `for(;a++;)` token 流完全相同）。故对 ForStatement 额外补
 *   `forClauses:` 位标记，把标点剔除引入的新盲区当场封死。
 * - `SYNTACTIC_NOISE_KINDS`（`ParenthesizedExpression`）：节点自身剔除但**继续遍历子节点**。
 * - JSDoc 子树整体跳过。
 *
 * `NORMALIZATION_PROFILE` bump 为 `ts-morph-canonical-v2`：token 流口径变化导致既有
 * 指纹值整体失效，旧 profile 的锚在 check 侧统一转 fingerprint-unavailable
 * （提示 `drift link --refresh`），MUST NOT 与新算法混合比较（FR-009b）。
 *
 * 依赖方向：叶子模块，MUST NOT import 任何上层 spec-drift 模块（plan §6.2）。
 * ts-morph 是既有 npm 依赖，直接 import（不走 dist 动态加载）。
 */
import { createHash } from 'node:crypto';
import { Project, SyntaxKind, NodeFlags } from 'ts-morph';

/** lock 记录的哈希 schema 版本（粗粒度，FR-009b / plan §7.4） */
export const FINGERPRINT_VERSION = '1';

/** canonical token 产生规则的算法家族版本（C3 审查修复后 bump 至 v2） */
export const NORMALIZATION_PROFILE = 'ts-morph-canonical-v2';

/**
 * 单次运行内共享的 ts-morph Project（只解析目标文件本身，不递归其 import 依赖）。
 */
export function createSharedProject() {
  return new Project({
    skipFileDependencyResolution: true,
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
    compilerOptions: { allowJs: true },
  });
}

/**
 * 冗余防御层：JSDoc 节点判定。
 *
 * 【已实测，非假设】ts-morph@24 的 `forEachDescendant` 委托 compiler node 的 `forEachChild`，
 * JSDoc 属 trivia，**不在**遍历序列中（`root.getJsDocs()` 非空时遍历到的 JSDoc 节点数为 0）。
 * 本函数因此是正常路径下**永不命中**的防御层——测试 MUST 断言「canonical 序列中不含任何
 * JSDoc 前缀 token」，MUST NOT 断言「至少命中一次本分支」（那是死代码，必然失败，W-2）。
 */
export function isJsDocNode(node) {
  return node.getKindName().startsWith('JSDoc');
}

/**
 * 语法噪声节点：仅改变书写形式、不改变语义结构，MUST 从序列中剔除（但继续遍历其子节点）。
 * 实测证据：`a+b` → `(a+b)` 会新增 ParenthesizedExpression 节点，不剔除会误报 stale（W-2）。
 */
export const SYNTACTIC_NOISE_KINDS = new Set([SyntaxKind.ParenthesizedExpression]);

/**
 * 纯标点 token：只表达书写形态，MUST 从序列中剔除（它们是叶子，剔除即整体不计）。
 *
 * 剔除依据见文件头注释。**唯一已知副作用**（`ForStatement` 子句塌陷）由
 * `extraSemanticTokens` 的 `forClauses:` 位标记封死，见该函数。
 */
export const PUNCTUATION_KINDS = new Set([
  SyntaxKind.SemicolonToken,
  SyntaxKind.CommaToken,
  SyntaxKind.OpenParenToken,
  SyntaxKind.CloseParenToken,
  SyntaxKind.OpenBraceToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.OpenBracketToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.EndOfFileToken,
]);

/**
 * 需要记录「文本内容」的节点类型：标识符 / 私有标识符 / 字面值 / 模板片段。
 * 运算符 token 与关键字节点靠 `getKindName()` 即可唯一标识语义，无需记录文本。
 */
export const TEXT_BEARING_KINDS = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.JsxText,
]);

/** 模板字面值片段：cooked 值（`compilerNode.text`）与 raw 书写（`getText()`）不等价 */
const TEMPLATE_PART_KINDS = new Set([
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

/**
 * 判定模板片段是否处于 **tagged** template 之下（W-1）。
 *
 * 语义差异是真实的：普通模板只看得到 cooked 值，`` `A` `` 与 `` `\x41` `` 运行结果完全相同，
 * 记 raw 会造成**误报**；而 tagged template 的 tag 函数能通过 `strings.raw[0]` 读到原始
 * 书写，`` tag`A` `` 与 `` tag`\x41` `` 运行结果**不同**，记 cooked 会造成**漏报**。
 * 故按父上下文分流：tagged → raw，untagged → cooked。
 */
export function isTaggedTemplatePart(node) {
  const kind = node.getKind();
  if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return node.getParent()?.getKind() === SyntaxKind.TaggedTemplateExpression;
  }
  // Head 的父是 TemplateExpression；Middle/Tail 的父是 TemplateSpan（祖父为 TemplateExpression）
  let cursor = node.getParent();
  while (cursor !== undefined && cursor.getKind() !== SyntaxKind.TemplateExpression) {
    cursor = cursor.getParent();
  }
  return cursor?.getParent()?.getKind() === SyntaxKind.TaggedTemplateExpression;
}

/**
 * 正则字面值规范化（W-1）：pattern 原文保留，**flags 规范排序**。
 * `/a/gi` 与 `/a/ig` 语义完全相同，裸 `getText()` 会误报 stale。
 */
export function normalizedRegexText(rawText) {
  const lastSlash = rawText.lastIndexOf('/');
  if (lastSlash <= 0) return rawText; // 非预期形态，原样保留（不猜）
  const pattern = rawText.slice(0, lastSlash + 1);
  const flags = rawText.slice(lastSlash + 1).split('').sort().join('');
  return `${pattern}${flags}`;
}

/**
 * 字面值规范化：取「值」而非原始书写文本。
 * 实测证据：裸 `getText()` 保留原始书写，会让 `"x"`→`'x'`、`1000`→`1_000`、`1000n`→`1_000n`
 * 误报 stale（W-2 / N-2）；正则 flag 顺序与普通模板转义写法同理（W-1）。
 */
export function normalizedLiteralText(node) {
  const kind = node.getKind();
  if (TEMPLATE_PART_KINDS.has(kind)) {
    // tagged 下 raw 可观测（strings.raw），MUST 保留原始书写；否则取 cooked 值
    return isTaggedTemplatePart(node)
      ? `raw:${JSON.stringify(node.getText())}`
      : `cooked:${JSON.stringify(node.compilerNode.text)}`;
  }
  if (kind === SyntaxKind.StringLiteral) {
    return JSON.stringify(node.getLiteralValue()); // 引号风格归一
  }
  if (kind === SyntaxKind.NumericLiteral) {
    return String(node.getLiteralValue()); // 1_000 / 0x3E8 / 1e3 归一为同一数值
  }
  if (kind === SyntaxKind.BigIntLiteral) {
    // N-2：BigIntLiteral 在 TEXT_BEARING_KINDS 内但此前未归一，`1000n` vs `1_000n` 会误报
    return `${node.getLiteralValue()}n`;
  }
  if (kind === SyntaxKind.RegularExpressionLiteral) {
    return normalizedRegexText(node.getText());
  }
  return node.getText();
}

/**
 * NodeFlags → 声明关键字（N-1 CRITICAL）。
 *
 * 【实测 flags（ts-morph@24）】var=0 / let=1 / const=2 / using=4 / await using=65542。
 * 【关键陷阱】`NodeFlags.AwaitUsing === 6 === Using(4) | Const(2)`，位有重叠：
 *   - 朴素的 const→let→var 顺序会让 `using`(4) 落到 `var`（资源释放语义变化被判 fresh），
 *     `await using`(65542) 因含 Const bit 被误标 `const`；
 *   - 故判定顺序 MUST 为 AwaitUsing → Using → Const → Let → var，
 *     且 AwaitUsing MUST 用**全等**比较，否则普通 `const`(2 & 6 = 2，truthy) 会被误判。
 */
export function declarationKeyword(flags) {
  if ((flags & NodeFlags.AwaitUsing) === NodeFlags.AwaitUsing) return 'await using';
  if (flags & NodeFlags.Using) return 'using';
  if (flags & NodeFlags.Const) return 'const';
  if (flags & NodeFlags.Let) return 'let';
  return 'var';
}

/**
 * 记录 `forEachChild` 不枚举的语义信息（C-2 / N-1 核心修复）。
 *
 * 【实测漏报证据】以下六组在朴素实现下 token 序列**完全相同** = 改了代码却判 fresh：
 *   `return +a` / `return -a`、`return ++a` / `return --a`、`return a++` / `return a--`
 *   `export const foo=1` / `export let foo=1`、`var x=a()` / `using x=a()`、
 *   `using x=a()` / `await using x=a()`
 * 根因：一元运算符存于 Prefix/PostfixUnaryExpression 的 `operator` 属性（非子节点）；
 *       const/let/var/using 存于父 VariableDeclarationList 的 NodeFlags，而
 *       `getExportedDeclarations()` 返回的根是 VariableDeclaration（拿不到父标志）。
 */
/**
 * 变量声明所属 `VariableStatement` 的修饰符（C3 审查场景 4）。
 *
 * `export declare let foo: number` 与 `export let foo: number` 的运行时语义天差地别
 * （前者编译产物是 `export {}`，根本不存在该导出），但 `declare` 挂在**父
 * VariableStatement 的 modifiers** 上，`getExportedDeclarations()` 返回的
 * `VariableDeclaration` 子树里看不到它。
 *
 * 【边界】只取 statement 自身的 modifiers，**MUST NOT** 吞入同 statement 里的 sibling
 * declarations——否则 `const a = 1, b = 2` 改 `b` 会误伤 `a` 的指纹（SC-002 违反）。
 */
export function variableStatementModifierTokens(node) {
  const statement = node.getParent()?.getParent();
  if (statement === undefined || statement.getKind() !== SyntaxKind.VariableStatement) return [];
  const modifiers = (statement.getModifiers?.() ?? []).map((m) => m.getKindName()).sort();
  return modifiers.length > 0 ? [`stmtMod:${modifiers.join(',')}`] : [];
}

/**
 * 记录 token 流之外、或被标点剔除规则遮蔽的语义信息。
 *
 * 1. **一元运算符**：`getChildren()` 实测已能枚举 `PlusPlusToken` 等运算符 token，本项
 *    因此已成冗余；**仍然保留**——它是 N-1 六组漏报回归资产的直接锚点，代价为零，
 *    且不依赖「compiler 一定把 operator 作为 child 暴露」这一实现细节。
 * 2. **声明关键字**：`const`/`let`/`var`/`using`/`await using` 在父 `VariableDeclarationList`
 *    的 NodeFlags 上。【实测】`VariableDeclaration` 的 `getChildren()` 流为
 *    `VariableDeclaration|Identifier|EqualsToken|NumericLiteral`，**不含** `ConstKeyword`，
 *    故本项**非冗余，MUST 保留**。
 * 3. **VariableStatement 修饰符**：见 `variableStatementModifierTokens`。
 * 4. **ForStatement 子句位标记**：分号被 `PUNCTUATION_KINDS` 剔除后，`for(;;a++)` 与
 *    `for(;a++;)` 的 token 流实测**完全相同**。本标记把该新盲区当场封死。
 */
export function extraSemanticTokens(node) {
  const out = [];
  const kind = node.getKind();

  if (kind === SyntaxKind.PrefixUnaryExpression || kind === SyntaxKind.PostfixUnaryExpression) {
    out.push(`op:${SyntaxKind[node.compilerNode.operator]}`);
  }
  if (kind === SyntaxKind.VariableDeclaration) {
    const listFlags = node.getParent()?.compilerNode?.flags ?? 0;
    out.push(`declKind:${declarationKeyword(listFlags)}`);
    out.push(...variableStatementModifierTokens(node));
  }
  if (kind === SyntaxKind.ForStatement) {
    const present = [
      node.getInitializer() !== undefined ? '1' : '0',
      node.getCondition() !== undefined ? '1' : '0',
      node.getIncrementor() !== undefined ? '1' : '0',
    ].join('');
    out.push(`forClauses:${present}`);
  }
  return out;
}

/**
 * 对单个已定位的 ts-morph Node 做 canonical token 序列化（CL-3 / FR-009c 落地）。
 *
 * 【迭代而非递归，W-3 CRITICAL】显式栈遍历。递归实现在深嵌套 AST（实测 5000 层
 * property access）上抛 `RangeError: Maximum call stack size exceeded`，且该异常发生在
 * `createSourceFile` 的 try 之外，导致 `computeSymbolFingerprint` **抛异常而非返回
 * `{ok:false}`**，违反其结构化返回合同。
 */
export function canonicalizeNode(rootNode) {
  const tokens = [];
  const stack = [rootNode];

  while (stack.length > 0) {
    const node = stack.pop();
    if (isJsDocNode(node)) continue; // JSDoc 子树整体跳过（trivia，冗余防御层）

    const kind = node.getKind();
    if (PUNCTUATION_KINDS.has(kind)) continue; // 纯标点 token 是叶子，剔除即整体不计

    if (!SYNTACTIC_NOISE_KINDS.has(kind)) {
      // 括号等书写噪声节点自身不记，但**仍继续遍历其子节点**，保留内部语义
      tokens.push(
        TEXT_BEARING_KINDS.has(kind)
          ? `${node.getKindName()}:${normalizedLiteralText(node)}`
          : node.getKindName(),
      );
      tokens.push(...extraSemanticTokens(node));
    }

    const children = node.getChildren();
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]); // 反序入栈 = 前序遍历
    // 普通行内 / 块注释（非 JSDoc）是 trivia，不在 token 流中，天然剥离。
  }

  return tokens.join('|');
}

/**
 * 导出边 metadata（C3 审查场景 5）。
 *
 * `class foo{} export { foo }` 与 `class foo{} export type { foo }` 的**声明子树完全相同**
 * （实测 token 流逐 token 相等），但后者在编译产物中**彻底擦除运行时导出**——这是本轮
 * 最严重的一组同哈希漏报。type-only / alias / default 信息只存在于 export specifier 上，
 * 必须作为「导出边」独立并入指纹。
 */
export function exportEdgeTokens(sourceFile, exportName) {
  const out = [];
  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.getModuleSpecifier() !== undefined) continue; // 跨文件 re-export 另有拒绝路径
    for (const specifier of declaration.getNamedExports()) {
      const exportedAs = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (exportedAs !== exportName) continue;
      const typeOnly = declaration.isTypeOnly() || specifier.isTypeOnly();
      out.push(`exportEdge:named:local=${specifier.getName()}:typeOnly=${typeOnly ? 1 : 0}`);
    }
  }
  if (exportName === 'default') {
    for (const assignment of sourceFile.getExportAssignments()) {
      out.push(`exportEdge:assignment:exportEquals=${assignment.isExportEquals() ? 1 : 0}`);
    }
  }
  return out.sort(); // 书写顺序不应影响指纹
}

/**
 * 重载聚合（C-2 第二处漏报）：`extractExports` 对同名 overload 返回多个 ExportSymbol，
 * 若只取第一个声明，则「改实现体或后续 overload 签名」时第一个声明不变 → 误判 fresh。
 * 合同：一个导出名的**全部**声明按 startLine 升序各自序列化后拼接（含 signatures 与实现体）。
 */
export function canonicalizeDeclarationSet(nodes, edgeTokens = []) {
  const body = nodes
    .slice()
    .sort((a, b) => a.getStartLineNumber() - b.getStartLineNumber())
    .map((n) => canonicalizeNode(n))
    .join('#');
  // 导出边前缀用 `@` 分隔，保持 `#` 纯粹表示「第 N 个声明」（overload 聚合断言依赖此不变量）
  return edgeTokens.length > 0 ? `${edgeTokens.join('|')}@${body}` : body;
}

/** 对已归一化的 canonical token 序列做 SHA-256 */
export function hashCanonicalSequence(sequence) {
  return `sha256:${createHash('sha256').update(sequence, 'utf8').digest('hex')}`;
}

/**
 * 在已解析的 SourceFile 中定位目标导出声明集合（C-3 收口）。
 *
 * 【禁止静默兜底】`?? declarations[0]` 是把「不知道」伪装成确定结论：行号对不上意味着
 * analyzeFiles 与本地 Project 对「目标 Node 身份」的判断已经分叉，此时仍输出 fresh/stale
 * 属于**基于错误 Node 计算指纹**，MUST 改判不可验证态。
 *
 * 匹配三元组：exportName + startLine + sourceFile 同一性。
 *
 * @returns {{ok:true, nodes:import('ts-morph').Node[]} | {ok:false, reason:string}}
 */
export function locateExportedNodes(sourceFile, exportName, expStartLine) {
  let all;
  try {
    all = sourceFile.getExportedDeclarations().get(exportName) ?? [];
  } catch (err) {
    // 【实测】5000 层 property-access 会让 `getExportedDeclarations()` 抛
    // `RangeError: Maximum call stack size exceeded`（compiler 侧递归，非本模块可控）。
    // 它与「非模块文件」是不同的失败语义，MUST 分类上报而不是一律 node-locate-failed。
    if (err instanceof RangeError) return { ok: false, reason: 'ast-traversal-limit' };
    // 非模块文件 / 解析异常：不猜，直接判定位失败
    return { ok: false, reason: 'node-locate-failed' };
  }
  if (all.length === 0) {
    return { ok: false, reason: 'node-locate-failed' }; // 导出名在本地 Project 中不存在
  }

  // 只保留声明在**本文件**内的候选，挡住 re-export 跨文件归属
  const filePath = sourceFile.getFilePath();
  const local = all.filter((d) => d.getSourceFile().getFilePath() === filePath);
  if (local.length === 0) {
    // 声明全部来自其他文件 = re-export，首发显式拒绝（不定义跨文件指纹归属）
    return { ok: false, reason: 'reexport-unsupported' };
  }

  // 重载：同名多声明合法，全部返回交聚合序列化；但必须有一项与 analyzeFiles 的 startLine
  // 对齐，以证明两侧对「同一个符号」的身份判断一致。
  const anchorMatched = local.some((d) => d.getStartLineNumber() === expStartLine);
  if (!anchorMatched) {
    return { ok: false, reason: 'node-locate-ambiguous' }; // 身份分叉，绝不猜
  }
  return { ok: true, nodes: local };
}

/**
 * 端到端：在给定内容快照上解析目标导出并算出 canonical 指纹。
 *
 * MUST 使用调用方已校验一致性的 `sourceText`（而非让 ts-morph 自行读盘），
 * 否则会重新打开 TOCTOU 窗口——skeleton 行号与指纹内容必须同源。
 *
 * @param {{project:import('ts-morph').Project, absFilePath:string, sourceText:string,
 *          exportName:string, expStartLine:number}} input
 * @returns {{ok:true, fingerprint:string, sequence:string} | {ok:false, reason:string, detail?:string}}
 */
export function computeSymbolFingerprint({
  project,
  absFilePath,
  sourceText,
  exportName,
  expStartLine,
}) {
  let sourceFile;
  try {
    sourceFile = project.createSourceFile(absFilePath, sourceText, { overwrite: true });
  } catch (err) {
    return {
      ok: false,
      reason: 'parse-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  // W-3：locate / canonicalize / hash 全段纳入结构化错误边界。此前只有 createSourceFile
  // 被 try 包住，深嵌套 AST 的 RangeError 会**逃出**函数、把「返回 {ok:false}」的合同
  // 变成抛异常；调用方（check / link）据此判定的分类因而彻底失效。
  try {
    const located = locateExportedNodes(sourceFile, exportName, expStartLine);
    if (!located.ok) return located;
    const sequence = canonicalizeDeclarationSet(
      located.nodes,
      exportEdgeTokens(sourceFile, exportName),
    );
    return { ok: true, fingerprint: hashCanonicalSequence(sequence), sequence };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof RangeError ? 'ast-traversal-limit' : 'canonicalize-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 显式 parser-health 判定（plan §9.1 步骤 4b）。
 *
 * 只取**语法诊断**：`getSyntacticDiagnostics` 在 API 层即只返回语法类诊断，
 * 因此不需要（也 MUST NOT）用 `getPreEmitDiagnostics()` + `category === Error` 过滤——
 * 实测语法错误(1109) 与纯类型错误(2322) 在后者中同为 category=Error，
 * 按 category 过滤会把「语法完全可解析、只是类型不完整」的文件误判成 parser-degrade。
 *
 * `refresh=true` 时强制从磁盘重读已缓存的 SourceFile：竞态重试路径下文件内容已变，
 * 复用 project 缓存会拿旧文本做诊断（TOCTOU 修复的一部分）。
 *
 * @returns {{ok:true, hasErrors:boolean} | {ok:false, reason:string}}
 */
export function hasSyntacticErrors(project, absFilePath, { refresh = false } = {}) {
  try {
    let sourceFile = project.getSourceFile(absFilePath);
    if (sourceFile !== undefined && refresh) sourceFile.refreshFromFileSystemSync();
    sourceFile = sourceFile ?? project.addSourceFileAtPath(absFilePath);
    const diagnostics = project
      .getProgram()
      .compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode);
    return { ok: true, hasErrors: diagnostics.length > 0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
