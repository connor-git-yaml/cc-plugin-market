# API Contract: Graph Module

**Module**: `src/graph/`
**Covers**: FR-010, FR-011, FR-013, FR-014

---

## dependency-graph

**File**: `src/graph/dependency-graph.ts`

### `buildGraph(projectRoot: string, options?: GraphOptions): Promise<DependencyGraph>`

Uses dependency-cruiser to build a project-wide dependency graph.

**Parameters**:
- `projectRoot` — Project root directory path
- `options.includeOnly` — Glob pattern to filter analyzed files (default: `'^src/'`)
- `options.excludePatterns` — Patterns to exclude (default: test files, build outputs)
- `options.tsConfigPath` — Path to tsconfig.json (default: auto-detect)

**Returns**: `DependencyGraph` (see [data-model.md](../data-model.md#2-dependencygraph))

**Errors**:
- `ProjectNotFoundError` — projectRoot does not exist
- `NoDependencyCruiserError` — dependency-cruiser not installed
- `TsConfigNotFoundError` — tsconfig.json not found

**Performance**: 200+ modules in 2-5 seconds

---

## topological-sort

**File**: `src/graph/topological-sort.ts`

### `topologicalSort(graph: DependencyGraph): TopologicalResult`

Computes processing order using Kahn's algorithm or DFS.

**Returns**:
```typescript
interface TopologicalResult {
  order: string[];         // File paths in dependency order (leaves first)
  levels: Map<string, number>;  // Module → topological level
  hasCycles: boolean;
  cycleGroups: string[][];  // SCCs with size > 1
}
```

**Guarantees**:
- If `hasCycles === false`, `order` is a valid topological sort
- If `hasCycles === true`, cycles are collapsed into SCCs and treated as units (FR-011)

---

### `detectSCCs(graph: DependencyGraph): SCC[]`

Tarjan's algorithm for strongly connected component detection.

**Returns**: `SCC[]` — All SCCs. Single-module SCCs have `modules.length === 1`.

---

## mermaid-renderer

**File**: `src/graph/mermaid-renderer.ts`

### `renderDependencyGraph(graph: DependencyGraph, options?: RenderOptions): string`

Generates Mermaid source code for the dependency diagram.

**Parameters**:
- `graph` — DependencyGraph to render
- `options.collapseDirectories` — Group by directory (default: `true` for >20 modules)
- `options.highlightCycles` — Red highlight for circular dependencies (default: `true`)
- `options.maxNodes` — Limit visible nodes (default: `50`, uses clustering)

**Returns**: Valid Mermaid `graph TD` source code string

**Constraints**:
- Output must be renderable by any Mermaid-compatible viewer (FR-007)
- Circular dependencies highlighted with distinct styling
