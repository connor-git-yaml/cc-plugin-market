# Contract: Docs Bundle Output

## 1. 输入边界

055 必须建立在现有 batch 输出之上，输入事实边界包括：

- 模块级 spec 文档（`*.spec.md`）
- `_index.spec.md`
- 053 及后续已在 batch 主链路中生成的项目级 panoramic 文档

055 不得：

- 重新运行一套事实抽取流程替代 053/043/045/050
- 为了 bundle 目的重新解析源工程
- 提前实现 056/057/059 的 IR / component / ADR 能力

## 2. 输出边界

docs bundle 编排至少必须写出：

```ts
interface DocsBundleResult {
  manifestPath: string;
  manifest: DocsBundleManifest;
  profileRoots: string[];
  warnings: string[];
}
```

并在 `outputDir` 下落盘：

1. `docs-bundle.yaml`
2. 至少 4 个 profile 对应的独立目录
3. 每个 profile 的 `mkdocs.yml`
4. 每个 profile 的 `docs/index.md`
5. 每个 profile 选中的文档副本与可读导航结构

## 3. 必备 profile

必须固定支持以下 profile：

1. `developer-onboarding`
2. `architecture-review`
3. `api-consumer`
4. `ops-handover`

这些 profile 的选文逻辑必须有明确差异，不能只是同一批文件拷贝到不同目录。

## 4. 导航一致性要求

- bundle 内导航顺序必须由阅读路径定义驱动，而不是文件名排序
- `index.md` 必须作为阅读起点
- profile 中若包含模块级 spec，应以一个明确分组或章节出现在导航中
- `mkdocs.yml` 中的 `nav` 顺序必须与 landing page 展示顺序一致

## 5. 降级行为

- 若某些项目级文档因上游不适用而不存在：bundle 仍应继续生成，并在 manifest/profile warnings 中记录
- 若模块级 spec 很少或只有单模块：profile 仍应生成，模块区可退化为单条或省略
- 若 `outputDir` 为相对路径或非默认目录：manifest 与 profile 输出路径必须保持正确解析

## 6. 一致性要求

- bundle 内复制的文件名与内容必须能回溯到原始 batch 输出
- `BatchResult` 与 CLI 摘要必须能暴露 bundle manifest / profile 信息
- 现有 batch 输出（模块 spec、`_index.spec.md`、053 项目级文档、coverage/delta 报告）不得因 055 回归
