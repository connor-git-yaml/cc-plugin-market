/**
 * Design-doc 发现
 *
 * 扫描 projectRoot 及其一级子目录，找出文件名匹配
 * README.md / architecture.md / notes.md / design.md（大小写不敏感）的文档。
 * AC-2.1。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const CANDIDATE_BASENAMES = new Set(['readme', 'architecture', 'notes', 'design']);

/**
 * 扫描 projectRoot 及一级子目录下的 design-doc。
 * 返回绝对路径列表（已稳定排序）。
 */
export function discoverDesignDocs(projectRoot: string): string[] {
  const abs = path.resolve(projectRoot);
  const out: string[] = [];
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return out;

  collectInDir(abs, out);
  for (const entry of safeReaddir(abs)) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
      collectInDir(child, out);
    }
  }
  out.sort();
  return out;
}

function collectInDir(dir: string, out: string[]): void {
  for (const entry of safeReaddir(dir)) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (!name.endsWith('.md')) continue;
    const base = name.slice(0, -3); // 去掉 .md
    if (CANDIDATE_BASENAMES.has(base)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDir(name: string): boolean {
  if (name.startsWith('.')) return true;
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === 'build' ||
    name === 'out' ||
    name === 'target' ||
    name === 'vendor' ||
    name === '__pycache__'
  );
}
