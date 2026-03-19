# 配置参考手册: claude-agent-sdk-python

> 自动生成于 2026-03-19 | 共 42 个配置项

## pyproject.toml (`toml`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `build-system.requires` | array | `["hatchling"]` | — |
| `build-system.build-backend` | string | `hatchling.build` | — |
| `project.name` | string | `claude-agent-sdk` | — |
| `project.version` | string | `0.1.48` | — |
| `project.description` | string | `Python SDK for Claude Code` | — |
| `project.readme` | string | `README.md` | — |
| `project.requires-python` | string | `>=3.10` | — |
| `project.license` | object | `{text = "MIT"}` | — |
| `project.authors` | array | `[` | — |
| `project.classifiers` | array | `[` | — |
| `project.keywords` | array | `["claude", "ai", "sdk", "anthropic"]` | — |
| `project.dependencies` | array | `[` | — |
| `project.optional-dependencies.dev` | array | `[` | — |
| `project.urls.Homepage` | string | `https://github.com/anthropics/claude-agent-sdk-python` | — |
| `project.urls.Documentation` | string | `https://docs.anthropic.com/en/docs/claude-code/sdk` | — |
| `project.urls.Issues` | string | `https://github.com/anthropics/claude-agent-sdk-python/issues` | — |
| `tool.hatch.build.targets.wheel.packages` | array | `["src/claude_agent_sdk"]` | — |
| `tool.hatch.build.targets.wheel.only-include` | array | `["src/claude_agent_sdk"]` | — |
| `tool.hatch.build.targets.sdist.include` | array | `[` | — |
| `tool.pytest.ini_options.testpaths` | array | `["tests"]` | — |
| `tool.pytest.ini_options.pythonpath` | array | `["src"]` | — |
| `tool.pytest.ini_options.addopts` | array | `[` | — |
| `tool.pytest-asyncio.asyncio_mode` | string | `auto` | — |
| `tool.mypy.python_version` | number | `3.10` | — |
| `tool.mypy.strict` | boolean | `true` | — |
| `tool.mypy.warn_return_any` | boolean | `true` | — |
| `tool.mypy.warn_unused_configs` | boolean | `true` | — |
| `tool.mypy.disallow_untyped_defs` | boolean | `true` | — |
| `tool.mypy.disallow_incomplete_defs` | boolean | `true` | — |
| `tool.mypy.check_untyped_defs` | boolean | `true` | — |
| `tool.mypy.disallow_untyped_decorators` | boolean | `true` | — |
| `tool.mypy.no_implicit_optional` | boolean | `true` | — |
| `tool.mypy.warn_redundant_casts` | boolean | `true` | — |
| `tool.mypy.warn_unused_ignores` | boolean | `true` | — |
| `tool.mypy.warn_no_return` | boolean | `true` | — |
| `tool.mypy.warn_unreachable` | boolean | `true` | — |
| `tool.mypy.strict_equality` | boolean | `true` | — |
| `tool.ruff.target-version` | string | `py310` | — |
| `tool.ruff.line-length` | number | `88` | — |
| `tool.ruff.lint.select` | array | `[` | — |
| `tool.ruff.lint.ignore` | array | `[` | — |
| `tool.ruff.lint.isort.known-first-party` | array | `["claude_agent_sdk"]` | — |

