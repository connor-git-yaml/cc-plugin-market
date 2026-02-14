# 快速验证：CLI 全局分发与 Skill 自动注册

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## 前置条件

- Node.js 20.x+
- npm 9+
- reverse-spec 项目已编译（`npm run build`）

## 验证步骤

### 1. CLI 入口可执行（FR-001, FR-005, FR-006）

```bash
# 编译项目
npm run build

# 验证 bin 入口文件存在且有正确 shebang
head -1 dist/cli/index.js
# 预期: #!/usr/bin/env node

# 本地测试 CLI
node dist/cli/index.js --version
# 预期: reverse-spec v2.0.0

node dist/cli/index.js --help
# 预期: 显示帮助信息（三个子命令）
```

### 2. CLI 子命令正常工作（FR-002, FR-003, FR-004）

```bash
# 在 reverse-spec 项目目录测试 generate
node dist/cli/index.js generate src/core/ast-analyzer.ts
# 预期: specs/ast-analyzer.spec.md 生成

# 测试 diff（需要已有 spec 文件）
node dist/cli/index.js diff specs/ast-analyzer.spec.md src/core/ast-analyzer.ts
# 预期: drift-logs/ 下生成漂移报告

# 测试错误处理
node dist/cli/index.js generate nonexistent/
# 预期: 友好的错误提示，退出码 1
```

### 3. Skill 注册脚本（FR-007, FR-008）

```bash
# 模拟全局安装环境
npm_config_global=true node dist/scripts/postinstall.js
# 预期: ~/.claude/skills/ 下出现三个 SKILL.md

# 验证文件存在
ls ~/.claude/skills/reverse-spec/SKILL.md
ls ~/.claude/skills/reverse-spec-batch/SKILL.md
ls ~/.claude/skills/reverse-spec-diff/SKILL.md

# 验证全局 SKILL.md 使用 CLI 命令而非 npx tsx
grep 'reverse-spec generate' ~/.claude/skills/reverse-spec/SKILL.md
# 预期: 包含 `reverse-spec generate` 命令调用

# 模拟全局卸载
npm_config_global=true node dist/scripts/preuninstall.js
# 预期: 三个 skill 目录被删除

ls ~/.claude/skills/reverse-spec/ 2>&1
# 预期: No such file or directory
```

### 4. 全局安装端到端（SC-001, SC-002）

```bash
# 全局安装
npm install -g .
# 预期: postinstall 输出 skill 注册信息

# 验证 CLI 可用
reverse-spec --version
# 预期: reverse-spec v2.0.0

# 在其他项目目录测试
cd /tmp && mkdir test-project && cd test-project
npm init -y && echo '{}' > tsconfig.json
echo 'export function hello(): string { return "hello"; }' > index.ts
reverse-spec generate index.ts
# 预期: .specs/index.spec.md 生成

# 清理
cd - && rm -rf /tmp/test-project

# 卸载
npm uninstall -g reverse-spec
# 预期: preuninstall 输出 skill 清理信息
```

### 5. 现有测试不受影响（SC-005）

```bash
# 确认所有 148 个测试仍然通过
npm test
# 预期: 148+ tests passed（新增测试可能增加数量）

# 类型检查
npm run lint
# 预期: 无错误
```

### 6. 本地开发向后兼容（FR-012）

```bash
# 验证本地 SKILL.md 未被修改
grep 'npx tsx' skills/reverse-spec/SKILL.md
# 预期: 仍然包含 npx tsx 调用

# 验证 npx tsx 直接调用仍然工作
npx tsx -e "import { analyzeFile } from './src/core/ast-analyzer.js'; console.log('OK')"
# 预期: OK
```
