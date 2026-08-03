# Contract Delta：`graph-quality-report.schema.json`

本需求对既有契约文件 `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` 的变更点（additive，不破坏现有 `required`/不修改任何既有字段类型）。

## 变更点

`$defs.GraphFreshnessVerdict.properties` 新增：

```json
"staleReasons": {
  "type": "array",
  "items": {
    "type": "string",
    "enum": [
      "source-commit",
      "collector-fingerprint",
      "collector-fingerprint-unrecorded",
      "collector-fingerprint-invalid"
    ]
  },
  "description": "state==='stale' 时的判别原因数组，顺序确定性，多原因并存时全部保留（FR-009）"
}
```

`$defs.GraphFreshnessVerdict.required` **不变**（`staleReasons` 是可选字段——`state !== 'stale'` 时不出现）。

`additionalProperties: false` 沿用不变——正是因为这条硬校验，`staleReasons` 必须显式登记进 `properties`，否则任何携带该字段的 `--json` 输出会被本 schema 判定为非法（这正是 codebase-context.md C-005 指出的风险点）。

## 契约测试

新建 `tests/unit/contracts/graph-quality-report-schema.test.ts`（无 `ajv` 依赖，手写结构校验函数，符合零新增依赖约束）：

1. 读取 schema.json，解析 `$defs.GraphFreshnessVerdict.properties` 的 key 集合。
2. 构造 SC-009 五类样本对象（source-commit mismatch / collector-fingerprint mismatch / collector-fingerprint-unrecorded / collector-fingerprint-invalid / 多原因并存）。
3. 对每个样本对象的 key 集合断言 ⊆ schema 声明的 `properties` key 集合（模拟 `additionalProperties: false` 的拒绝行为，不新增 ajv 依赖）。
4. 对 `staleReasons` 数组元素逐一断言 ∈ schema 声明的 `enum` 集合。

该测试不是完整通用 JSON Schema validator（不追求覆盖 `graph-quality-report.schema.json` 的全部字段与嵌套结构，只针对本需求新增的 `staleReasons` 契约面做定向校验），避免过度工程化（YAGNI）。
