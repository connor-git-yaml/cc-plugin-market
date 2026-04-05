import fs from 'node:fs';
import path from 'node:path';
import { stringifyYaml } from './simple-yaml.mjs';

export function ensureArtifactDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeJsonArtifact(filePath, value) {
  ensureArtifactDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function writeMarkdownArtifact(filePath, content) {
  ensureArtifactDir(filePath);
  const text = content.endsWith('\n') ? content : `${content}\n`;
  fs.writeFileSync(filePath, text, 'utf-8');
}

export function writeYamlArtifact(filePath, value) {
  ensureArtifactDir(filePath);
  const serialized = stringifyYaml(value);
  const text = serialized.endsWith('\n') ? serialized : `${serialized}\n`;
  fs.writeFileSync(filePath, text, 'utf-8');
}

export function readJsonArtifact(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
