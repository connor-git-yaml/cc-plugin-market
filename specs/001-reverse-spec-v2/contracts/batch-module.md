# API Contract: Batch Module

**Module**: `src/batch/`
**Covers**: FR-012, FR-015, FR-016, FR-017

---

## batch-orchestrator

**File**: `src/batch/batch-orchestrator.ts`

### `runBatch(projectRoot: string, options?: BatchOptions): Promise<BatchResult>`

Orchestrates full-project spec generation following topological order.

**Parameters**:
- `projectRoot` — Project root directory
- `options.force` — Regenerate all specs even if they exist (default: `false`)
- `options.onProgress` — Progress callback
- `options.maxRetries` — Max LLM retry attempts per module (default: `3`)
- `options.checkpointPath` — Path for checkpoint state file (default: `specs/.reverse-spec-checkpoint.json`; Constitution IV: must be within `specs/` or `drift-logs/`)

**Returns**:
```typescript
interface BatchResult {
  totalModules: number;
  successful: string[];
  failed: FailedModule[];
  skipped: string[];        // Already existed (no --force)
  degraded: string[];       // Fell back to AST-only
  duration: number;         // Total time in ms
  indexGenerated: boolean;
  summaryLogPath: string;   // Written to specs/ (Constitution IV)
}
```

**Behavior**:
1. Build DependencyGraph → topological sort
2. Check for existing checkpoint (resume if found — FR-017)
3. Process modules in topological order:
   - Skip if spec exists and `!force` (FR-012)
   - Read dependency specs for O(1) context (FR-014)
   - AST analyze → context assemble → LLM generate → render → write
   - On LLM failure: exponential backoff × 3, then degrade to AST-only (FR-016)
   - Save checkpoint after each module
4. Generate `_index.spec.md`
5. Write batch summary log (FR-015)
6. Clean up checkpoint on success

**Constraints**:
- Constitution IV: Only writes to `specs/` and `drift-logs/`
- Progress display: `[N/Total] Processing src/module...` (FR-015)

---

## progress-reporter

**File**: `src/batch/progress-reporter.ts`

### `createReporter(total: number): ProgressReporter`

Creates a terminal progress reporter.

```typescript
interface ProgressReporter {
  start(modulePath: string): void;     // [3/50] Processing src/auth...
  complete(modulePath: string, status: 'success' | 'failed' | 'skipped' | 'degraded'): void;
  finish(): BatchSummary;              // Final summary
}
```

### `writeSummaryLog(summary: BatchSummary, outputPath: string): void`

Writes batch summary log with all module statuses (FR-015).

---

## checkpoint

**File**: `src/batch/checkpoint.ts`

### `loadCheckpoint(checkpointPath: string): BatchState | null`

Loads existing checkpoint for resume. Returns `null` if not found.

### `saveCheckpoint(state: BatchState, checkpointPath: string): void`

Atomic write of checkpoint state after each module completion (FR-017).

### `clearCheckpoint(checkpointPath: string): void`

Removes checkpoint after successful batch completion.

**Guarantees**:
- Checkpoint is valid JSON matching `BatchState` schema
- Atomic write (write to temp file + rename) prevents corruption
- Resume correctly skips completed modules and retries failed ones
