import fs from 'node:fs';
import { getCatalogIndexPath } from './product-artifact-paths.mjs';
import { parseYamlDocument } from './simple-yaml.mjs';
import { writeYamlArtifact } from './script-report-io.mjs';

export function patchYamlArtifact(filePath, mutateFn) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }

  const current = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
  const next = mutateFn(current);
  writeYamlArtifact(filePath, next);
  return true;
}

export function patchProductCatalogIndex(projectRoot, mergeProduct) {
  const catalogIndexPath = getCatalogIndexPath(projectRoot);
  return patchYamlArtifact(catalogIndexPath, (catalog) => {
    if (!Array.isArray(catalog.products)) {
      return catalog;
    }

    return {
      ...catalog,
      products: catalog.products.map((product) => mergeProduct(product)),
    };
  });
}
