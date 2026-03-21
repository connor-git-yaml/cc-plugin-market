# Contract: Provenance & Quality Outputs

## 1. 输入边界

059 evaluator 允许组合以下输入：

- **必需**:
  - `ArchitectureNarrativeOutput`
  - 当前 batch 的 `generatedDocs` / `projectDocs`
- **可选增强**:
  - `ArchitectureOverviewOutput`
  - `PatternHintsOutput`
  - `ComponentViewOutput`
  - `DynamicScenariosOutput`
  - `AdrIndexOutput`
  - `docs-bundle.yaml` / 等价 manifest
  - `README.md`
  - `current-spec.md`
  - feature `spec.md` / `blueprint.md`

约束：

- 059 不得重新解析源码来决定 canonical conflicts
- 059 不得要求 055 manifest 必须存在；manifest 缺失时必须降级
- 059 失败不得阻断既有 batch 项目级文档输出

## 2. 输出边界

### 2.1 Quality Report

```ts
interface DocsQualityReport {
  projectName: string;
  generatedAt: string;
  status: 'pass' | 'warn' | 'fail' | 'partial';
  summary: string[];
  provenanceRecords: DocumentProvenanceRecord[];
  conflicts: ConflictRecord[];
  requiredDocStatuses: RequiredDocStatus[];
  bundleManifest?: DocsBundleManifestReference;
  warnings: string[];
  stats: DocsQualityStats;
}
```

batch 写盘结果必须支持：

- `quality-report.md`
- `quality-report.json`

### 2.2 Provenance Record

```ts
interface DocumentProvenanceRecord {
  documentId: string;
  title: string;
  kind: 'architecture-narrative' | 'component-view' | 'dynamic-scenarios' | 'adr-index' | 'adr-draft';
  available: boolean;
  coverage: 'full' | 'partial' | 'missing';
  warnings: string[];
  sections: Array<{
    sectionId: string;
    label: string;
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    inferred: boolean;
    evidence: ProvenanceEntry[];
  }>;
}
```

### 2.3 Conflict Record

```ts
interface ConflictRecord {
  id: string;
  topic:
    | 'product-positioning'
    | 'runtime-hosting'
    | 'protocol-boundary'
    | 'extensibility-boundary'
    | 'degradation-strategy';
  severity: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  sources: ProvenanceEntry[];
  resolutionHint?: string;
}
```

## 3. 质量报告必须覆盖的版块

`quality-report.md` 至少覆盖：

1. 总体状态 / 摘要
2. Provenance 覆盖情况
3. Conflict records
4. Required-doc coverage
5. Bundle / dependency warnings

## 4. 降级行为

- 若 `docs-bundle.yaml` 缺失：`bundleManifest` 为空，并在 `warnings` 中记录 dependency warning；整体状态最多降级为 `partial`，不得抛 fatal error
- 若 README 或 `current-spec.md` 缺失：冲突检测仅记录“证据不足”，不生成伪冲突
- 若某类 explanation 文档缺失：对应 provenance record 标记 `available=false` / `coverage=missing`
- 若 narrative 无法细化到段落级 provenance：允许保留 section-level provenance，coverage 标记为 `partial`

## 5. 一致性要求

- 所有 provenance / conflict / required-doc 结论都必须可回溯到结构化来源或明确的文档摘录
- canonical quality 结论必须 deterministic
- 059 输出必须能被 060 直接复用，不能把模板字段硬编码进共享模型
