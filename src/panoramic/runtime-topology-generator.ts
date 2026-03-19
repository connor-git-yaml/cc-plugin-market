/**
 * RuntimeTopologyGenerator
 *
 * 统一抽取 Compose / Dockerfile / .env / 配置提示，产出共享 RuntimeTopology。
 * Feature 043 负责生产它；Feature 045 将直接消费 topology 字段。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { DockerfileParser } from './parsers/dockerfile-parser.js';
import { EnvConfigParser } from './parsers/env-config-parser.js';
import { TomlConfigParser } from './parsers/toml-config-parser.js';
import { YamlConfigParser, parseYamlDocument } from './parsers/yaml-config-parser.js';
import type { ConfigEntries, DockerfileInfo } from './parsers/types.js';
import type { YamlArray, YamlObject, YamlValue } from './parsers/yaml-config-parser.js';
import { loadTemplate } from './utils/template-loader.js';
import {
  buildSyntheticImageName,
  collectRuntimeConfigHints,
  extractRuntimeBuildStages,
  mergeEnvironmentVariables,
  normalizeCommandValue,
  summarizeRuntimeTopology,
  type RuntimeConfigHint,
  type RuntimeContainer,
  type RuntimeDependency,
  type RuntimeEnvironmentVariable,
  type RuntimeImage,
  type RuntimePortBinding,
  type RuntimeService,
  type RuntimeTopology,
  type RuntimeTopologyStats,
  type RuntimeVolumeMount,
} from './runtime-topology-model.js';

const COMPOSE_FILE_RE = /^(?:docker-compose|compose)(?:\.[^/]+)*\.ya?ml$/i;
const ROOT_DOCKERFILE_RE = /^Dockerfile(?:\.[^/]+)*$/;
const ENV_FILE_RE = /^\.env(?:\.[^/]+)*$/;
const YAML_CONFIG_RE = /\.ya?ml$/i;
const TOML_CONFIG_RE = /\.toml$/i;

interface ComposeBuildDefinition {
  context: string;
  dockerfilePath?: string;
  targetStage?: string;
}

interface ComposeServiceDefinition {
  name: string;
  sourceFile: string;
  image?: string;
  build?: ComposeBuildDefinition;
  containerName: string;
  command?: string;
  entrypoint?: string;
  environment: RuntimeEnvironmentVariable[];
  envFiles: string[];
  ports: RuntimePortBinding[];
  volumes: RuntimeVolumeMount[];
  dependsOn: RuntimeDependency[];
}

interface ComposeFileDefinition {
  filePath: string;
  services: ComposeServiceDefinition[];
}

interface DockerfileArtifact {
  filePath: string;
  relativePath: string;
  parsed: DockerfileInfo;
  serviceNames: string[];
  runtimeTargets: string[];
}

interface RuntimeEnvFile {
  filePath: string;
  entries: RuntimeEnvironmentVariable[];
}

export interface RuntimeTopologyInput {
  projectName: string;
  composeFiles: ComposeFileDefinition[];
  dockerfiles: DockerfileArtifact[];
  envFiles: RuntimeEnvFile[];
  configHints: RuntimeConfigHint[];
  warnings: string[];
}

export interface RuntimeTopologyOutput {
  title: string;
  generatedAt: string;
  topology: RuntimeTopology;
  stats: RuntimeTopologyStats;
  warnings: string[];
}

/**
 * 运行时拓扑生成器。
 */
