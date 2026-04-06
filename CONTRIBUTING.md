# Contributing to CC Plugin Market

Thank you for considering contributing to CC Plugin Market! This repository ships two complementary products — **reverse-spec** (code-to-spec) and **Spec Driver** (spec-to-code orchestration).

## Development Setup

1. Clone the repository:

```bash
git clone git@github.com:connor-git-yaml/cc-plugin-market.git
cd cc-plugin-market
```

2. Install dependencies:

```bash
npm install
```

3. Build:

```bash
npm run build
```

4. Run tests:

```bash
npm test
```

## Repository Structure

```
cc-plugin-market/
├── src/                      # reverse-spec core (TypeScript)
├── plugins/
│   ├── spec-driver/          # Spec Driver plugin (Skills + Agents)
│   └── reverse-spec/         # reverse-spec plugin (Skills)
├── specs/                    # Feature specs and product docs
├── scripts/                  # Repo-level sync/check scripts
└── .specify/                 # Project context and memory
```

## Code Style

- This project uses TypeScript with strict mode (`tsc --noEmit` for linting)
- Run `npm run lint` to check for type errors
- Run `npm test` to execute the Vitest test suite
- Plugin scripts use ESM (`.mjs`) format

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(093): add refactor mode`
- `fix(089): resolve inline array compatibility`
- `docs(088): update README for M-088 milestone`

## Pull Request Process

1. Fork the repository and create your branch from `master`.
2. If you've added code, add tests.
3. Ensure the test suite passes: `npm test`.
4. Ensure types check: `npm run lint`.
5. Run repo checks: `npm run repo:check`.
6. Submit your pull request.

## Plugin Development

When modifying plugins:

1. Follow the plugin structure convention: `plugins/<name>/skills/<skill>/SKILL.md`
2. After changes, run sync and check:
   ```bash
   npm run repo:sync
   npm run repo:check
   ```
3. Bash scripts must use `set -euo pipefail` and maintain executable permissions (755)
4. Version changes follow SemVer (canonical source: `contracts/release-contract.yaml`)

## Spec-Driven Development

This project uses its own Spec Driver for development. Feature implementation follows:

1. Create a spec: `specs/NNN-feature-name/spec.md`
2. Generate plan and tasks
3. Implement according to tasks
4. Verify and close

## Reporting Issues

Use GitHub Issues to report bugs. Include:
- A clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version)

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.
