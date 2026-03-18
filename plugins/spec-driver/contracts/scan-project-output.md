# scan-project.sh 输出契约

**文件**: `plugins/spec-driver/scripts/scan-project.sh`  
**输出模式**: `bash "$PLUGIN_DIR/scripts/scan-project.sh" --json`

本文档定义 `scan-project.sh` 的 JSON 输出字段，供 `spec-driver-doc` 和后续模板 / agent / skill 引用。新增字段应保持向后兼容；删除或重命名字段属于破坏性变更。

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 项目名称；优先来自项目配置文件，缺失时回退目录名 |
| `version` | string \| null | 版本号 |
| `description` | string \| null | 项目描述 |
| `license` | string \| null | 已声明的协议 |
| `author` | object \| null | 作者信息；格式见下方 |
| `scripts` | object | npm / 项目脚本映射；非 Node 项目可为空对象 |
| `dependencies` | object | 运行时依赖映射 |
| `devDependencies` | object | 开发依赖映射 |
| `repository` | string \| object \| null | 仓库地址或仓库对象；当前消费侧应兼容 `null` |
| `main` | string \| null | 主入口 |
| `bin` | string \| object \| null | CLI 入口 |
| `git` | object | git 元信息；格式见下方 |
| `directoryTree` | string | 顶层目录树快照，供 README / 项目结构章节使用 |
| `projectType` | string | `cli` / `library` / `web-app` / `rust` / `go` / `python-lib` / `python-app` / `java` / `node` / `unknown` |
| `ecosystem` | string | `node` / `python` / `rust` / `go` / `java` / `unknown` |
| `existingFiles` | object | 目标文档文件存在性映射 |
| `hasPackageJson` | boolean | 是否检测到 `package.json` |
| `hasGitRepo` | boolean | 是否检测到 git 仓库 |
| `missingFields` | string[] | 未提取到的字段列表，供生成完成报告提示 |

## 子对象

### `author`

```json
{
  "name": "string | null",
  "email": "string | null"
}
```

### `git`

```json
{
  "userName": "string | null",
  "userEmail": "string | null",
  "remoteUrl": "string | null",
  "defaultBranch": "string"
}
```

### `existingFiles`

```json
{
  "README.md": true,
  "LICENSE": false,
  "CONTRIBUTING.md": false,
  "CODE_OF_CONDUCT.md": false
}
```

## 使用规则

1. `spec-driver-doc` 将此输出视为**分发元信息层**，而不是产品语义层。
2. 当项目存在 `specs/products/*/current-spec.md` 时，README 的产品定位、核心价值、主要工作流应优先来自 `current-spec.md`，而不是本契约中的 `description`。
3. 当字段缺失时，消费方必须使用 `[待补充]` 或降级逻辑，而不是假设该字段存在。
4. 若后续需要新增字段，应在此文档追加说明，并保持旧字段兼容。
