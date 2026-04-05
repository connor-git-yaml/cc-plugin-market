import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseYamlDocument } from '../../plugins/spec-driver/scripts/lib/simple-yaml.mjs';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function replaceExactLine(content, matcher, replacement) {
  if (matcher.test(content)) {
    return content.replace(matcher, replacement);
  }
  return content;
}

function ensureReleaseLine(content, version) {
  const releaseLine = `> **发布版本**: v${version}`;
  if (content.includes('> **发布版本**: v')) {
    return content.replace(/^> \*\*发布版本\*\*: v.+$/m, releaseLine);
  }
  if (content.includes('> **产品**:')) {
    return content.replace(/(^> \*\*产品\*\*: .+$)/m, `$1\n${releaseLine}`);
  }
  return `${releaseLine}\n\n${content}`;
}

function ensurePluginReadmeReleaseLine(content, version) {
  const releaseLine = `> 当前发布版本: v${version}`;
  if (content.includes('> 当前发布版本: v')) {
    return content.replace(/^> 当前发布版本: v.+$/m, releaseLine);
  }
  return content.replace(/^(# .+\n)(\n)?/, `$1\n${releaseLine}\n\n`);
}

function updateRootReadme(content, contract) {
  let next = content;
  next = replaceExactLine(
    next,
    /^!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-[^)]+-green\)$/m,
    `![Version](https://img.shields.io/badge/version-${contract.products['reverse-spec'].version}-green)`,
  );
  next = next.replace(/\*\*Spec Driver\*\* \(v[0-9.]+\)/g, '**Spec Driver**');
  next = next.replace(
    /└── spec-driver\/\s+# Spec Driver orchestrator \(v[0-9.]+\)/,
    '└── spec-driver/                   # Spec Driver orchestrator',
  );
  return next;
}

