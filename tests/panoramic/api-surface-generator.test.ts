/**
 * ApiSurfaceGenerator 单元测试
 * 覆盖 schema 优先级、FastAPI introspection、Express AST fallback、registry/render
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { ApiSurfaceGenerator } from '../../src/panoramic/api-surface-generator.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'api-surface-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createContext(
  projectRoot: string,
  overrides: Partial<ProjectContext> = {},
): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
    ...overrides,
  };
}

describe('ApiSurfaceGenerator - schema 优先级与 ingest', () => {
  let tmpDir: string;
  let generator: ApiSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ApiSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('已有 openapi.json 时优先使用 schema，并提取参数/响应/认证/标签', async () => {
    writeFile(
      path.join(tmpDir, 'openapi.json'),
      JSON.stringify({
        openapi: '3.0.0',
        security: [{ bearerAuth: [] }],
        paths: {
          '/api/users/{userId}': {
            parameters: [
              {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            get: {
              tags: ['users'],
              parameters: [
                {
                  name: 'verbose',
                  in: 'query',
                  required: false,
                  schema: { type: 'boolean' },
                },
              ],
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
                '404': {
                  description: 'not found',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/ErrorResponse' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            User: { type: 'object' },
            ErrorResponse: { type: 'object' },
          },
        },
      }, null, 2),
    );

    writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      `
        import express from 'express';
        const app = express();
        app.get('/shadow', handler);
        export default app;
      `,
    );

    const context = createContext(tmpDir);
    await expect(generator.isApplicable(context)).resolves.toBe(true);

    const input = await generator.extract(context);
    expect(input.source).toBe('schema');
    expect(input.endpoints).toHaveLength(1);

    const endpoint = input.endpoints[0]!;
    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/api/users/{userId}');
    expect(endpoint.source).toBe('schema');
    expect(endpoint.tags).toEqual(['users']);
    expect(endpoint.auth).toEqual(['bearerAuth']);
    expect(endpoint.parameters.map((item) => `${item.in}:${item.name}:${item.type}`)).toEqual([
      'path:userId:string',
      'query:verbose:boolean',
    ]);
    expect(endpoint.responseType).toBe('200: User | 404: ErrorResponse');

    const output = await generator.generate(input);
    const markdown = generator.render(output);
    expect(markdown).toContain('# API Surface Reference');
    expect(markdown).toContain('openapi.json');
    expect(markdown).toContain('/api/users/{userId}');
  });
});

describe('ApiSurfaceGenerator - FastAPI introspection', () => {
  let tmpDir: string;
  let generator: ApiSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ApiSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('无 schema 时静态解析 FastAPI 路由、prefix、参数和认证提示', async () => {
    writeFile(
      path.join(tmpDir, 'app.py'),
      `
from fastapi import FastAPI, APIRouter, Depends, Query

app = FastAPI()
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_auth)])

@router.get("/{user_id}", response_model=UserOut, summary="Get user")
async def get_user(user_id: int, verbose: bool = Query(False)) -> UserOut:
    return UserOut()

app.include_router(router, prefix="/api", tags=["v1"])
      `.trim(),
    );

    const input = await generator.extract(createContext(tmpDir));
    expect(input.source).toBe('introspection');
    expect(input.endpoints).toHaveLength(1);

    const endpoint = input.endpoints[0]!;
    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/api/users/{user_id}');
    expect(endpoint.source).toBe('introspection');
    expect(endpoint.auth).toEqual(['require_auth']);
    expect(endpoint.tags).toEqual(['users', 'v1']);
    expect(endpoint.responseType).toBe('200: UserOut');
    expect(endpoint.parameters.map((item) => `${item.in}:${item.name}:${item.type}`)).toEqual([
      'path:user_id:int',
      'query:verbose:bool',
    ]);
  });
});

describe('ApiSurfaceGenerator - Express AST fallback', () => {
  let tmpDir: string;
  let generator: ApiSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ApiSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('无 schema / introspection 时回退到 Express AST，覆盖 10+ 路由', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      `
import express from 'express';
import usersRouter from './routes/users';
import reportsRouter from './routes/reports';

const app = express();
app.get('/health', healthHandler);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/reports', reportsRouter);

export default app;
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'routes', 'users.ts'),
      `
import express from 'express';
import adminRouter from './users-admin';

const router = express.Router();
router.get('/', listUsers);
router.post('/', createUser);
router.get('/:userId', getUser);
router.put('/:userId', updateUser);
router.delete('/:userId', deleteUser);
router.route('/:userId/preferences').get(getPreferences).patch(updatePreferences);
router.use('/admin', adminRouter);

export default router;
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'routes', 'users-admin.ts'),
      `
import { Router } from 'express';

const router = Router();
router.get('/stats', getStats);
router.post('/invite', inviteAdmin);
router.delete('/invite/:inviteId', revokeInvite);

export default router;
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'routes', 'reports.ts'),
      `
import express from 'express';

const router = express.Router();
router.get('/', listReports);
router.get('/:reportId', getReport);
router.post('/:reportId/publish', publishReport);
router.patch('/:reportId/archive', archiveReport);

export default router;
      `.trim(),
    );

    const input = await generator.extract(createContext(tmpDir));
    expect(input.source).toBe('ast');
    expect(input.endpoints).toHaveLength(15);

    const routePairs = input.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(routePairs).toContain('GET /health');
    expect(routePairs).toContain('GET /api/users');
    expect(routePairs).toContain('POST /api/users');
    expect(routePairs).toContain('GET /api/users/:userId');
    expect(routePairs).toContain('PUT /api/users/:userId');
    expect(routePairs).toContain('DELETE /api/users/:userId');
    expect(routePairs).toContain('GET /api/users/:userId/preferences');
    expect(routePairs).toContain('PATCH /api/users/:userId/preferences');
    expect(routePairs).toContain('GET /api/users/admin/stats');
    expect(routePairs).toContain('POST /api/users/admin/invite');
    expect(routePairs).toContain('DELETE /api/users/admin/invite/:inviteId');
    expect(routePairs).toContain('GET /api/reports');
    expect(routePairs).toContain('GET /api/reports/:reportId');
    expect(routePairs).toContain('POST /api/reports/:reportId/publish');
    expect(routePairs).toContain('PATCH /api/reports/:reportId/archive');

    const securedEndpoint = input.endpoints.find((endpoint) => endpoint.path === '/api/users');
    expect(securedEndpoint?.auth).toEqual(['requireAuth']);

    const parameterizedEndpoint = input.endpoints.find((endpoint) => endpoint.path === '/api/users/:userId');
    expect(parameterizedEndpoint?.parameters.map((item) => `${item.in}:${item.name}`)).toEqual([
      'path:userId',
    ]);
    expect(parameterizedEndpoint?.responseType).toBe('200: unknown');
  });
});

describe('ApiSurfaceGenerator - registry 集成', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators 后可通过 api-surface id 查询', () => {
    bootstrapGenerators();
    const generator = GeneratorRegistry.getInstance().get('api-surface');
    expect(generator).toBeDefined();
    expect(generator!.id).toBe('api-surface');
  });
});
