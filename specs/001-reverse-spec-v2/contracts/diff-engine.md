# API Contract: Diff Engine

**Module**: `src/diff/`
**Covers**: FR-018, FR-019, FR-020, FR-021, FR-022

---

## structural-diff

**File**: `src/diff/structural-diff.ts`

### `compareSkeletons(oldSkeleton: CodeSkeleton, newSkeleton: CodeSkeleton): DriftItem[]`

Compares two CodeSkeletons and identifies structural differences in exported symbols.

**Parameters**:
- `oldSkeleton` — Skeleton from spec generation time (or reconstructed from spec)
- `newSkeleton` — Skeleton from current source code

**Returns**: `DriftItem[]` with `detectedBy: 'structural'`

**Detection Rules**:
| Change | Severity | Category |
|--------|----------|----------|
| Export removed | HIGH | Interface |
| Signature modified | MEDIUM | Interface |
| New export added | LOW | Interface |
| Type parameter changed | MEDIUM | Interface |
| Return type changed | MEDIUM | Interface |
| Parameter added (optional) | LOW | Interface |
| Parameter added (required) | MEDIUM | Interface |

**Guarantees**:
- 95%+ of signature-level changes detected (SC-006)
- Zero false positives on identical skeletons
- `oldValue` and `newValue` populated with exact signatures

---

## semantic-diff

**File**: `src/diff/semantic-diff.ts`

### `evaluateBehaviorChange(oldCode: string, newCode: string, specDescription: string): Promise<DriftItem | null>`

Delegates to LLM to assess whether a function body change violates the spec's stated intent.

**Parameters**:
- `oldCode` — Previous function body (or summary)
- `newCode` — Current function body
- `specDescription` — Relevant spec section describing expected behavior

**Returns**: `DriftItem` with `detectedBy: 'semantic'` if drift detected, `null` if no drift

**Constraints**:
- Only called when structural-diff detects body changes with unchanged signatures (FR-020)
- LLM response validated against DriftItem schema via Zod
- Category is always `'Behavior'` for semantic diffs

---

## noise-filter

**File**: `src/diff/noise-filter.ts`

### `filterNoise(items: DriftItem[], oldContent: string, newContent: string): FilterResult`

Removes non-substantive changes from drift results.

**Returns**:
```typescript
interface FilterResult {
  substantive: DriftItem[];   // Meaningful changes to report
  filtered: number;           // Count of noise items removed
  filterReasons: Map<string, string>;  // itemId → reason for filtering
}
```

**Noise Categories** (always filtered — FR-021):
- Whitespace-only changes
- Comment additions/modifications/removals
- Import reordering (same imports, different order)
- Trailing comma additions/removals
- Semicolon insertion/removal (ASI equivalence)

**Guarantees**:
- Zero false positives: no substantive change is incorrectly filtered (SC-007)
- Filtered count reported in DriftReport for transparency

---

## drift-orchestrator

**File**: `src/diff/drift-orchestrator.ts`

### `detectDrift(specPath: string, sourcePath: string, options?: DriftOptions): Promise<DriftReport>`

End-to-end orchestration for spec drift detection. This is the entry point invoked by `/reverse-spec-diff`.

**Parameters**:

- `specPath` — Path to the existing spec file (e.g., `specs/auth.spec.md`)
- `sourcePath` — Path to the current source directory (e.g., `src/auth/`)
- `options.skipSemantic` — Skip LLM semantic evaluation, structural diff only (default: `false`)

**Returns**: `DriftReport` (see [data-model.md](../data-model.md#6-driftreport))

**Pipeline Steps**:

1. Load baseline `CodeSkeleton` from spec file (`loadBaselineSkeleton`)
2. AST analyze current source → new `CodeSkeleton` (`ast-analyzer`)
3. Structural diff: compare old vs new skeletons (`compareSkeletons`)
4. Noise filter: remove whitespace/comment/import changes (`filterNoise`)
5. Semantic diff: for body-only changes, delegate to LLM (`evaluateBehaviorChange`)
6. Assemble `DriftReport` with severity categorization
7. Render drift report via Handlebars (`templates/drift-report.hbs`)
8. Write to `drift-logs/{module}-drift-{date}.md`

**Constraints**:

- Constitution IV: Writes only to `drift-logs/`; spec files are NOT modified
- FR-022: Spec update requires explicit user confirmation (handled by skill script, not this function)

---

### `loadBaselineSkeleton(specPath: string): CodeSkeleton`

Extracts the serialized baseline `CodeSkeleton` from an existing spec file.

**Behavior**:

- Reads the HTML comment block `<!-- baseline-skeleton: ... -->` from the spec
- Deserializes JSON → validates against CodeSkeleton Zod schema
- If no baseline found (legacy spec without embedded skeleton), falls back to reconstructing a partial skeleton from the spec's interface definition section (best-effort, marks as `[不明确]`)

**Returns**: `CodeSkeleton` with `parserUsed` indicating source (`'baseline'` or `'reconstructed'`)
