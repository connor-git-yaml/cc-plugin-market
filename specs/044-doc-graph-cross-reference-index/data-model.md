# Data Model: 文档图谱与交叉引用索引

## DocGraph

```ts
interface DocGraph {
  projectRoot: string;
  generatedAt: string;
  sourceToSpec: DocGraphSourceToSpec[];
  references: DocGraphReference[];
  missingSpecs: DocGraphMissingSpec[];
  unlinkedSpecs: DocGraphUnlinkedSpec[];
}
```

## SourceToSpec

```ts
interface DocGraphSourceToSpec {
  sourceTarget: string;
  specPath: string;
  relatedFiles: string[];
  linked: boolean;
}
```

## Reference

```ts
interface DocGraphReference {
  fromSourceTarget: string;
  toSourceTarget: string;
  fromSpecPath: string;
  toSpecPath: string;
  kind: 'same-module' | 'cross-module';
  targetAnchor: string; // e.g. module-spec
  evidenceCount: number;
  evidenceSamples: string[];
}
```

## Gaps

```ts
interface DocGraphMissingSpec {
  sourceTarget: string;
  relatedFiles: string[];
}

interface DocGraphUnlinkedSpec {
  sourceTarget: string;
  specPath: string;
}
```

## ModuleSpec 扩展

```ts
interface ModuleCrossReferenceLink {
  label: string;
  specPath: string;
  anchor: string;
  evidenceCount: number;
  evidenceSamples?: string[];
}

interface ModuleCrossReferenceIndex {
  sameModule: ModuleCrossReferenceLink[];
  crossModule: ModuleCrossReferenceLink[];
}
```
