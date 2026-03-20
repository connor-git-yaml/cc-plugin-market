# Quickstart: 架构概览与系统上下文视图

## 1. 运行定向测试

```bash
npx vitest run tests/panoramic/architecture-overview-generator.test.ts
```

## 2. 运行相关回归

```bash
npx vitest run \
  tests/panoramic/runtime-topology-generator.test.ts \
  tests/panoramic/workspace-index-generator.test.ts \
  tests/panoramic/cross-package-analyzer.test.ts \
  tests/panoramic/generator-registry.test.ts
```

## 3. 运行静态校验

```bash
npm run lint
npm run build
```

## 4. 手动验证关注点

1. 输出文档包含系统上下文、部署视图、分层视图和模块职责摘要。
2. 部署视图中的服务 / 容器 / 镜像关系与 043 一致。
3. 分层视图中的包级依赖与 041 一致。
4. 在缺失 runtime 或 workspace 输入时，文档仍可生成并附带 warning。
