import path from 'node:path';
import process from 'node:process';

export function parseCommonProjectArgs(argv, defaults = {}) {
  const args = {
    projectRoot: defaults.projectRoot ?? process.cwd(),
    json: Boolean(defaults.json),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--project-root') {
      args.projectRoot = argv[index + 1] ?? args.projectRoot;
      index += 1;
    }
  }

  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}