export class RuntimeTopologyGenerator
  implements DocumentGenerator<RuntimeTopologyInput, RuntimeTopologyOutput>
{
  readonly id = 'runtime-topology' as const;
  readonly name = '运行时拓扑生成器' as const;
  readonly description = '联合解析 Compose、Dockerfile、.env 和配置提示，生成统一运行时拓扑模型';

  isApplicable(context: ProjectContext): boolean {
    return (
      discoverComposeFiles(context.projectRoot, context.configFiles).length > 0 ||
      discoverRootDockerfiles(context.projectRoot, context.configFiles).length > 0
    );
  }

  async extract(context: ProjectContext): Promise<RuntimeTopologyInput> {
    const projectName = detectProjectName(context.projectRoot);
    const warnings = new Set<string>();
    const composeFiles = this.extractComposeFiles(context.projectRoot, context.configFiles, warnings);
    const dockerfiles = await this.extractDockerfiles(context.projectRoot, context.configFiles, composeFiles, warnings);
    const envFiles = await this.extractEnvFiles(context.projectRoot, composeFiles, warnings);
    const configHints = await this.extractRuntimeConfigHints(
      context.projectRoot,
      composeFiles,
      dockerfiles,
      envFiles,
    );

    return {
      projectName,
      composeFiles,
      dockerfiles,
      envFiles,
      configHints,
      warnings: [...warnings].sort(),
    };
  }

  async generate(
    input: RuntimeTopologyInput,
    _options?: GenerateOptions,
  ): Promise<RuntimeTopologyOutput> {
    const envMap = new Map<string, RuntimeEnvironmentVariable[]>(
      input.envFiles.map((envFile) => [envFile.filePath, envFile.entries]),
    );

    const stagesByDockerfile = new Map<string, ReturnType<typeof extractRuntimeBuildStages>>();
    for (const dockerfile of input.dockerfiles) {
      stagesByDockerfile.set(
        dockerfile.relativePath,
        extractRuntimeBuildStages(dockerfile.parsed, dockerfile.relativePath, dockerfile.runtimeTargets),
      );
    }

    const services: RuntimeService[] = [];
    const containers: RuntimeContainer[] = [];
    const imagesByKey = new Map<string, RuntimeImage>();

    for (const composeFile of input.composeFiles) {
      for (const service of composeFile.services) {
        const envFileEntries = service.envFiles.flatMap((envFile) => envMap.get(envFile) ?? []);
        const environment = mergeEnvironmentVariables(envFileEntries, service.environment);
        const stageNames = service.build?.dockerfilePath
          ? (stagesByDockerfile.get(service.build.dockerfilePath) ?? []).map((stage) => stage.name)
          : [];
        const imageName = service.image ?? buildSyntheticImageName(service.name);

        services.push({
          name: service.name,
          sourceFile: service.sourceFile,
          containerName: service.containerName,
          image: imageName,
          buildContext: service.build?.context,
          dockerfilePath: service.build?.dockerfilePath,
          targetStage: service.build?.targetStage,
          stageNames,
          command: service.command,
          entrypoint: service.entrypoint,
          environment,
          envFiles: service.envFiles,
          ports: service.ports,
          volumes: service.volumes,
          dependsOn: service.dependsOn,
        });

        containers.push({
          name: service.containerName,
          service: service.name,
          sourceFile: service.sourceFile,
          image: imageName,
          command: service.command,
          entrypoint: service.entrypoint,
          environment,
          ports: service.ports,
          volumes: service.volumes,
          dependsOn: service.dependsOn.map((dependency) => dependency.service),
        });

        const imageKey = [
          imageName,
          service.build?.dockerfilePath ?? '',
          service.build?.targetStage ?? '',
        ].join('|');

        if (!imagesByKey.has(imageKey)) {
          imagesByKey.set(imageKey, {
            name: imageName,
            explicitImage: service.image,
            sourceFile: service.sourceFile,
            buildContext: service.build?.context,
            dockerfilePath: service.build?.dockerfilePath,
            targetStage: service.build?.targetStage,
            stageNames,
          });
        }
      }
    }

    // Dockerfile-only 场景仍保留镜像和 stages
    for (const dockerfile of input.dockerfiles) {
      const existing = dockerfile.serviceNames.length > 0
        ? undefined
        : imagesByKey.get(`${dockerfile.relativePath}||`);

      if (!existing && dockerfile.serviceNames.length === 0) {
        const standaloneName = dockerfile.relativePath;
        imagesByKey.set(`${standaloneName}||`, {
          name: standaloneName,
          sourceFile: dockerfile.relativePath,
          dockerfilePath: dockerfile.relativePath,
          stageNames: (stagesByDockerfile.get(dockerfile.relativePath) ?? []).map((stage) => stage.name),
        });
      }
    }

    const stages = [...stagesByDockerfile.values()]
      .flat()
      .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.index - b.index);

    const topology: RuntimeTopology = {
      projectName: input.projectName,
      services: services.sort((a, b) => a.name.localeCompare(b.name)),
      images: [...imagesByKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
      containers: containers.sort((a, b) => a.name.localeCompare(b.name)),
      stages,
      configHints: dedupeConfigHints(input.configHints),
      sourceFiles: collectSourceFiles(input, stagesByDockerfile),
    };

    return {
      title: `运行时拓扑: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      topology,
      stats: summarizeRuntimeTopology(topology),
      warnings: input.warnings,
    };
  }

  render(output: RuntimeTopologyOutput): string {
    const template = loadTemplate('runtime-topology.hbs', import.meta.url);
    return template(output);
  }

  private extractComposeFiles(
    projectRoot: string,
    configFiles: Map<string, string>,
    warnings: Set<string>,
  ): ComposeFileDefinition[] {
    const composeFiles: ComposeFileDefinition[] = [];

    for (const composePath of discoverComposeFiles(projectRoot, configFiles)) {
      try {
        const content = fs.readFileSync(composePath, 'utf-8');
        composeFiles.push(parseComposeFile(projectRoot, composePath, content));
      } catch (error) {
        warnings.add(`无法读取 Compose 文件: ${toProjectRelativePath(projectRoot, composePath)} (${String(error)})`);
      }
    }

    return composeFiles.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  private async extractDockerfiles(
    projectRoot: string,
    configFiles: Map<string, string>,
    composeFiles: ComposeFileDefinition[],
    warnings: Set<string>,
  ): Promise<DockerfileArtifact[]> {
    const dockerfileRefs = new Map<
      string,
      {
        relativePath: string;
        serviceNames: Set<string>;
        runtimeTargets: Set<string>;
      }
    >();

    for (const dockerfilePath of discoverRootDockerfiles(projectRoot, configFiles)) {
      dockerfileRefs.set(dockerfilePath, {
        relativePath: toProjectRelativePath(projectRoot, dockerfilePath),
        serviceNames: new Set<string>(),
        runtimeTargets: new Set<string>(),
      });
    }

    for (const composeFile of composeFiles) {
      for (const service of composeFile.services) {
        if (!service.build?.dockerfilePath) continue;

        const absolutePath = path.resolve(projectRoot, service.build.dockerfilePath);
        const existing = dockerfileRefs.get(absolutePath) ?? {
          relativePath: toProjectRelativePath(projectRoot, absolutePath),
          serviceNames: new Set<string>(),
          runtimeTargets: new Set<string>(),
        };
        existing.serviceNames.add(service.name);
        if (service.build.targetStage) {
          existing.runtimeTargets.add(service.build.targetStage);
        }
        dockerfileRefs.set(absolutePath, existing);
      }
    }

    const parser = new DockerfileParser();
    const results: DockerfileArtifact[] = [];

    for (const [absolutePath, metadata] of dockerfileRefs) {
      if (!fs.existsSync(absolutePath)) {
        warnings.add(`引用的 Dockerfile 不存在: ${metadata.relativePath}`);
        continue;
      }

      const parsed = await parser.parse(absolutePath);
      results.push({
        filePath: absolutePath,
        relativePath: metadata.relativePath,
        parsed,
        serviceNames: [...metadata.serviceNames].sort(),
        runtimeTargets: [...metadata.runtimeTargets].sort(),
      });
    }

    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private async extractEnvFiles(
    projectRoot: string,
    composeFiles: ComposeFileDefinition[],
    warnings: Set<string>,
  ): Promise<RuntimeEnvFile[]> {
    const envPaths = new Set<string>(discoverRootEnvFiles(projectRoot));

    for (const composeFile of composeFiles) {
      for (const service of composeFile.services) {
        for (const envFile of service.envFiles) {
          const absolutePath = path.resolve(projectRoot, envFile);
          if (!fs.existsSync(absolutePath)) {
            warnings.add(`引用的 env_file 不存在: ${envFile}`);
            continue;
          }
          envPaths.add(absolutePath);
        }
      }
    }

    const parser = new EnvConfigParser();
    const results: RuntimeEnvFile[] = [];

    for (const envPath of envPaths) {
      const relativePath = toProjectRelativePath(projectRoot, envPath);
      const parsed = await parser.parse(envPath) as ConfigEntries;
      results.push({
        filePath: relativePath,
        entries: parsed.entries.map((entry) => ({
          name: entry.keyPath,
          value: entry.defaultValue,
          sourceKind: 'env-file',
          sourceFile: relativePath,
          scope: 'global',
        })),
      });
    }

    return results.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  private async extractRuntimeConfigHints(
    projectRoot: string,
    composeFiles: ComposeFileDefinition[],
    dockerfiles: DockerfileArtifact[],
    envFiles: RuntimeEnvFile[],
  ): Promise<RuntimeConfigHint[]> {
    const composePaths = new Set(composeFiles.map((file) => path.resolve(projectRoot, file.filePath)));
    const dockerfilePaths = new Set(dockerfiles.map((dockerfile) => dockerfile.filePath));
    const envPaths = new Set(envFiles.map((envFile) => path.resolve(projectRoot, envFile.filePath)));
    const hints: RuntimeConfigHint[] = [];

    for (const envFile of envFiles) {
      hints.push(
        ...envFile.entries.map((entry) => ({
          keyPath: entry.name,
          value: entry.value ?? '',
          sourceFile: envFile.filePath,
          format: 'env' as const,
          category: 'environment' as const,
        })),
      );
    }

    const rootEntries = safeReadDir(projectRoot);
    const yamlParser = new YamlConfigParser();
    const tomlParser = new TomlConfigParser();

    for (const entry of rootEntries) {
      if (!entry.isFile()) continue;

      const absolutePath = path.join(projectRoot, entry.name);
      if (composePaths.has(absolutePath) || dockerfilePaths.has(absolutePath) || envPaths.has(absolutePath)) {
        continue;
      }

      const relativePath = toProjectRelativePath(projectRoot, absolutePath);
      if (YAML_CONFIG_RE.test(entry.name)) {
        const parsed = await yamlParser.parse(absolutePath) as ConfigEntries;
        hints.push(...collectRuntimeConfigHints(parsed.entries, relativePath, 'yaml'));
      } else if (TOML_CONFIG_RE.test(entry.name)) {
        const parsed = await tomlParser.parse(absolutePath) as ConfigEntries;
        hints.push(...collectRuntimeConfigHints(parsed.entries, relativePath, 'toml'));
      }
    }

    return hints.sort(
      (a, b) =>
        a.sourceFile.localeCompare(b.sourceFile) ||
        a.keyPath.localeCompare(b.keyPath),
    );
  }
}

function parseComposeFile(projectRoot: string, composePath: string, content: string): ComposeFileDefinition {
  const composeDoc = parseYamlDocument(content);
  const servicesNode = composeDoc.services;
  const services = isYamlObject(servicesNode)
    ? Object.entries(servicesNode).flatMap(([serviceName, serviceValue]) => {
      if (!isYamlObject(serviceValue)) {
        return [];
      }
      return [parseComposeService(projectRoot, composePath, serviceName, serviceValue)];
    })
    : [];

  return {
    filePath: toProjectRelativePath(projectRoot, composePath),
    services: services.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function parseComposeService(
  projectRoot: string,
  composePath: string,
  serviceName: string,
  serviceNode: YamlObject,
): ComposeServiceDefinition {
  const relativeComposePath = toProjectRelativePath(projectRoot, composePath);
  const composeDir = path.dirname(composePath);

  return {
    name: serviceName,
    sourceFile: relativeComposePath,
    image: yamlToString(serviceNode.image),
    build: parseComposeBuild(projectRoot, composeDir, serviceNode.build),
    containerName: yamlToString(serviceNode.container_name) ?? serviceName,
    command: normalizeCommandValue(serviceNode.command),
    entrypoint: normalizeCommandValue(serviceNode.entrypoint),
    environment: parseComposeEnvironment(serviceNode.environment, relativeComposePath),
    envFiles: parseComposeEnvFiles(projectRoot, composeDir, serviceNode.env_file),
    ports: parseComposePorts(serviceNode.ports, relativeComposePath),
    volumes: parseComposeVolumes(serviceNode.volumes, relativeComposePath),
    dependsOn: parseComposeDependsOn(serviceNode.depends_on, relativeComposePath),
  };
}

function parseComposeBuild(
  projectRoot: string,
  composeDir: string,
  buildNode: YamlValue | undefined,
): ComposeBuildDefinition | undefined {
  if (buildNode === undefined) {
    return undefined;
  }

  if (typeof buildNode === 'string') {
    const buildContext = resolveComposePath(projectRoot, composeDir, buildNode);
    return {
      context: toProjectRelativePath(projectRoot, buildContext),
      dockerfilePath: toProjectRelativePath(projectRoot, resolveComposePath(projectRoot, buildContext, 'Dockerfile')),
    };
  }

  if (!isYamlObject(buildNode)) {
    return undefined;
  }

  const rawContext = yamlToString(buildNode.context) ?? '.';
  const buildContext = resolveComposePath(projectRoot, composeDir, rawContext);
  const rawDockerfile = yamlToString(buildNode.dockerfile) ?? 'Dockerfile';

  return {
    context: toProjectRelativePath(projectRoot, buildContext),
    dockerfilePath: toProjectRelativePath(projectRoot, resolveComposePath(projectRoot, buildContext, rawDockerfile)),
    targetStage: yamlToString(buildNode.target),
  };
}

function parseComposeEnvironment(
  environmentNode: YamlValue | undefined,
  sourceFile: string,
): RuntimeEnvironmentVariable[] {
  if (!environmentNode) {
    return [];
  }

  const environment: RuntimeEnvironmentVariable[] = [];

  if (isYamlObject(environmentNode)) {
    for (const [name, rawValue] of Object.entries(environmentNode)) {
      environment.push({
        name,
        value: yamlToString(rawValue),
        sourceKind: 'compose',
        sourceFile,
        scope: 'service',
      });
    }
  } else if (Array.isArray(environmentNode)) {
    for (const item of environmentNode) {
      const rawValue = yamlToString(item);
      if (!rawValue) continue;
      const separatorIndex = rawValue.indexOf('=');
      if (separatorIndex < 0) {
        environment.push({
          name: rawValue,
          sourceKind: 'compose',
          sourceFile,
          scope: 'service',
        });
        continue;
      }

      environment.push({
        name: rawValue.slice(0, separatorIndex),
        value: rawValue.slice(separatorIndex + 1),
        sourceKind: 'compose',
        sourceFile,
        scope: 'service',
      });
    }
  }

  return environment.sort((a, b) => a.name.localeCompare(b.name));
}

function parseComposeEnvFiles(
  projectRoot: string,
  composeDir: string,
  envNode: YamlValue | undefined,
): string[] {
  if (!envNode) {
    return [];
  }

  if (typeof envNode === 'string') {
    return [toProjectRelativePath(projectRoot, resolveComposePath(projectRoot, composeDir, envNode))];
  }

  if (Array.isArray(envNode)) {
    return envNode
      .map((item) => yamlToString(item))
      .filter((item): item is string => Boolean(item))
      .map((item) => toProjectRelativePath(projectRoot, resolveComposePath(projectRoot, composeDir, item)))
      .sort();
  }

  return [];
}

function parseComposeDependsOn(
  dependsOnNode: YamlValue | undefined,
  sourceFile: string,
): RuntimeDependency[] {
  if (!dependsOnNode) {
    return [];
  }

  const dependsOn: RuntimeDependency[] = [];

  if (Array.isArray(dependsOnNode)) {
    for (const item of dependsOnNode) {
      const service = yamlToString(item);
      if (!service) continue;
      dependsOn.push({ service, sourceFile });
    }
  } else if (isYamlObject(dependsOnNode)) {
    for (const [service, rawValue] of Object.entries(dependsOnNode)) {
      if (isYamlObject(rawValue)) {
        dependsOn.push({
          service,
          sourceFile,
          condition: yamlToString(rawValue.condition),
          required: yamlToBoolean(rawValue.required),
        });
      } else {
        dependsOn.push({
          service,
          sourceFile,
          condition: yamlToString(rawValue),
        });
      }
    }
  }

  return dependsOn.sort((a, b) => a.service.localeCompare(b.service));
}

function parseComposePorts(
  portsNode: YamlValue | undefined,
  sourceFile: string,
): RuntimePortBinding[] {
  if (!portsNode || !Array.isArray(portsNode)) {
    return [];
  }

  return portsNode
    .flatMap((portNode) => {
      if (typeof portNode === 'string') {
        return [parseComposeShortPort(portNode, sourceFile)];
      }

      if (isYamlObject(portNode)) {
        const target = yamlToString(portNode.target);
        if (!target) return [];
        return [{
          target,
          published: yamlToString(portNode.published),
          hostIp: yamlToString(portNode.host_ip),
          protocol: yamlToString(portNode.protocol) ?? 'tcp',
          mode: yamlToString(portNode.mode),
          raw: buildComposeLongSyntax(portNode),
          sourceFile,
        }];
      }

      return [];
    })
    .sort((a, b) => a.target.localeCompare(b.target));
}

function parseComposeShortPort(rawPort: string, sourceFile: string): RuntimePortBinding {
  const [basePort, protocol = 'tcp'] = rawPort.split('/');
  const parts = basePort!.split(':');

  if (parts.length === 1) {
    return {
      target: parts[0]!,
      protocol,
      raw: rawPort,
      sourceFile,
    };
  }

  if (parts.length === 2) {
    return {
      published: parts[0]!,
      target: parts[1]!,
      protocol,
      raw: rawPort,
      sourceFile,
    };
  }

  return {
    hostIp: parts[0],
    published: parts[1],
    target: parts[2] ?? '',
    protocol,
    raw: rawPort,
    sourceFile,
  };
}

function parseComposeVolumes(
  volumesNode: YamlValue | undefined,
  sourceFile: string,
): RuntimeVolumeMount[] {
  if (!volumesNode || !Array.isArray(volumesNode)) {
    return [];
  }

  return volumesNode
    .flatMap((volumeNode) => {
      if (typeof volumeNode === 'string') {
        return [parseComposeShortVolume(volumeNode, sourceFile)];
      }

      if (isYamlObject(volumeNode)) {
        const target = yamlToString(volumeNode.target);
        if (!target) return [];
        const source = yamlToString(volumeNode.source);
        return [{
          target,
          source,
          type: parseVolumeType(yamlToString(volumeNode.type), source),
          readOnly: yamlToBoolean(volumeNode.read_only) ?? yamlToBoolean(volumeNode.readonly) ?? false,
          raw: buildComposeLongSyntax(volumeNode),
          sourceFile,
        }];
      }

      return [];
    })
    .sort((a, b) => a.target.localeCompare(b.target));
}

function parseComposeShortVolume(rawVolume: string, sourceFile: string): RuntimeVolumeMount {
  const parts = rawVolume.split(':');

  if (parts.length === 1) {
    return {
      target: parts[0]!,
      type: 'volume',
      readOnly: false,
      raw: rawVolume,
      sourceFile,
    };
  }

  const source = parts[0]!;
  const target = parts[1] ?? '';
  const flags = parts.slice(2);

  return {
    source,
    target,
    type: parseVolumeType(undefined, source),
    readOnly: flags.includes('ro') || flags.includes('readonly'),
    raw: rawVolume,
    sourceFile,
  };
}

function parseVolumeType(rawType: string | undefined, source: string | undefined): RuntimeVolumeMount['type'] {
  if (rawType === 'bind' || rawType === 'volume' || rawType === 'tmpfs') {
    return rawType;
  }

  if (!source) {
    return 'volume';
  }

  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('~')) {
    return 'bind';
  }

  return 'volume';
}

function resolveComposePath(projectRoot: string, baseDir: string, rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(baseDir, rawPath);
}

function detectProjectName(projectRoot: string): string {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  try {
    if (fs.existsSync(packageJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        return parsed.name;
      }
    }
  } catch {
    // ignore and fallback to dirname
  }

  return path.basename(projectRoot);
}

function discoverComposeFiles(projectRoot: string, configFiles: Map<string, string>): string[] {
  const composePaths = new Set<string>();

  for (const [name, filePath] of configFiles) {
    if (COMPOSE_FILE_RE.test(name)) {
      composePaths.add(filePath);
    }
  }

  for (const entry of safeReadDir(projectRoot)) {
    if (entry.isFile() && COMPOSE_FILE_RE.test(entry.name)) {
      composePaths.add(path.join(projectRoot, entry.name));
    }
  }

  return [...composePaths].sort();
}

function discoverRootDockerfiles(projectRoot: string, configFiles: Map<string, string>): string[] {
  const dockerfiles = new Set<string>();

  for (const [name, filePath] of configFiles) {
    if (ROOT_DOCKERFILE_RE.test(name)) {
      dockerfiles.add(filePath);
    }
  }

  for (const entry of safeReadDir(projectRoot)) {
    if (entry.isFile() && ROOT_DOCKERFILE_RE.test(entry.name)) {
      dockerfiles.add(path.join(projectRoot, entry.name));
    }
  }

  return [...dockerfiles].sort();
}

function discoverRootEnvFiles(projectRoot: string): string[] {
  return safeReadDir(projectRoot)
    .filter((entry) => entry.isFile() && ENV_FILE_RE.test(entry.name))
    .map((entry) => path.join(projectRoot, entry.name))
    .sort();
}

function dedupeConfigHints(configHints: RuntimeConfigHint[]): RuntimeConfigHint[] {
  const seen = new Map<string, RuntimeConfigHint>();
  for (const hint of configHints) {
    seen.set(`${hint.sourceFile}:${hint.keyPath}:${hint.category}`, hint);
  }
  return [...seen.values()].sort(
    (a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.keyPath.localeCompare(b.keyPath),
  );
}

function collectSourceFiles(
  input: RuntimeTopologyInput,
  stagesByDockerfile: Map<string, ReturnType<typeof extractRuntimeBuildStages>>,
): string[] {
  const sourceFiles = new Set<string>();

  for (const composeFile of input.composeFiles) {
    sourceFiles.add(composeFile.filePath);
  }
  for (const envFile of input.envFiles) {
    sourceFiles.add(envFile.filePath);
  }
  for (const hint of input.configHints) {
    sourceFiles.add(hint.sourceFile);
  }
  for (const dockerfile of input.dockerfiles) {
    sourceFiles.add(dockerfile.relativePath);
  }
  for (const [dockerfilePath, stages] of stagesByDockerfile) {
    if (stages.length > 0) {
      sourceFiles.add(dockerfilePath);
    }
  }

  return [...sourceFiles].sort();
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function toProjectRelativePath(projectRoot: string, targetPath: string): string {
  const relativePath = path.relative(projectRoot, targetPath);
  return relativePath.split(path.sep).join('/');
}

function yamlToString(value: YamlValue | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function yamlToBoolean(value: YamlValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

function buildComposeLongSyntax(value: YamlObject): string {
  return Object.entries(value)
    .map(([key, item]) => `${key}=${yamlToString(item) ?? ''}`)
    .join(', ');
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function _isYamlArray(value: YamlValue | undefined): value is YamlArray {
  return Array.isArray(value);
}

// 导出测试辅助函数
export {
  discoverComposeFiles as _discoverComposeFiles,
  parseComposeFile as _parseComposeFile,
  parseComposeShortPort as _parseComposeShortPort,
  parseComposeShortVolume as _parseComposeShortVolume,
  dedupeConfigHints as _dedupeConfigHints,
  _isYamlArray,
};
