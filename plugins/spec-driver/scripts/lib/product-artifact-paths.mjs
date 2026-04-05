import path from 'node:path';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

export function getProductsRoot(projectRoot) {
  return path.join(projectRoot, 'specs', 'products');
}

export function getProductsGeneratedRoot(projectRoot) {
  return path.join(getProductsRoot(projectRoot), '_generated');
}

export function getProductRoot(projectRoot, productId) {
  return path.join(getProductsRoot(projectRoot), productId);
}

export function getProductGeneratedRoot(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), '_generated');
}

export function getProductCurrentSpecPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'current-spec.md');
}

export function getProductEntityPath(projectRoot, productId) {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'entity.yaml');
}

export function getProductQualityReportJsonPath(projectRoot, productId) {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'quality-report.json');
}

export function getProductQualityReportMarkdownPath(projectRoot, productId) {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'quality-report.md');
}

export function getProductScorecardReportJsonPath(projectRoot, productId) {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'scorecard-report.json');
}

export function getProductScorecardReportMarkdownPath(projectRoot, productId) {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'scorecard-report.md');
}

export function getProductWorkflowIndexJsonPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'workflow-index.json');
}

export function getProductWorkflowIndexMarkdownPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'workflow-index.md');
}

export function getProductAdoptionReportJsonPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'adoption-report.json');
}

export function getProductAdoptionReportMarkdownPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductGeneratedRoot(projectRoot, productId), 'adoption-report.md');
}

export function getCatalogIndexPath(projectRoot) {
  return path.join(getProductsGeneratedRoot(projectRoot), 'catalog-index.yaml');
}

export function getScorecardIndexPath(projectRoot) {
  return path.join(getProductsGeneratedRoot(projectRoot), 'scorecard-index.yaml');
}

export function getQualityReportIndexPath(projectRoot) {
  return path.join(getProductsGeneratedRoot(projectRoot), 'quality-report-index.yaml');
}

export function getLegacyProductEntityPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'entity.yaml');
}

export function getLegacyProductQualityReportJsonPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'quality-report.json');
}

export function getLegacyProductQualityReportMarkdownPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'quality-report.md');
}

export function getLegacyProductScorecardReportJsonPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'scorecard-report.json');
}

export function getLegacyProductScorecardReportMarkdownPath(projectRoot, productId) {
  return path.join(getProductRoot(projectRoot, productId), 'scorecard-report.md');
}

export function getLegacyProductWorkflowIndexJsonPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductRoot(projectRoot, productId), 'workflow-index.json');
}

export function getLegacyProductWorkflowIndexMarkdownPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductRoot(projectRoot, productId), 'workflow-index.md');
}

export function getLegacyProductAdoptionReportJsonPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductRoot(projectRoot, productId), 'adoption-report.json');
}

export function getLegacyProductAdoptionReportMarkdownPath(projectRoot, productId = 'spec-driver') {
  return path.join(getProductRoot(projectRoot, productId), 'adoption-report.md');
}

export function getLegacyCatalogIndexPath(projectRoot) {
  return path.join(getProductsRoot(projectRoot), 'catalog-index.yaml');
}

export function getLegacyScorecardIndexPath(projectRoot) {
  return path.join(getProductsRoot(projectRoot), 'scorecard-index.yaml');
}

export function getLegacyQualityReportIndexPath(projectRoot) {
  return path.join(getProductsRoot(projectRoot), 'quality-report-index.yaml');
}

export function getPreferredAndLegacyPaths(preferredPath, legacyPath, ...extraLegacyPaths) {
  return [preferredPath, legacyPath, ...extraLegacyPaths].filter(Boolean);
}

export function toRelativePosix(projectRoot, filePath) {
  return toPosix(path.relative(projectRoot, filePath));
}