function updatePluginReadme(content, productId, version) {
  let next = ensurePluginReadmeReleaseLine(content, version);

  if (productId === 'spec-driver') {
    next = next.replace(/^### 包装来源约定（v[0-9.]+）$/m, '### 包装来源约定');
    next = next.replace(/^### 变更说明（v[0-9.]+）$/m, '### 当前结构状态');
  }

  return next;
}

function updatePostinstall(content, version) {
  return content.replace(/^PLUGIN_VERSION="[^"]+"$/m, `PLUGIN_VERSION="${version}"`);
}

function updatePackageLock(content, version) {
  return content
    .replace(/^  "version": "[^"]+",$/m, `  "version": "${version}",`)
    .replace(/^      "version": "[^"]+",$/m, `      "version": "${version}",`);
}

function updateProductMapping(content, contract) {
  let next = content;
  for (const [productId, product] of Object.entries(contract.products)) {
    const pattern = new RegExp(
      `(\\n\\s{2}${productId}:\\n\\s{4}description: )"[^"]+"`,
      'm',
    );
    next = next.replace(pattern, `$1"${product.productMappingDescription}"`);
  }
  return next;
}

export function loadReleaseContract(projectRoot) {
  const contractPath = path.resolve(projectRoot, 'contracts', 'release-contract.yaml');
  const contract = parseYamlDocument(readFileSync(contractPath, 'utf8'));
  return { contractPath, contract };
}

export function syncReleaseContract(projectRoot) {
  const { contractPath, contract } = loadReleaseContract(projectRoot);
  const touchedPaths = [];

  if (contract.marketplace?.path) {
    const marketplacePath = path.resolve(projectRoot, contract.marketplace.path);
    const marketplace = readJson(marketplacePath);
    marketplace.metadata = {
      ...marketplace.metadata,
      ...contract.marketplace.metadata,
    };

    for (const pluginEntry of marketplace.plugins ?? []) {
      const product = contract.products?.[pluginEntry.name];
      if (!product) {
        continue;
      }
      pluginEntry.version = product.version;
      pluginEntry.description = product.marketplaceDescription;
    }

    writeJson(marketplacePath, marketplace);
    touchedPaths.push(path.relative(projectRoot, marketplacePath));
  }

  for (const [productId, product] of Object.entries(contract.products ?? {})) {
    if (product.packageManifestPath) {
      const packageManifestPath = path.resolve(projectRoot, product.packageManifestPath);
      const packageManifest = readJson(packageManifestPath);
      packageManifest.version = product.version;
      writeJson(packageManifestPath, packageManifest);
      touchedPaths.push(path.relative(projectRoot, packageManifestPath));
    }

    if (product.packageLockPath) {
      const packageLockPath = path.resolve(projectRoot, product.packageLockPath);
      const packageLock = readFileSync(packageLockPath, 'utf8');
      writeFileSync(
        packageLockPath,
        updatePackageLock(packageLock, product.version).replace(/\n*$/, '\n'),
        'utf8',
      );
      touchedPaths.push(path.relative(projectRoot, packageLockPath));
    }

    if (product.pluginManifestPath) {
      const pluginManifestPath = path.resolve(projectRoot, product.pluginManifestPath);
      const pluginManifest = readJson(pluginManifestPath);
      pluginManifest.version = product.version;
      pluginManifest.description = product.pluginDescription;
      writeJson(pluginManifestPath, pluginManifest);
      touchedPaths.push(path.relative(projectRoot, pluginManifestPath));
    }

    if (product.pluginReadmePath) {
      const pluginReadmePath = path.resolve(projectRoot, product.pluginReadmePath);
      const pluginReadme = readFileSync(pluginReadmePath, 'utf8');
      writeFileSync(
        pluginReadmePath,
        updatePluginReadme(pluginReadme, productId, product.version),
        'utf8',
      );
      touchedPaths.push(path.relative(projectRoot, pluginReadmePath));
    }

    if (product.currentSpecPath) {
      const currentSpecPath = path.resolve(projectRoot, product.currentSpecPath);
      const currentSpec = readFileSync(currentSpecPath, 'utf8');
      writeFileSync(currentSpecPath, ensureReleaseLine(currentSpec, product.version), 'utf8');
      touchedPaths.push(path.relative(projectRoot, currentSpecPath));
    }

    if (product.postinstallPath) {
      const postinstallPath = path.resolve(projectRoot, product.postinstallPath);
      const postinstall = readFileSync(postinstallPath, 'utf8');
      writeFileSync(postinstallPath, updatePostinstall(postinstall, product.version), 'utf8');
      touchedPaths.push(path.relative(projectRoot, postinstallPath));
    }
  }

  const rootReadmePath = path.resolve(projectRoot, 'README.md');
  const rootReadme = readFileSync(rootReadmePath, 'utf8');
  writeFileSync(rootReadmePath, updateRootReadme(rootReadme, contract), 'utf8');
  touchedPaths.push(path.relative(projectRoot, rootReadmePath));

  const productMappingPath = path.resolve(projectRoot, 'specs', 'products', 'product-mapping.yaml');
  const productMapping = readFileSync(productMappingPath, 'utf8');
  writeFileSync(productMappingPath, updateProductMapping(productMapping, contract), 'utf8');
  touchedPaths.push(path.relative(projectRoot, productMappingPath));

  return { contractPath: path.relative(projectRoot, contractPath), contract, touchedPaths };
}

export function validateReleaseContract(projectRoot) {
  const { contractPath, contract } = loadReleaseContract(projectRoot);
  const errors = [];
  const checks = [];

  const expectEqual = (id, label, actual, expected) => {
    const pass = actual === expected;
    checks.push({ id, label, status: pass ? 'pass' : 'fail' });
    if (!pass) {
      errors.push(`${label} 不一致: expected="${expected}", actual="${actual}"`);
    }
  };

  if (contract.marketplace?.path) {
    const marketplacePath = path.resolve(projectRoot, contract.marketplace.path);
    const marketplace = readJson(marketplacePath);
    expectEqual(
      'marketplace-version',
      'marketplace metadata.version',
      marketplace.metadata?.version,
      contract.marketplace.metadata?.version,
    );
    for (const pluginEntry of marketplace.plugins ?? []) {
      const product = contract.products?.[pluginEntry.name];
      if (!product) {
        continue;
      }
      expectEqual(
        `marketplace-plugin-version:${pluginEntry.name}`,
        `marketplace ${pluginEntry.name} version`,
        pluginEntry.version,
        product.version,
      );
      expectEqual(
        `marketplace-plugin-description:${pluginEntry.name}`,
        `marketplace ${pluginEntry.name} description`,
        pluginEntry.description,
        product.marketplaceDescription,
      );
    }
  }

  for (const [productId, product] of Object.entries(contract.products ?? {})) {
    if (product.packageManifestPath) {
      const manifest = readJson(path.resolve(projectRoot, product.packageManifestPath));
      expectEqual(
        `package-version:${productId}`,
        `${productId} package version`,
        manifest.version,
        product.version,
      );
    }

    if (product.packageLockPath) {
      const packageLock = readJson(path.resolve(projectRoot, product.packageLockPath));
      expectEqual(
        `package-lock-version:${productId}`,
        `${productId} package-lock root version`,
        packageLock.version,
        product.version,
      );
      expectEqual(
        `package-lock-package-version:${productId}`,
        `${productId} package-lock packages[\"\"] version`,
        packageLock.packages?.['']?.version,
        product.version,
      );
    }

    if (product.pluginManifestPath) {
      const manifest = readJson(path.resolve(projectRoot, product.pluginManifestPath));
      expectEqual(
        `plugin-version:${productId}`,
        `${productId} plugin manifest version`,
        manifest.version,
        product.version,
      );
      expectEqual(
        `plugin-description:${productId}`,
        `${productId} plugin manifest description`,
        manifest.description,
        product.pluginDescription,
      );
    }

    if (product.currentSpecPath) {
      const currentSpec = readFileSync(path.resolve(projectRoot, product.currentSpecPath), 'utf8');
      expectEqual(
        `current-spec-release:${productId}`,
        `${productId} current-spec release line`,
        currentSpec.match(/^> \*\*发布版本\*\*: v(.+)$/m)?.[1],
        product.version,
      );
    }

    if (product.pluginReadmePath) {
      const readme = readFileSync(path.resolve(projectRoot, product.pluginReadmePath), 'utf8');
      expectEqual(
        `plugin-readme-release:${productId}`,
        `${productId} plugin README release line`,
        readme.match(/^> 当前发布版本: v(.+)$/m)?.[1],
        product.version,
      );
    }

    if (product.postinstallPath) {
      const postinstall = readFileSync(path.resolve(projectRoot, product.postinstallPath), 'utf8');
      expectEqual(
        `postinstall-version:${productId}`,
        `${productId} postinstall version`,
        postinstall.match(/^PLUGIN_VERSION="(.+)"$/m)?.[1],
        product.version,
      );
    }
  }

  const rootReadme = readFileSync(path.resolve(projectRoot, 'README.md'), 'utf8');
  expectEqual(
    'root-readme-badge',
    'README reverse-spec version badge',
    rootReadme.match(/^!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-([^)]+)-green\)$/m)?.[1],
    contract.products?.['reverse-spec']?.version,
  );

  const productMapping = readFileSync(
    path.resolve(projectRoot, 'specs', 'products', 'product-mapping.yaml'),
    'utf8',
  );
  for (const [productId, product] of Object.entries(contract.products ?? {})) {
    expectEqual(
      `product-mapping-description:${productId}`,
      `${productId} product-mapping description`,
      productMapping.match(new RegExp(`\\n\\s{2}${productId}:\\n\\s{4}description: "([^"]+)"`, 'm'))?.[1],
      product.productMappingDescription,
    );
  }

  return {
    contractPath: path.relative(projectRoot, contractPath),
    status: errors.length > 0 ? 'fail' : 'pass',
    checks,
    errors,
  };
}
