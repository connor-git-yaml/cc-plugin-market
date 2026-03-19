# 配置参考手册: claude-agent-sdk-python

> 自动生成于 2026-03-19 | 共 42 个配置项

## pyproject.toml (`toml`)

> [AI] Python 项目元数据与构建配置，定义包名、版本、依赖、构建后端及发布分类信息

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `build-system.requires` | array | `["hatchling"]` | [AI] 构建系统所需的依赖工具，此处使用 hatchling 作为构建后端 |
| `build-system.build-backend` | string | `hatchling.build` | [AI] 指定 Python 包的构建后端为 hatchling.build |
| `project.name` | string | `claude-agent-sdk` | [AI] PyPI 发布包名称，标识该 SDK 项目 |
| `project.version` | string | `0.1.48` | [AI] 当前发布版本号，遵循 SemVer 规范 |
| `project.description` | string | `Python SDK for Claude Code` | [AI] 项目简介，说明这是 Claude Code 的 Python SDK |
| `project.readme` | string | `README.md` | [AI] 指定 README 文档文件路径，用于 PyPI 展示 |
| `project.requires-python` | string | `>=3.10` | [AI] 最低 Python 版本要求，需 3.10 及以上 |
| `project.license` | object | `{text = "MIT"}` | [AI] 项目许可证类型，采用 MIT 开源协议 |
| `project.authors` | array | `[` | [AI] 项目作者信息列表 |
| `project.classifiers` | array | `[` | [AI] PyPI 分类标签，用于包的分类检索和筛选 |
| `project.keywords` | array | `["claude", "ai", "sdk", "anthropic"]` | [AI] PyPI 搜索关键词，便于用户发现该包 |
| `project.dependencies` | array | `[` | [AI] 项目运行时依赖包列表 |
| `project.optional-dependencies.dev` | array | `[` | [AI] 开发环境额外依赖，仅在开发测试时需要安装 |
| `project.urls.Homepage` | string | `https://github.com/anthropics/claude-agent-sdk-python` | [AI] 项目主页 URL，指向 GitHub 仓库 |
| `project.urls.Documentation` | string | `https://docs.anthropic.com/en/docs/claude-code/sdk` | [AI] 项目官方文档地址，指向 Anthropic 文档站 |
| `project.urls.Issues` | string | `https://github.com/anthropics/claude-agent-sdk-python/issues` | [AI] 问题反馈地址，指向 GitHub Issues 页面 |
| `tool.hatch.build.targets.wheel.packages` | array | `["src/claude_agent_sdk"]` | [AI] 构建 wheel 包时包含的源码包路径 |
| `tool.hatch.build.targets.wheel.only-include` | array | `["src/claude_agent_sdk"]` | [AI] 限制 wheel 构建仅包含指定目录，排除无关文件 |
| `tool.hatch.build.targets.sdist.include` | array | `[` | [AI] 构建源码分发包时需包含的文件或目录列表 |
| `tool.pytest.ini_options.testpaths` | array | `["tests"]` | [AI] pytest 测试文件的查找目录 |
| `tool.pytest.ini_options.pythonpath` | array | `["src"]` | [AI] pytest 运行时追加到 Python 模块搜索路径的目录 |
| `tool.pytest.ini_options.addopts` | array | `[` | [AI] pytest 默认附加的命令行选项 |
| `tool.pytest-asyncio.asyncio_mode` | string | `auto` | [AI] 异步测试模式设为 auto，自动识别并运行异步测试函数 |
| `tool.mypy.python_version` | number | `3.10` | [AI] mypy 类型检查的目标 Python 版本 |
| `tool.mypy.strict` | boolean | `true` | [AI] 启用 mypy 严格模式，开启所有严格类型检查规则 |
| `tool.mypy.warn_return_any` | boolean | `true` | [AI] 当函数返回 Any 类型时发出警告 |
| `tool.mypy.warn_unused_configs` | boolean | `true` | [AI] 对未生效的 mypy 配置项发出警告 |
| `tool.mypy.disallow_untyped_defs` | boolean | `true` | [AI] 禁止定义缺少类型注解的函数 |
| `tool.mypy.disallow_incomplete_defs` | boolean | `true` | [AI] 禁止参数类型注解不完整的函数定义 |
| `tool.mypy.check_untyped_defs` | boolean | `true` | [AI] 对无类型注解的函数体也执行类型检查 |
| `tool.mypy.disallow_untyped_decorators` | boolean | `true` | [AI] 禁止使用无类型注解的装饰器 |
| `tool.mypy.no_implicit_optional` | boolean | `true` | [AI] 禁止将默认值为 None 的参数隐式推断为 Optional 类型 |
| `tool.mypy.warn_redundant_casts` | boolean | `true` | [AI] 对冗余的类型转换调用发出警告 |
| `tool.mypy.warn_unused_ignores` | boolean | `true` | [AI] 对无效的 type: ignore 注释发出警告 |
| `tool.mypy.warn_no_return` | boolean | `true` | [AI] 对缺少返回语句的函数发出警告 |
| `tool.mypy.warn_unreachable` | boolean | `true` | [AI] 对永远无法执行到的代码发出警告 |
| `tool.mypy.strict_equality` | boolean | `true` | [AI] 对类型不兼容的相等性比较发出警告 |
| `tool.ruff.target-version` | string | `py310` | [AI] ruff 代码检查的目标 Python 版本兼容级别 |
| `tool.ruff.line-length` | number | `88` | [AI] 代码单行最大字符数限制，设为 88 |
| `tool.ruff.lint.select` | array | `[` | [AI] 启用的 ruff lint 规则集列表 |
| `tool.ruff.lint.ignore` | array | `[` | [AI] 需要忽略的 ruff lint 规则列表 |
| `tool.ruff.lint.isort.known-first-party` | array | `["claude_agent_sdk"]` | [AI] 告知 isort 将该包识别为第一方模块，优化导入排序 |

