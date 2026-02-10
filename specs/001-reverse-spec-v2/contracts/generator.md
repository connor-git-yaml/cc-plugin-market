# API Contract: Generator Module

**Module**: `src/generator/`
**Covers**: FR-006, FR-007, FR-008, FR-009

---

## spec-renderer

**File**: `src/generator/spec-renderer.ts`

### `renderSpec(moduleSpec: ModuleSpec): string`

Renders a ModuleSpec into final Markdown using Handlebars templates.

**Parameters**:
- `moduleSpec` — Complete ModuleSpec data (see [data-model.md](../data-model.md#3-modulespec))

**Returns**: Complete Markdown string with YAML frontmatter + 9 sections + Mermaid diagrams

**Template**: `templates/module-spec.hbs`

**Guarantees**:

- All 9 sections present in order (FR-006)
- YAML frontmatter contains all required fields including `skeletonHash` (FR-009)
- Mermaid diagrams embedded as fenced code blocks (FR-007)
- Uncertainty markers preserved: `[推断]`, `[不明确]`, `[SYNTAX ERROR]` (FR-008)
- Prose in Chinese, code identifiers in English (Constitution VI)
- **Baseline skeleton serialized** as HTML comment block at end of spec: `<!-- baseline-skeleton: {JSON} -->`. This enables lossless drift detection without reverse-parsing Markdown. The JSON is the full `CodeSkeleton` serialized via `JSON.stringify()`. Invisible to Markdown renderers.

---

### `initRenderer(): void`

One-time initialization: compile templates, register helpers, register partials.

Must be called before first `renderSpec()`.

---

## frontmatter

**File**: `src/generator/frontmatter.ts`

### `generateFrontmatter(data: FrontmatterInput): SpecFrontmatter`

Produces YAML frontmatter data with automatic version increment.

**Parameters**:
```typescript
interface FrontmatterInput {
  sourceTarget: string;
  relatedFiles: string[];
  confidence: 'high' | 'medium' | 'low';
  existingVersion?: string;  // e.g., 'v3' — will produce 'v4'
}
```

**Returns**: `SpecFrontmatter` with:
- `version`: `v1` for new specs, or incremented from `existingVersion`
- `generatedBy`: `'reverse-spec v2.0'`
- `lastUpdated`: Current ISO 8601 timestamp
- `type`: `'module-spec'`

---

## mermaid-class-diagram

**File**: `src/generator/mermaid-class-diagram.ts`

### `generateClassDiagram(skeleton: CodeSkeleton): string`

Generates Mermaid classDiagram source from a CodeSkeleton.

**Returns**: Valid Mermaid `classDiagram` source code

**Rules**:
- Classes show public methods and properties only
- Inheritance (`--|>`) and composition (`*--`) relationships from AST
- Interfaces rendered with `<<interface>>` stereotype

---

## index-generator

**File**: `src/generator/index-generator.ts`

### `generateIndex(specs: ModuleSpec[], graph: DependencyGraph): ArchitectureIndex`

Produces the project-level architecture index.

**Parameters**:
- `specs` — All generated ModuleSpec objects
- `graph` — Project DependencyGraph

**Returns**: `ArchitectureIndex` (see [data-model.md](../data-model.md#4-architectureindex))

**Template**: `templates/index-spec.hbs`

**Guarantees**:
- Module map contains all specs with links (FR-013)
- Dependency diagram is the full project Mermaid graph
- Cross-cutting concerns identified from shared dependencies
