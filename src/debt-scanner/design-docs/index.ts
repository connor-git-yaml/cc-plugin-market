/**
 * Design-doc open question 候选检测
 *
 * 输出：
 * - confirmedByRule: 显式命中，直接收录为最终 entry
 * - llmCandidates: 仅问号命中，需要 LLM 仲裁（或降级为直接丢弃 / 保留为空 topics）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OpenQuestionEntry } from '../types.js';
import { discoverDesignDocs } from './doc-discoverer.js';
import { parseMarkdownSections, type Section } from './markdown-sections.js';
import { endsWithQuestionMark, hasExplicitMarker, makeSnippet } from './rule-detector.js';

export interface OpenQuestionCandidate {
  /** 来源文档绝对路径 */
  absPath: string;
  /** 相对 projectRoot 的路径 */
  docPath: string;
  /** heading path */
  headingPath: string;
  /** 原文片段 */
  snippet: string;
}

export interface DetectOpenQuestionsResult {
  /** 规则命中的 confirmed 条目 */
  confirmed: OpenQuestionEntry[];
  /** 疑问句命中的 LLM 待仲裁候选 */
  llmCandidates: OpenQuestionCandidate[];
  /** 扫描的文档数 */
  docsScanned: number;
}

/**
 * 扫描 projectRoot 的 design-doc，提取 open question 候选。
 */
export function detectOpenQuestions(projectRoot: string): DetectOpenQuestionsResult {
  const absRoot = path.resolve(projectRoot);
  const docs = discoverDesignDocs(absRoot);
  const confirmed: OpenQuestionEntry[] = [];
  const llmCandidates: OpenQuestionCandidate[] = [];

  for (const absPath of docs) {
    let text: string;
    try {
      text = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }
    const relPath = toPosix(path.relative(absRoot, absPath));
    const sections = parseMarkdownSections(text);
    for (const section of sections) {
      for (const para of section.paragraphs) {
        if (hasExplicitMarker(para, section.headingPath)) {
          confirmed.push({
            snippet: makeSnippet(para),
            docPath: relPath,
            headingPath: section.headingPath || '(doc root)',
            source: 'rule',
            topics: [],
          });
          continue;
        }
        if (endsWithQuestionMark(para)) {
          llmCandidates.push({
            absPath,
            docPath: relPath,
            headingPath: section.headingPath || '(doc root)',
            snippet: makeSnippet(para),
          });
        }
      }
    }
  }

  return { confirmed, llmCandidates, docsScanned: docs.length };
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export { discoverDesignDocs, parseMarkdownSections };
export type { Section };
