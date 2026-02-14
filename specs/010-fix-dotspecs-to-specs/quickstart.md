# Quickstart: 统一 spec 输出目录引用（.specs → specs）

**Feature**: `010-fix-dotspecs-to-specs`
**Date**: 2026-02-15

## 验证场景

### 场景 1: 源代码零 `.specs` 引用

```bash
# 在 src/ 目录下搜索 .specs 引用，应返回零结果
grep -r '\.specs' src/ --include='*.ts' | grep -v node_modules
# 预期：无输出
echo "EXIT: $?"
# 预期：EXIT: 1（grep 未找到匹配）
```

### 场景 2: SKILL.md 零 `.specs` 引用

```bash
# 搜索所有 SKILL.md 文件
grep -r '\.specs' src/skills-global/ plugins/reverse-spec/skills/ --include='*.md'
# 预期：无输出
```

### 场景 3: 文档零 `.specs` 引用

```bash
# 搜索项目文档（排除 008 和 010 历史 spec）
grep -r '\.specs' CLAUDE.md plugins/reverse-spec/README.md specs/001-*/  specs/002-*/ specs/009-*/
# 预期：无输出
```

### 场景 4: Build + Lint + Test 通过

```bash
npm run build && npm run lint && npm test
# 预期：全部通过，无回归
```

### 场景 5: .gitignore checkpoint 路径一致

```bash
grep 'reverse-spec-checkpoint' .gitignore
# 预期：包含 specs/.reverse-spec-checkpoint.json（非 .specs/）
```
