/**
 * Batch README 生成器
 * 为 batch 输出目录生成人类友好的 README.md 索引导航
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ReadmeGeneratorInput {
  /** 项目名称 */
  projectName: string;
  /** reverse-spec 版本号 */
  version: string;
  /** 成功生成的模块列表 */
  moduleSpecs: string[];
  /** 项目级文档路径列表 */
  projectDocs: string[];
  /** Bundle profiles */
  bundles?: Array<{ id: string; title: string; rootDir: string; documentCount: number }>;
  /** 输出目录绝对路径 */
  outputDir: string;
}

/**
 * 生成 specs/README.md 索引
 */
export function generateBatchReadme(input: ReadmeGeneratorInput): string {
  const { projectName, version, moduleSpecs, projectDocs, bundles, outputDir } = input;
  const lines: string[] = [];

  lines.push(`# ${projectName} — 技术文档索引`);
  lines.push('');
  lines.push(`> 由 reverse-spec v${version} 自动生成 | ${new Date().toLocaleDateString('zh-CN')}`);
  lines.push('');

  // 产品与架构
  const productDocs = [
    { file: 'product-overview.md', label: '产品定位与核心能力' },
    { file: 'architecture-narrative.md', label: '架构叙事与关键设计决策' },
    { file: 'user-journeys.md', label: '用户旅程' },
    { file: 'config-reference.md', label: '配置参考' },
    { file: 'troubleshooting.md', label: '故障排查指南' },
  ].filter(d => fs.existsSync(path.join(outputDir, d.file)));

  if (productDocs.length > 0) {
    lines.push('## 📋 产品与使用');
    lines.push('');
    for (const doc of productDocs) {
      lines.push(`- [${doc.label}](${doc.file})`);
    }
    lines.push('');
  }

  // 架构与接口
  const archDocs = [
    { file: 'interface-surface.md', label: '接口表面（全项目 API 索引）' },
    { file: 'data-model.md', label: '数据模型' },
    { file: 'event-surface.md', label: '事件与消息流' },
  ].filter(d => fs.existsSync(path.join(outputDir, d.file)));

  if (archDocs.length > 0) {
    lines.push('## 🏗 架构与接口');
    lines.push('');
    for (const doc of archDocs) {
      lines.push(`- [${doc.label}](${doc.file})`);
    }
    lines.push('');
  }

  // 模块规范
  if (moduleSpecs.length > 0) {
    lines.push('## 📦 模块规范');
    lines.push('');
    for (const mod of moduleSpecs) {
      const specFile = `${mod}.spec.md`;
      if (fs.existsSync(path.join(outputDir, specFile))) {
        lines.push(`- [${mod}](${specFile})`);
      }
    }
    lines.push('');
  }

  // 质量审计
  const qualityDocs = [
    { file: 'quality-report.md', label: '质量报告（评分与改进建议）' },
    { file: '_coverage-report.md', label: '覆盖率审计' },
  ].filter(d => fs.existsSync(path.join(outputDir, d.file)));

  if (qualityDocs.length > 0) {
    lines.push('## 📊 质量审计');
    lines.push('');
    for (const doc of qualityDocs) {
      lines.push(`- [${doc.label}](${doc.file})`);
    }
    lines.push('');
  }

  // 决策记录
  const hasAdr = fs.existsSync(path.join(outputDir, 'docs/adr/index.md'));
  const hasBriefs = fs.existsSync(path.join(outputDir, 'feature-briefs/index.md'));

  if (hasAdr || hasBriefs) {
    lines.push('## 📝 决策记录');
    lines.push('');
    if (hasAdr) lines.push('- [架构决策记录（ADR）](docs/adr/index.md)');
    if (hasBriefs) lines.push('- [Feature Briefs（从 Issues/PRs 生成）](feature-briefs/index.md)');
    lines.push('');
  }

  // 文档 Bundle
  if (bundles && bundles.length > 0) {
    lines.push('## 📚 文档 Bundle（按角色）');
    lines.push('');
    const bundleLabels: Record<string, string> = {
      'developer-onboarding': '🧑‍💻 开发者入门',
      'architecture-review': '🏛 架构评审',
      'api-consumer': '🔌 API 消费者',
      'ops-handover': '🔧 运维交接',
    };
    for (const bundle of bundles) {
      const label = bundleLabels[bundle.id] ?? bundle.title;
      const indexPath = `${bundle.rootDir}/docs/index.md`;
      if (fs.existsSync(path.join(outputDir, '..', indexPath)) || fs.existsSync(path.join(outputDir, indexPath.replace('specs/', '')))) {
        lines.push(`- [${label}](bundles/${bundle.id}/docs/index.md)（${bundle.documentCount} 篇文档）`);
      } else {
        lines.push(`- ${label}（${bundle.documentCount} 篇文档）`);
      }
    }
    lines.push('');
  }

  // 系统信息
  lines.push('---');
  lines.push('');
  lines.push(`*本索引包含 ${moduleSpecs.length} 个模块规范 + ${projectDocs.length} 个项目级文档*`);

  return lines.join('\n');
}
