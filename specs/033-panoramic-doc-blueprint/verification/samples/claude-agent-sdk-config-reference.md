# 配置参考手册: claude-agent-sdk-python

> 自动生成于 2026-03-19 | 共 42 个配置项

## pyproject.toml (`toml`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `build-system.requires` | array | `["hatchling"]` | [AI] 构建系统所需的工具包，此处使用 hatchling 作为构建后端 |
| `build-system.build-backend` | string | `hatchling.build` | [AI] 指定 hatchling 作为 Python 包的构建后端 |
| `project.name` | string | `claude-agent-sdk` | [AI] Python 包的名称，发布到 PyPI 时使用此名称 |
| `project.version` | string | `0.1.48` | [AI] 当前包的版本号，遵循语义化版本规范 |
| `project.description` | string | `Python SDK for Claude Code` | [AI] 包的简短描述，说明这是用于 Claude Code 的 Python SDK |
| `project.readme` | string | `README.md` | [AI] 指定 README.md 作为包的详细说明文档 |
| `project.requires-python` | string | `>=3.10` | [AI] 限制 Python 最低版本要求为 3.10 |
| `project.license` | object | `{text = "MIT"}` | [AI] 声明项目使用 MIT 开源许可证 |
| `project.authors` | array | `[` | [AI] 列出项目作者信息（姓名和邮箱） |
| `project.classifiers` | array | `[` | [AI] PyPI 分类标签，用于在包仓库中分类和检索此包 |
| `project.keywords` | array | `["claude", "ai", "sdk", "anthropic"]` | [AI] 包的关键词，便于用户在 PyPI 搜索发现此包 |
| `project.dependencies` | array | `[` | [AI] 运行时必须安装的第三方依赖包列表 |
| `project.optional-dependencies.dev` | array | `[` | [AI] 开发环境额外依赖，包含测试和代码质量工具 |
| `project.urls.Homepage` | string | `https://github.com/anthropics/claude-agent-sdk-python` | [AI] 项目 GitHub 主页地址 |
| `project.urls.Documentation` | string | `https://docs.anthropic.com/en/docs/claude-code/sdk` | [AI] 项目官方文档地址，指向 Anthropic 文档站点 |
| `project.urls.Issues` | string | `https://github.com/anthropics/claude-agent-sdk-python/issues` | [AI] GitHub Issues 地址，用于提交 Bug 和功能请求 |
| `tool.hatch.build.targets.wheel.packages` | array | `["src/claude_agent_sdk"]` | [AI] 打包为 wheel 时包含的源码包路径 |
| `tool.hatch.build.targets.wheel.only-include` | array | `["src/claude_agent_sdk"]` | [AI] wheel 构建时仅包含指定目录，排除无关文件 |
| `tool.hatch.build.targets.sdist.include` | array | `[` | [AI] 源码发行包（sdist）中包含的文件或目录列表 |
| `tool.pytest.ini_options.testpaths` | array | `["tests"]` | [AI] pytest 扫描测试文件的根目录 |
| `tool.pytest.ini_options.pythonpath` | array | `["src"]` | [AI] 运行测试时添加到 Python 路径的目录，使 src 下的包可导入 |
| `tool.pytest.ini_options.addopts` | array | `[` | [AI] pytest 默认附加的命令行参数，如覆盖率报告等 |
| `tool.pytest-asyncio.asyncio_mode` | string | `auto` | [AI] 设置异步测试模式为自动，无需手动标记 async 测试函数 |
| `tool.mypy.python_version` | number | `3.10` | [AI] mypy 类型检查的目标 Python 版本 |
| `tool.mypy.strict` | boolean | `true` | [AI] 启用 mypy 严格模式，开启全部类型检查规则 |
| `tool.mypy.warn_return_any` | boolean | `true` | [AI] 当函数返回 Any 类型时发出警告 |
| `tool.mypy.warn_unused_configs` | boolean | `true` | [AI] 当 mypy 配置项未被使用时发出警告 |
| `tool.mypy.disallow_untyped_defs` | boolean | `true` | [AI] 禁止定义缺少类型注解的函数 |
| `tool.mypy.disallow_incomplete_defs` | boolean | `true` | [AI] 禁止参数或返回值类型注解不完整的函数定义 |
| `tool.mypy.check_untyped_defs` | boolean | `true` | [AI] 对没有类型注解的函数体也执行类型检查 |
| `tool.mypy.disallow_untyped_decorators` | boolean | `true` | [AI] 禁止使用无类型注解的装饰器修饰已注解的函数 |
| `tool.mypy.no_implicit_optional` | boolean | `true` | [AI] 禁止将默认值为 None 的参数隐式推断为 Optional 类型 |
| `tool.mypy.warn_redundant_casts` | boolean | `true` | [AI] 当类型转换操作多余时发出警告 |
| `tool.mypy.warn_unused_ignores` | boolean | `true` | [AI] 当 # type: ignore 注释实际无效时发出警告 |
| `tool.mypy.warn_no_return` | boolean | `true` | [AI] 当函数缺少 return 语句时发出警告 |
| `tool.mypy.warn_unreachable` | boolean | `true` | [AI] 检测并警告永远不会执行的不可达代码 |
| `tool.mypy.strict_equality` | boolean | `true` | [AI] 对不同类型间的相等比较进行严格检查 |
| `tool.ruff.target-version` | string | `py310` | [AI] ruff 代码检查的目标 Python 版本，对应 Python 3.10 |
| `tool.ruff.line-length` | number | `88` | [AI] 代码行最大长度限制为 88 个字符 |
| `tool.ruff.lint.select` | array | `[` | [AI] 启用的 ruff lint 规则集列表 |
| `tool.ruff.lint.ignore` | array | `[` | [AI] 忽略的 ruff lint 规则列表，避免与项目风格冲突 |
| `tool.ruff.lint.isort.known-first-party` | array | `["claude_agent_sdk"]` | [AI] 声明为第一方的包名，isort 排序时与第三方包区分处理 |

