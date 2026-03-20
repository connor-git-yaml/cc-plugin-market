# Data Model: 覆盖率审计与缺失文档报告

## 1. CoverageAudit

- `projectRoot: string`
- `generatedAt: string`
- `summary: CoverageSummary`
- `moduleCoverage: ModuleCoverageEntry[]`
- `generatorCoverage: GeneratorCoverageEntry[]`
- `danglingLinks: DanglingLinkEntry[]`
- `missingLinks: MissingLinkEntry[]`
- `lowConfidenceSpecs: LowConfidenceSpecEntry[]`

## 2. CoverageSummary

- `totalModules: number`
- `documentedModules: number`
- `moduleCoveragePct: number`
- `missingDocCount: number`
- `missingLinkCount: number`
- `danglingLinkCount: number`
- `lowConfidenceCount: number`
- `applicableGenerators: number`
- `generatedGeneratorDocs: number`

## 3. ModuleCoverageEntry

- `moduleName: string`
- `dirPath: string`
- `level: number`
- `sourceFiles: string[]`
- `status: 'documented' | 'missing-doc' | 'attention'`
- `issues: Array<'missing-doc' | 'missing-links' | 'dangling-links' | 'low-confidence'>`
- `specPath?: string`
- `sourceTarget?: string`

## 4. GeneratorCoverageEntry

- `generatorId: string`
- `generatorName: string`
- `scope: 'project' | 'module'`
- `expectedCount: number`
- `generatedCount: number`
- `missingCount: number`
- `coveragePct: number`
- `expectedOutputs: string[]`
- `existingOutputs: string[]`
- `missingOutputs: string[]`

## 5. DanglingLinkEntry

- `specPath: string`
- `href: string`
- `targetPath: string`
- `anchor?: string`

## 6. MissingLinkEntry

- `specPath: string`
- `sourceTarget: string`

## 7. LowConfidenceSpecEntry

- `specPath: string`
- `sourceTarget: string`
- `confidence: 'low'`
