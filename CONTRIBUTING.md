# Contributing to coding-agent-a2a

Thank you for considering a contribution. This document covers everything you need to go from a fresh checkout to an open pull request.

---

## Table of contents

1. [Development setup](#1-development-setup)
2. [Running tests](#2-running-tests)
3. [Code standards](#3-code-standards)
4. [Adding a new adapter](#4-adding-a-new-adapter)
5. [Submitting a pull request](#5-submitting-a-pull-request)
6. [Versioning and releases](#6-versioning-and-releases)

---

## 1. Development setup

### Prerequisites

- **Node.js 20** or later (`node --version`)
- One or both CLI agents on your `PATH` (for integration / e2e tests):
  - `cursor-agent`
  - `claude`

### Clone and install

```bash
git clone https://github.com/casabre/coding-agent-a2a
cd coding-agent-a2a
npm install
```

### Build and run in watch mode

```bash
npm run build       # compile TypeScript once
npm run dev         # tsx watch — rebuilds on save, no need to restart
```

### Environment

```bash
cp .env.example .env
# Edit .env: set AGENT_ADAPTER and AGENT_REPO_PATH at minimum
```

The server starts with `npm start` (compiled build) or `npm run dev` (watch mode).

---

## 2. Running tests

### Unit and integration tests (no CLI required)

```bash
npm test                 # run once
npm run test:watch       # rerun on file change
npm run test:coverage    # run with coverage report (must reach 100%)
```

The test suite uses [Vitest](https://vitest.dev/). All external processes and I/O are mocked; no CLI agent is required.

### End-to-end tests (real CLI required)

```bash
CURSOR_E2E=1 npm run test:e2e
```

These tests spawn the actual CLI agent. Guard them behind `CURSOR_E2E=1` so they never run in CI (where the CLI is unavailable).

### Coverage requirement

CI enforces **100% line, branch, and function coverage** on all `src/` files (except `src/types.ts` and `src/adapters/base.ts`, which are type-only). Any pull request that reduces coverage below 100% will fail the CI gate.

When you add a new source file, add the corresponding tests before opening a PR.

---

## 3. Code standards

### TypeScript

- `strict: true` is enforced. Do not use `any` without explicit justification.
- Use `import type` for type-only imports to keep the compiled output clean.
- The project uses ES modules (`"type": "module"`). All local imports must include the `.js` extension.

### Linting

```bash
npm run lint        # ESLint 9 with @typescript-eslint/recommended
```

Lint and typecheck run in CI. A PR with errors in either will not be merged.

### File and function size

- Keep functions under 50 lines. Extract helpers when logic grows.
- Keep files focused on one responsibility. See [docs/architecture.md](docs/architecture.md) for module boundaries.

### Comments

Write comments to explain *why*, not *what*. Public interfaces and exported functions must have TSDoc (`/** */` blocks). Inline comments are for non-obvious invariants, workarounds, or constraints.

### No console.log in library code

Use `console.warn` or `console.error` only for operational messages (startup, warnings, genuine errors). Remove debug `console.log` calls before opening a PR.

---

## 4. Adding a new adapter

An adapter is a stateless class that implements `CodingAgentAdapter` from `src/adapters/base.ts`. It teaches the server how to invoke a specific CLI tool.

### Step 1 — Create the adapter file

```bash
touch src/adapters/my-agent.ts
```

```typescript
// src/adapters/my-agent.ts
import type { CodingAgentAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

export class MyAgentAdapter implements CodingAgentAdapter {
  readonly name = 'my-agent';

  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: false,
  };

  resolveBinary(): string {
    return process.env['MY_AGENT_PATH']?.trim() || 'my-agent';
  }

  buildArgv(options: RunOptions): string[] {
    const args = ['--stream-json'];
    if (options.model) args.push('--model', options.model);
    args.push(options.task);
    return args;
  }

  parseEvent(line: string): AgentEvent | null {
    // Re-use the shared parser if the CLI uses the same NDJSON schema,
    // or write a custom parser here.
    return parseSharedNdjsonEvent(line);
  }

  isApprovalPrompt(_line: string): boolean {
    return false;
  }

  approvalResponse(): string {
    return 'y';
  }
}
```

If your CLI uses a different NDJSON schema, implement `parseEvent` directly rather than delegating to `parseSharedNdjsonEvent`.

### Step 2 — Register the adapter

```typescript
// src/adapters/index.ts — add your adapter to the registry
import { MyAgentAdapter } from './my-agent.js';

const registry: Record<string, CodingAgentAdapter> = {
  cursor: new CursorAdapter(),
  'claude-code': new ClaudeCodeAdapter(),
  'my-agent': new MyAgentAdapter(),   // ← add this line
};
```

### Step 3 — Add tests

Create `tests/unit/adapters/my-agent.test.ts`. Aim for full coverage of:
- `resolveBinary` (default path and env override)
- `buildArgv` (all option combinations)
- `parseEvent` (valid events, unknown types, malformed JSON)
- `isApprovalPrompt` (if applicable)

Use the existing `tests/unit/adapters/cursor.test.ts` as a template.

### Step 4 — Update docs

- Add your adapter to the `AGENT_ADAPTER` row in [docs/deployment.md](docs/deployment.md).
- Add a row to the adapters table in [docs/development.md](docs/development.md).
- If the adapter has a custom env var for the binary path, add it to `.env.example` (commented out).

---

## 5. Submitting a pull request

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** following the standards above.

3. **Verify locally** before pushing:
   ```bash
   npm run lint && npm run typecheck && npm run test:coverage
   ```
   All three must pass with no errors and 100% coverage.

4. **Update docs** if you changed any user-facing behaviour, environment variables, MCP tools, or A2A responses.

5. **Update CHANGELOG.md** — add your changes under `## [Unreleased]`.

6. **Open a PR** against `main`. Fill in the PR template:
   - What changed and why
   - How to test it manually (if applicable)
   - Any breaking changes

7. CI will run lint, typecheck, and test:coverage automatically. A PR is only eligible to merge when all checks pass.

---

## 6. Versioning and releases

Versions follow [Semantic Versioning](https://semver.org/).
The version is **not stored in `package.json`** — it is derived from the git tag at publish time (analogous to Python's `setuptools-scm`).

To release:

```bash
# Update CHANGELOG.md: rename [Unreleased] → [x.y.z] — YYYY-MM-DD
git add CHANGELOG.md
git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push origin main --tags
```

Pushing the tag triggers the `publish` GitHub Actions workflow, which:
1. Runs the full CI gate.
2. Sets `package.json` version from the tag.
3. Builds and publishes to npm with provenance attestation.
