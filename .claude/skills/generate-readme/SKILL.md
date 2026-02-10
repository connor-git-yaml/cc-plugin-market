---
name: generate-readme
description: |
  Intelligently generates or updates a comprehensive README.md for the current project.
  Uses a 3-step agentic workflow:
  1. Analysis: Scans project structure, dependencies, and configuration.
  2. Planning: Determines sections based on project type and existing docs.
  3. Generation: Writes a professional, formatted README.md.
  Supports both first-time generation and incremental updates.
---

## User Input

```text
$ARGUMENTS

```

**Interpret `$ARGUMENTS` as follows:**

- **Empty**: Generate a full README with all applicable sections.
- **Contains "update" or "refresh"**: Update mode — preserve manually-written content, refresh auto-detectable sections (badges, tech stack, structure, commands).
- **Contains "minimal" or "short"**: Generate a compact README — Title, One-Liner, Install, Usage, License only.
- **Contains a specific focus** (e.g., "API", "deployment", "contributing"): Emphasize that section with extra detail.

## Context & Purpose

You are an expert Technical Writer and Developer Advocate. Your goal is to create a `README.md` that is:

1. **Scannable**: Uses badges, tables, and clear headings.
2. **Accurate**: Installation/Usage commands must match the actual code (check package.json, Makefile, etc.).
3. **Professional**: Follows industry standards (e.g., standard-readme, awesome-readme).

## Execution Flow

### Phase 1: Deep Project Analysis

Do not guess. Gather facts first.

1. **Detect Project Identity**:
   - List files in root to identify language/framework (e.g., `tsconfig.json` → TypeScript, `Cargo.toml` → Rust).
   - Read dependency files (`package.json`, `pyproject.toml`, `go.mod`) to extract:
     - Project Name & Version → *Used for Title and Version badge*
     - Key Frameworks (React, Torch, Next.js) → *Used for Tech badges*
     - Scripts/Commands (build, test, lint, start) → *Used for "Getting Started"*

2. **Analyze Entry Points**:
   - Look for `src/index`, `main.py`, `app.ts` to understand how the app starts.
   - Check `.github/workflows` or `Makefile` to see how CI builds/tests the project.

3. **Extract Badge Data** (concrete discovery, not placeholders):
   - **License**: Read `LICENSE` file name or `package.json` `"license"` field
   - **Version**: `package.json` `"version"`, `Cargo.toml` `[package].version`, or latest git tag
   - **Build Status**: Check `.github/workflows/*.yml` for CI workflow name → construct GitHub Actions badge URL
   - **Coverage**: Check for `codecov.yml`, `.coveralls.yml`, or coverage config in test framework

4. **Check Existing Documentation**:
   - Is there an old `README.md`? Read it to identify manually-written sections to preserve.
   - Check for `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/` → determines which sections to include.

5. **Detect Optional Sections**:
   - `.env.example` or env config exists → include **Configuration / Environment Variables** section
   - `docs/` directory or API route files exist → include **API Reference** or link to docs
   - `Dockerfile` or deployment config exists → include **Deployment** section
   - `CHANGELOG.md` exists → include **Changelog** link

### Phase 2: Structure Planning

Determine the final section list based on Phase 1 findings. Generate directly — do not pause to ask the user unless `$ARGUMENTS` contains "plan" or "review".

**Core Sections** (always included):

- **Title & Badges**: Project name + discovered badges (License, Version, Build, Language)
- **One-Liner Pitch**: What problem does this solve?
- **Features**: Key capabilities (extracted from code analysis)
- **Tech Stack**: List of major dependencies
- **Getting Started**: Prerequisites, Installation, Usage (with verified commands)
- **Project Structure**: Simplified tree view of key directories
- **License**: Extracted from LICENSE file

**Conditional Sections** (include only if detected in Phase 1):

- **Configuration**: If `.env.example` or config files found
- **API Reference**: If `docs/` or API routes found
- **Deployment**: If `Dockerfile` or deploy config found
- **Contributing**: If `CONTRIBUTING.md` found, link to it; otherwise basic steps
- **Changelog**: If `CHANGELOG.md` found, link to it

### Update Strategy (when README.md already exists)

If updating an existing README:

1. **Preserve**: Manually-written sections that don't match the template (e.g., "Background", "Why this project", "Architecture decisions"). Identify these by content that has no template equivalent.
2. **Refresh**: Badges, tech stack, project structure, install/usage commands — re-scan from source of truth.
3. **Merge features list**: Keep existing feature descriptions, append newly detected features.
4. **Never overwrite**: Custom prose sections, acknowledgements, or sections with `<!-- keep -->` markers.

### Phase 3: Generation

Generate the `README.md` using this structure.

**Crucial Rules**:

- **Badges**: Use `https://img.shields.io` with actual discovered values — never leave `[placeholder]` text.
- **Code Blocks**: Always specify language syntax (e.g., ` ```bash `).
- **Verify Commands**: Only document commands that actually exist in package.json / Makefile / pyproject.toml. Never invent commands.
- **Screenshots**: Only include if actual image files exist in the repo. Do not add broken placeholder images.
- **Headings**: Use clean text headings (no emoji) unless the user explicitly requests emoji style.

### Template Reference

```markdown
# [Project Name]

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![Build](https://img.shields.io/github/actions/workflow/status/[owner]/[repo]/ci.yml)

> [Short, punchy description of what the project does]

## Features

- **Feature A**: Description
- **Feature B**: Description

## Tech Stack

- **Core**: [Lang/Framework]
- **Utils**: [Key Libs]

## Getting Started

### Prerequisites

- [Requirement 1 with specific version]
- [Requirement 2]

### Installation

\`\`\`bash
[Actual install command discovered from analysis]
\`\`\`

### Usage

\`\`\`bash
[Actual run command discovered from analysis]
\`\`\`

## Configuration

> *Include only if .env.example or config files exist*

| Variable | Description | Default |
|----------|-------------|---------|
| `VAR_NAME` | What it does | `default_value` |

## Project Structure

\`\`\`text
[Generate a simplified tree view of key directories — max 2 levels deep]
\`\`\`

## API Reference

> *Include only if docs/ or API routes exist. Link to full docs if available.*

## Contributing

[Link to CONTRIBUTING.md or basic contribution steps]

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

This project is licensed under the [License Name] — see the [LICENSE](LICENSE) file for details.
```

## Final Verification

Before writing the file, **execute** these checks (do not just self-reflect):

1. **Command verification**: For every command in the README (install, build, test, run), verify it exists in `package.json` scripts, `Makefile` targets, or equivalent config file.
2. **Path verification**: For every file path referenced in "Project Structure", verify it exists via `ls` or Glob.
3. **Badge verification**: Confirm the LICENSE file exists if a License badge is included. Confirm `package.json` version matches the Version badge.
4. **Link verification**: Confirm any linked files (`CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`) actually exist.

If any check fails, fix the README content before writing. Then write the file.
