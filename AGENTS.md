# AGENTS.md

Guidance for AI coding agents working on this repo. Read this first.

## User instructions (always honor)

1. **Avoid over-commenting.** Default to no comments. Only add a comment when the *why* is non-obvious — a hidden constraint, a workaround, behavior that would surprise a reader. Don't restate what the code does. Don't reference tickets or prior fixes.
2. **Follow good naming conventions.** Identifiers should make comments unnecessary. TypeScript: `camelCase` for variables/functions, `PascalCase` for types/classes, `SCREAMING_SNAKE_CASE` for true constants. File names: `kebab-case.ts` (matches WXT's conventions). Be specific (`focusedPaneIndex`, not `idx`).
3. **Do not commit unless explicitly prompted.** Write code, run builds, update files freely — but no `git commit` without an explicit user ask. Same for `git tag`, `git push`.
4. **Update the plan after each task.** When you finish a checkbox in `plan/roadmap.md`, tick it. If a task changed scope, edit the plan to match. The plan is the source of truth for progress.
5. **Bump `package.json` `version` as you go.** Apply SemVer to every session's changes:
   - Bug fix or doc-only change → bump **patch** (`0.2.0` → `0.2.1`).
   - New feature or non-trivial behavior change without breaking existing UX → bump **minor** (`0.2.0` → `0.3.0`).
   - Breaking change to user-facing surface (settings shape, manifest permissions added, layout API change post-v1) → **stop and prompt the user** before bumping major.
   - Keep `package.json` `version` aligned with the matching milestone in `plan/roadmap.md` whenever possible. If you're working through a numbered milestone, the version should match that milestone.
6. **Verify before declaring a task done.** After non-trivial changes, run the relevant checks — at minimum: `pnpm compile` (type-check) and `pnpm build`. If lint/format/test scripts exist (`lint`, `format`, `test`), run them too. Report any failures and fix them; never mark a task complete with a red check.
7. **Use `pnpm`, not `npm` or `yarn`.** All install / script commands go through pnpm. Lockfile is `pnpm-lock.yaml`. The `packageManager` field in `package.json` pins the expected pnpm version. If you find a `package-lock.json` lying around, delete it.

## What this is

**Panes** is a Chrome extension (Manifest V3) that splits a single tab into 2 or 4 simultaneous web pages, similar to Chrome's native split view but with more panes. Each pane is an iframe inside a custom extension page; a single bottom control bar drives the focused pane.

The full design is in [`plan/design.md`](plan/design.md). The execution plan and progress tracker is in [`plan/roadmap.md`](plan/roadmap.md). **Both are gitignored** — they are internal planning docs, not for distribution.

## Stack

- **Language:** TypeScript (strict mode, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`)
- **Extension framework:** [WXT](https://wxt.dev/) — handles MV3 manifest generation, HMR, bundling
- **Bundler:** Vite (via WXT)
- **Package manager:** pnpm (pinned via `package.json` `packageManager` field)
- **Runtime:** Node `>=22.12.0` (pinned in `package.json`; rolldown's native binding requires it)

## Project layout

```
panes/
├── AGENTS.md                  ← you are here
├── README.md                  (TBD — write before v1.0.0)
├── package.json               scripts, deps, engine pin
├── tsconfig.json              strict TS, extends WXT's generated config
├── wxt.config.ts              extension manifest + WXT options
├── entrypoints/               WXT auto-discovers entrypoints by file name
│   └── background.ts          MV3 service worker
├── output/                    build artifacts (gitignored, NOT `.output/`)
├── .wxt/                      WXT-generated TS types (gitignored)
├── node_modules/              (gitignored)
└── plan/                      design docs + roadmap (gitignored)
    ├── design.md
    └── roadmap.md
```

Future entrypoints to expect (per the design):

- `entrypoints/split/` — the split-view page (HTML + TS) the toolbar opens
- `entrypoints/framebust-guard.content.ts` — content script for handling JS framebusting

## Commands

```bash
pnpm dev              # WXT dev mode (auto-reload Chrome on changes)
pnpm dev:firefox      # same, Firefox build
pnpm build            # production build → output/chrome-mv3/
pnpm build:firefox    # production build → output/firefox-mv2/
pnpm zip              # zipped extension for store submission
pnpm compile          # type-check only (tsc --noEmit), no emit
pnpm install          # install deps (uses pnpm-lock.yaml)
```

**Loading the extension during development:**
1. Build with `npm run build` (or run `npm run dev` for auto-reload).
2. `chrome://extensions/` → enable Developer mode → **Load unpacked** → pick `output/chrome-mv3/`.
3. The service worker console is reachable via the **"service worker"** link on the extension's card.

## Conventions

### Code style

- Strict TypeScript everywhere. No `any` unless interacting with untyped Chrome APIs (and even then, narrow it down quickly).
- Prefer `const` and pure functions. Mutable module-level state lives in clearly-named singletons.
- File names: `kebab-case.ts`. One default export per file when it's the file's main thing; named exports otherwise.
- DOM code: avoid frameworks until justified. The split page is small enough to be vanilla DOM. Reach for Preact/Svelte only if a real composition need emerges.

### Manifest changes

The manifest lives in `wxt.config.ts` under `defineConfig({ manifest: { ... } })`. Do not hand-write `manifest.json` — WXT generates it. `name` and `version` come from `package.json` unless overridden.

### Storage

- `chrome.storage.local` for last-used layout (v0).
- `chrome.storage.sync` is reserved for v2 named presets — don't use it earlier.
- Always go through a typed wrapper in `src/shared/storage.ts` (when it exists) rather than calling `chrome.storage.*` directly from feature code.

### MV3 service worker

Service workers die when idle. Anything stateful must round-trip through `chrome.storage` — do not assume module-level variables survive across events.

### DNR rules (frame-busting)

Any rule that strips `X-Frame-Options` / `frame-ancestors` MUST be **scoped to the extension's initiator** via `initiatorDomains`. Never apply globally — that would weaken users' security on every site they visit.

## What goes in `plan/` vs git

- `plan/` is **gitignored**. It is for the human + agent's working memory.
- Anything published — README, AGENTS.md, code, license — is committed.
- Don't add `plan/` content to commits. Don't reference plan filenames in commit messages or PR bodies.

## Tracking work

When you finish a roadmap checkbox:

1. Edit `plan/roadmap.md`, change `- [ ]` to `- [x]`.
2. If you discovered a new sub-task, add it under the same version with `- [ ]`.
3. If a task no longer applies, strike it through (`~~text~~`) with a one-line note on why.

Tag a release (`git tag -a vX.Y.Z`) only when the user explicitly asks. Never push without explicit ask.

## Out of scope (for now)

- Tests — none yet. v0 ships without an automated test suite. Set one up (Vitest) at v0.10.0 polish or sooner if a regression bites.
- CI — none yet. Add when there's a second contributor or v1 nears.
- Firefox parity — the manifest/code is structured to allow it (WXT supports both targets), but Firefox is not a v0 deliverable.

## When in doubt

- Re-read [`plan/design.md`](plan/design.md) for any UX decision question — most of them are already locked there.
- Re-read [`plan/roadmap.md`](plan/roadmap.md) before starting work to confirm what version you're on and what its scope is.
- If the design doc and the code disagree, the design doc is wrong (code reflects current reality). Update the doc.
- If the roadmap and the code disagree, the roadmap is wrong (or you forgot to tick a box). Update the roadmap.
