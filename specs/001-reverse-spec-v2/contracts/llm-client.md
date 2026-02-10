# API Contract: LLM Client

**Module**: `src/core/`
**File**: `src/core/llm-client.ts`
**Covers**: FR-002 (Generation stage), FR-008 (uncertainty markers), FR-016 (retry/degradation), FR-020 (semantic diff)

---

## Configuration

### `LLMConfig`

```typescript
interface LLMConfig {
  model: string;              // Default: 'claude-opus-4-6'
  apiKey?: string;            // Default: from ANTHROPIC_API_KEY env var
  maxTokensResponse: number;  // Default: 8192
  temperature: number;        // Default: 0.3 (low for factual extraction)
  timeout: number;            // Default: 120_000 (ms)
}
```

**Model Selection**:

- Default model: `claude-opus-4-6` (Opus) for all operations
- User-configurable via `LLMConfig.model` parameter or `REVERSE_SPEC_MODEL` environment variable
- Priority: function parameter > environment variable > default
- Any valid Anthropic model ID is accepted (e.g., `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`)

---

## callLLM

### `callLLM(context: AssembledContext, config?: Partial<LLMConfig>): Promise<LLMResponse>`

Sends the assembled context to the Claude API and returns the raw response.

**Parameters**:

- `context` — Output from `assembleContext()` (prompt string + token metadata)
- `config` — Optional overrides for model, timeout, temperature

**Returns**:

```typescript
interface LLMResponse {
  content: string;            // Raw text response from LLM
  model: string;              // Actual model used
  inputTokens: number;        // Tokens sent
  outputTokens: number;       // Tokens received
  duration: number;           // Request time in ms
}
```

**Retry Logic** (FR-016):

- On transient failure (rate limit, timeout, 5xx): exponential backoff with base delay 2s, factor 2x, max delay 30s
- Max 3 attempts total
- On persistent failure after 3 attempts: throw `LLMUnavailableError`
- Caller (orchestrator) decides degradation strategy (AST-only output)

**Error Types**:

- `LLMUnavailableError` — API unreachable after retries
- `LLMRateLimitError` — Rate limit hit (triggers backoff)
- `LLMResponseError` — Non-2xx status from API
- `LLMTimeoutError` — Request exceeded timeout

---

## parseLLMResponse

### `parseLLMResponse(raw: string): ParsedSpecSections`

Parses the raw LLM response into structured spec sections.

**Returns**:

```typescript
interface ParsedSpecSections {
  sections: SpecSections;                // 9-section content (Chinese prose)
  uncertaintyMarkers: UncertaintyMarker[];  // Extracted [推断]/[不明确] markers
  parseWarnings: string[];               // Non-fatal parsing issues
}

interface UncertaintyMarker {
  type: '推断' | '不明确' | 'SYNTAX ERROR';
  section: string;            // Which of the 9 sections
  rationale: string;          // Why this was marked uncertain
}
```

**Behavior**:

1. Extract 9 named sections from LLM response (match by Chinese heading patterns: `## 1. 意图`, `## 2. 接口定义`, etc.)
2. Validate all 9 sections present — if missing, fill with `[LLM 未生成此段落]` placeholder
3. Extract and catalog all `[推断]`/`[不明确]`/`[SYNTAX ERROR]` markers with rationale (FR-008)
4. **Critical**: Verify `接口定义` section does NOT contain signatures absent from the AST skeleton — if detected, strip fabricated entries and add warning (Constitution I enforcement)
5. Validate via Zod `SpecSections` schema

**Guarantees**:

- Always returns valid `SpecSections` (never throws for malformed LLM output — degrades gracefully)
- Constitution I: Interface section is post-validated against AST skeleton; any LLM-fabricated signatures are removed
- Constitution III: All uncertainty markers preserved with rationale

---

## buildSystemPrompt

### `buildSystemPrompt(mode: 'spec-generation' | 'semantic-diff'): string`

Returns the system prompt template for the given operation mode.

**Modes**:

- `spec-generation` — Instructs LLM to fill 9 Chinese sections from skeleton + context, mark uncertain content with `[推断]`, never fabricate interfaces
- `semantic-diff` — Instructs LLM to compare old/new function bodies against spec intent, return structured drift assessment

**Guarantees**:

- System prompt explicitly instructs LLM to never invent or modify interface signatures
- System prompt requires `[推断]` markers on all inferred content
- System prompt specifies Chinese prose output with English code identifiers
