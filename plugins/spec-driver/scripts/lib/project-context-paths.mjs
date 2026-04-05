import path from 'node:path';

export function getSpecifyRoot(projectRoot) {
  return path.join(projectRoot, '.specify');
}

export function getProjectContextYamlPath(projectRoot) {
  return path.join(getSpecifyRoot(projectRoot), 'project-context.yaml');
}

export function getProjectContextMarkdownPath(projectRoot) {
  return path.join(getSpecifyRoot(projectRoot), 'project-context.md');
}

export function getProjectContextSuggestionsYamlPath(projectRoot) {
  return path.join(getSpecifyRoot(projectRoot), 'project-context.suggestions.yaml');
}

export function getProjectContextSuggestionsMarkdownPath(projectRoot) {
  return path.join(getSpecifyRoot(projectRoot), 'project-context.suggestions.md');
}
