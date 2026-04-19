/**
 * Batch README 生成器
 * 为 batch 输出目录生成人类友好的 README.md 索引导航
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BATCH_OUTPUT_SUBDIRS } from '../panoramic/output-filenames.js';
import {
  extractGraphHighlights,
  renderGodNodesBlock,
  renderSurprisingBlock,
  renderGraphQueryHint,
} from './readme-graph-section.js';

export interface ReadmeGeneratorInput {
  /** 项目名称 */
  projectName: string;
  /** spectra 版本号 */
  version: string;
  /** 成功生成的模块列表 */
  moduleSpecs: string[];
  /** 项目级文档路径列表 */
  projectDocs: string[];
  /** Bundle profiles */
  bundles?: Array<{ id: string; title: string; rootDir: string; documentCount: number }>;
  /** 输出目录绝对路径（specs/ 根目录） */
  outputDir: string;
}

/**
 * 生成 specs/README.md 索引
 *
 * 目录结构：
 *   specs/
 *   ├── README.md           ← 本文件
 *   ├── modules/            ← 模块 Spec
 *   ├── project/            ← 项目级文档
 *   ├── bundles/            ← 文档 Bundle
 *   └── _meta/              ← 系统元数据
 */
export function generateBatchReadme(input: ReadmeGeneratorInput): string {
  const { projectName, version, moduleSpecs, projectDocs, bundles, outputDir } = input;
  const projectDir = path.join(outputDir, BATCH_OUTPUT_SUBDIRS.PROJECT);
  const modulesDir = path.join(outputDir, BATCH_OUTPUT_SUBDIRS.MODULES);
  const lines: string[] = [];

  lines.push(`# ${projectName} — 技术文档索引`);
  lines.push('');
  lines.push(`> 由 spectra v${version} 自动生成 | ${new Date().toLocaleDateString('zh-CN')}`);
  lines.push('');

  // 目录结构说明
  lines.push('## 目录结构');
  lines.push('');
  lines.push('```');
  lines.push(`${BATCH_OUTPUT_SUBDIRS.MODULES}/     模块级技术规范`);
  lines.push(`${BATCH_OUTPUT_SUBDIRS.PROJECT}/     项目级文档（架构、产品、质量）`);
  lines.push('bundles/     文档 Bundle（按角色组织）');
  lines.push(`${BATCH_OUTPUT_SUBDIRS.META}/       系统元数据`);
  lines.push('```');
  lines.push('');

  // 产品与使用
  const productDocs = [
    { file: 'product-overview.md', label: '产品定位与核心能力' },
    { file: 'architecture-narrative.md', label: '架构叙事与关键设计决策' },
    { file: 'user-journeys.md', label: '用户旅程' },
    { file: 'config-reference.md', label: '配置参考' },
    { file: 'troubleshooting.md', label: '故障排查指南' },
  ].filter(d => fs.existsSync(path.join(projectDir, d.file)));

  if (productDocs.length > 0) {
    lines.push('## 产品与使用');
    lines.push('');
    for (const doc of productDocs) {
      lines.push(`- [${doc.label}](${BATCH_OUTPUT_SUBDIRS.PROJECT}/${doc.file})`);
    }
    lines.push('');
  }

  // Feature 127：图摘要（代码核心抽象 + 意外连接），位于产品与使用之后、架构与接口之前
  const graphHighlights = extractGraphHighlights(outputDir);
  if (graphHighlights.hasGraph || graphHighlights.hasGraphReport) {
    lines.push(...renderGodNodesBlock(graphHighlights));
    lines.push(...renderSurprisingBlock(graphHighlights));
  }

  // 架构与接口
  const archDocs = [
    { file: 'interface-surface.md', label: '接口表面（全项目 API 索引）' },
    { file: 'data-model.md', label: '数据模型' },
    { file: 'event-surface.md', label: '事件与消息流' },
    { file: 'architecture-overview.md', label: '架构总览' },
    { file: 'component-view.md', label: '组件视图' },
    { file: 'dynamic-scenarios.md', label: '动态链路场景' },
    { file: 'runtime-topology.md', label: '运行时拓扑' },
    { file: 'pattern-hints.md', label: '架构模式提示' },
  ].filter(d => fs.existsSync(path.join(projectDir, d.file)));

  if (archDocs.length > 0) {
    lines.push('## 架构与接口');
    lines.push('');
    for (const doc of archDocs) {
      lines.push(`- [${doc.label}](${BATCH_OUTPUT_SUBDIRS.PROJECT}/${doc.file})`);
    }
    lines.push('');
    // Feature 127：图查询能力入口
    if (graphHighlights.hasGraph) {
      lines.push(...renderGraphQueryHint());
    }
  }

  // 模块规范
  if (moduleSpecs.length > 0) {
    lines.push('## 模块规范');
    lines.push('');
    for (const mod of moduleSpecs) {
      const specFile = `${mod}.spec.md`;
      if (fs.existsSync(path.join(modulesDir, specFile))) {
        lines.push(`- [${mod}](${BATCH_OUTPUT_SUBDIRS.MODULES}/${specFile})`);
      }
    }
    lines.push('');
  }

  // 质量审计
  // Codex review 修复：debt pipeline 在步骤 7（本 generator）之前运行，
  // 若由 readme-indexer 向旧 README 追加链接会被这里重写 README 时清零，
  // 所以由本 generator 统一拥有 technical-debt.md 链接的索引权。
  const qualityDocs = [
    { file: 'quality-report.md', label: '质量报告（评分与改进建议）' },
    { file: '_coverage-report.md', label: '覆盖率审计' },
    { file: 'technical-debt.md', label: '技术债清单（代码注释 + 设计开放问题）' },
  ].filter(d => fs.existsSync(path.join(projectDir, d.file)));

  if (qualityDocs.length > 0) {
    lines.push('## 质量审计');
    lines.push('');
    for (const doc of qualityDocs) {
      lines.push(`- [${doc.label}](${BATCH_OUTPUT_SUBDIRS.PROJECT}/${doc.file})`);
    }
    lines.push('');
  }

  // 决策记录
  const hasAdr = fs.existsSync(path.join(projectDir, 'docs/adr/index.md'));
  const hasBriefs = fs.existsSync(path.join(projectDir, 'feature-briefs/index.md'));

  if (hasAdr || hasBriefs) {
    lines.push('## 决策记录');
    lines.push('');
    if (hasAdr) lines.push(`- [架构决策记录（ADR）](${BATCH_OUTPUT_SUBDIRS.PROJECT}/docs/adr/index.md)`);
    if (hasBriefs) lines.push(`- [Feature Briefs（从 Issues/PRs 生成）](${BATCH_OUTPUT_SUBDIRS.PROJECT}/feature-briefs/index.md)`);
    lines.push('');
  }

  // 文档 Bundle
  if (bundles && bundles.length > 0) {
    lines.push('## 文档 Bundle（按角色）');
    lines.push('');
    const bundleLabels: Record<string, string> = {
      'developer-onboarding': '开发者入门',
      'architecture-review': '架构评审',
      'api-consumer': 'API 消费者',
      'ops-handover': '运维交接',
    };
    for (const bundle of bundles) {
      const label = bundleLabels[bundle.id] ?? bundle.title;
      const indexFilePath = `bundles/${bundle.id}/docs/index.md`;
      if (fs.existsSync(path.join(outputDir, indexFilePath))) {
        lines.push(`- [${label}](${indexFilePath})（${bundle.documentCount} 篇文档）`);
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
