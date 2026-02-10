# API Contract: Core Pipeline

**Module**: `src/core/`
**Covers**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-027

---

## ast-analyzer

**File**: `src/core/ast-analyzer.ts`

### `analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<CodeSkeleton>`

Parses a single TypeScript/JavaScript file and returns a CodeSkeleton.

**Parameters**:
- `filePath` — Absolute or relative path to the source file
- `options.includePrivate` — Include non-exported symbols (default: `false`)
- `options.maxDepth` — Max class hierarchy depth to resolve (default: `5`)

**Returns**: `CodeSkeleton` (see [data-model.md](../data-model.md#1-codeskeleton))

**Errors**:
- `FileNotFoundError` — File does not exist
- `ParseError` — ts-morph fails; triggers tree-sitter fallback automatically
- `UnsupportedFileError` — Non-TS/JS file extension

**Constraints**:
- Constitution I: All `ExportSymbol.signature` values MUST come from AST, never LLM
- Constitution V: Uses ts-morph (npm package) only

---

### `analyzeFiles(filePaths: string[], options?: BatchAnalyzeOptions): Promise<CodeSkeleton[]>`

Batch analysis of multiple files using a single Project instance.

**Parameters**:
- `filePaths` — Array of file paths
- `options.concurrency` — Max concurrent file processing (default: `50`)
- `options.onProgress` — Progress callback `(completed: number, total: number) => void`

**Returns**: `CodeSkeleton[]` in same order as input

**Performance**: 500 files ≤ 10 seconds (SC-003)

---

## tree-sitter-fallback

**File**: `src/core/tree-sitter-fallback.ts`

### `analyzeFallback(filePath: string): Promise<CodeSkeleton>`

Error-tolerant parsing for files that fail ts-morph. Produces partial skeletons with `parseErrors` populated.

**Returns**: `CodeSkeleton` with `parserUsed: 'tree-sitter'` and affected symbols marked `[SYNTAX ERROR]`

---

## context-assembler

**File**: `src/core/context-assembler.ts`

### `assembleContext(skeleton: CodeSkeleton, options: AssemblyOptions): Promise<AssembledContext>`

Composes the LLM prompt from skeleton + dependencies + code snippets within token budget.

**Parameters**:
- `skeleton` — Primary CodeSkeleton for the target module
- `options.dependencySpecs` — Array of already-generated spec summaries for dependencies
- `options.codeSnippets` — Selected complex function bodies for deep analysis
- `options.maxTokens` — Token budget (default: `100_000`)
- `options.templateInstructions` — System prompt template for the LLM

**Returns**:
```typescript
interface AssembledContext {
  prompt: string;
  tokenCount: number;
  breakdown: {
    skeleton: number;    // tokens
    dependencies: number;
    snippets: number;
    instructions: number;
  };
  truncated: boolean;
  truncatedParts: string[];  // which parts were trimmed
}
```

**Constraints**:
- `tokenCount` MUST NOT exceed `maxTokens`
- Truncation priority: snippets → dependencies → skeleton (FR-003)
- Constitution II: Must follow three-stage pipeline

---

## secret-redactor

**File**: `src/core/secret-redactor.ts`

### `redact(content: string, filePath?: string): RedactionResult`

Scans content for secrets and replaces them with semantic placeholders.

**Parameters**:
- `content` — Source code string to scan
- `filePath` — Optional file path for context-aware filtering (test files get relaxed rules)

**Returns**: `RedactionResult` (see [data-model.md](../data-model.md#8-redactionresult))

**Guarantees**:
- High-confidence secrets (AWS keys, private keys) are always redacted
- Placeholders preserve code structure: `[REDACTED_AWS_ACCESS_KEY_ID]`
- No false positives on known placeholder values (`your-key-here`, etc.)
- FR-027 compliance

---

## token-counter

**File**: `src/core/token-counter.ts`

### `estimateFast(text: string): number`

Character-based approximation. ~0.01ms, ±15% accuracy. CJK-aware.

### `countAccurate(text: string): Promise<number>`

Accurate token count with caching. ~1-5ms first call, cached subsequent.

### `fitsInBudget(text: string, budget: number): boolean`

Quick check using fast estimation with 15% safety margin.

---

## single-spec-orchestrator

**File**: `src/core/single-spec-orchestrator.ts`

### `generateSpec(targetPath: string, options?: GenerateSpecOptions): Promise<GenerateSpecResult>`

End-to-end orchestration for single-module spec generation. This is the entry point invoked by `/reverse-spec`.

**Parameters**:

- `targetPath` — Directory or file path to analyze
- `options.deep` — Include function bodies in context assembly (default: `false`)
- `options.outputDir` — Output directory (default: `specs/`)
- `options.existingVersion` — Previous spec version for increment (auto-detected if spec exists)

**Returns**:

```typescript
interface GenerateSpecResult {
  specPath: string;           // Path to written spec file
  skeleton: CodeSkeleton;     // Extracted skeleton (for potential reuse)
  tokenUsage: number;         // LLM tokens consumed
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];         // Non-fatal issues encountered
}
```

**Pipeline Steps**:

1. Scan target path for TS/JS files (`file-scanner`)
2. AST analyze all files → `CodeSkeleton[]` (`ast-analyzer`, with `tree-sitter-fallback`)
3. Redact secrets (`secret-redactor`)
4. Assemble LLM context with token budget (`context-assembler`)
5. Call Claude API (`llm-client`) → raw sections
6. Parse + validate LLM response → `ModuleSpec`
7. Inject uncertainty markers (`[推断]`/`[不明确]`/`[SYNTAX ERROR]`)
8. Render via Handlebars (`spec-renderer`) → write to `specs/*.spec.md`
9. Serialize baseline skeleton into spec (for drift detection — see U3)

**Constraints**:

- Constitution I: All interface data from AST, never LLM
- Constitution IV: Writes only to `specs/`
- Constitution II: Must follow three-stage pipeline
