/**
 * F251：dist/ 的构建职责已收拢到 vitest globalSetup（tests/global-setup.ts），
 * 测试执行期任何测试文件都不应再触发 `npm run build`——并发写同一份 dist 会让
 * spawn 的 dist CLI 子进程读到半写产物（F251 根因）。本函数只做 fail-fast
 * 存在性断言：dist 缺失说明 globalSetup 未执行/被绕过，此时应提示排查配置，
 * 而不是在测试进程内静默补建（那样又会重新引入竞写面）。
 *
 * 内部对抗复审后修订（I1+I2）：
 * - 路径锚定从 `resolve(process.cwd())` 改为 `import.meta.url` 推导仓库根，与
 *   `tests/global-setup.ts` 同构——`process.cwd()` 在被非仓库根目录 spawn 的场景下
 *   不可靠，而 `import.meta.url` 始终指向本文件的物理位置，与调用方 cwd 无关。
 * - 断言同时检查 `dist/cli/index.js` 与 `dist/.spectra-build-meta.json`
 *   （`BUILD_META_NAME`，与 `tests/global-setup.ts` 共用同一常量来源）：只有入口文件
 *   而没有 build-meta，说明上一次构建被中断（tsc 已 emit 入口文件但 postbuild 未跑完），
 *   同样不能信任这份 dist。
 *
 * 内部对抗复审后修订（W2，delta 复审）：`assertDistBuilt()` 开头新增
 * `SPECTRA_TEST_SKIP_DIST_BUILD` 自检——该环境变量的契约（见 tests/global-setup.ts）
 * 是"本次 vitest 运行完全不消费 dist/，globalSetup 跳过构建判定"。但凡有测试文件在
 * `beforeAll` 里调用了 `assertDistBuilt()`，这个调用本身就是在声明"我是 dist 的消费方，
 * 需要它已被构建"——与开关的契约直接矛盾（零误报论证：真正不消费 dist 的测试文件，
 * 从来不会走到这个调用点，所以这条检查不会误伤任何合法用法）。此处直接 throw 提示
 * 两者矛盾，而不是静默放行——静默放行等于在没有 dist 保证的情况下让消费 dist 的测试
 * 继续跑，会重新引入"读到不存在/陈旧 dist"的原始问题。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
// @ts-expect-error — .mjs 无类型声明，运行时可解析（沿用 tests/global-setup.ts 既有约定）
import { BUILD_META_NAME } from '../../scripts/lib/spectra-version-gate.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const BUILD_META = join(PROJECT_ROOT, 'dist', BUILD_META_NAME as string);

// 与 tests/global-setup.ts 使用同一字面量（两文件各自独立持有常量值，本文件不反向
// import global-setup.ts 以避免测试基础设施内部循环耦合）。
const SKIP_ENV_VAR = 'SPECTRA_TEST_SKIP_DIST_BUILD';

export function assertDistBuilt(): void {
  if (process.env[SKIP_ENV_VAR] === '1') {
    throw new Error(
      [
        `${SKIP_ENV_VAR}=1 与当前调用矛盾。`,
        `该开关的契约是"本次 vitest 运行完全不消费 dist/"（见 tests/global-setup.ts），`,
        `但当前测试文件调用了 assertDistBuilt()——调用这个函数本身就是在声明"我是 dist`,
        `的消费方，需要它已被构建"，这与开关的契约互相矛盾。`,
        `请去掉 ${SKIP_ENV_VAR} 环境变量后重跑，或确认这个测试文件是否真的不需要 dist。`,
      ].join('\n'),
    );
  }

  const distMissing = !existsSync(DIST_CLI);
  const metaMissing = !existsSync(BUILD_META);
  if (!distMissing && !metaMissing) return;

  throw new Error(
    [
      distMissing
        ? 'dist/cli/index.js 不存在。'
        : `dist/${BUILD_META_NAME as string} 不存在——dist/cli/index.js 存在但构建不完整/被中断` +
          '（tsc 可能已 emit 入口文件，但 postbuild 盖章步骤未跑完）。',
      'dist 构建已收拢到 vitest globalSetup（tests/global-setup.ts），应在测试执行前自动完成。请检查：',
      '  1. 是否绕过了 vitest 的 globalSetup 机制运行测试（如直接用 node --test）；',
      '  2. vitest.config.ts 根级 test.globalSetup 是否被覆盖/移除；',
      '  3. globalSetup 是否因 npm run build 失败而提前退出（查看本次运行开头的 [global-setup] 日志）。',
      '临时手动修复：npm run build',
    ].join('\n'),
  );
}
