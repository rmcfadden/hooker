# JavaScript → strict TypeScript migration

Migrate the backend (`lib/`, `bin/`, `__tests__/` — ~2000 LOC of `.mjs`) to strict TypeScript.
The `web/` app is already strict TS and is out of scope.

## Decisions

- **Ship:** source stays in `lib/`/`bin/` as `.ts`; `tsc` emits parallel JS to `dist/`, which is what
  npm publishes. Keeping source in place (rather than moving to `src/`) avoids churning `paths.mjs`,
  which derives `profileHome` relative to the lib dir and expects `hooks/` as a sibling.
- **Run tests:** directly via Node's native type-stripping (`node --test` on `*.test.ts`, Node ≥22.18 /
  23+; we're on 26). No build needed for the test loop — `npm test` and `npm run coverage` are unchanged.
  `tsc` emit is only for publishing.
- **Cadence:** incremental. `allowJs` keeps `.mjs` compiling while modules convert one at a time; the
  test suite (98% coverage) stays green after every step.
- **Strictness:** `strict` + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`.

## Layout

```
lib/*.ts, bin/hooker.ts   source (also runnable directly via Node type-stripping)
lib/types.ts              shared domain types
__tests__/*.test.ts
dist/{lib,bin,hooks}/     tsc output + copied hooks; gitignored, published
hooks/*.sh                unchanged (not compiled)
tsconfig.json             type-check config (noEmit, allowJs)
tsconfig.build.json       emit config (dist/, declarations, sourcemaps)
```

On completion: `package.json` → `bin: dist/bin/hooker.js`, `files: ["dist","hooks","README.md"]`,
and `prepublishOnly: npm run build`.

## Module dependency graph (conversion order)

Leaves (no internal deps) → convert first:
`tiers, clock, args, ansi, paths, json-file, report-html, db, aggregate`

Mid-tier (depend only on the above):
`categories→tiers`, `command-label→tiers`, `mock→tiers`, `record→command-label`,
`install-git→paths`, `install-cursor→{json-file,paths}`, `install→{install-git,json-file,paths}`,
`github→{clock,record}`, `serve→{aggregate,clock,db,paths}`

Entry point (depends on nearly everything): `bin/hooker`.

## Phases (each = one PR, suite green throughout)

- **Phase 0 — Tooling (done).** Add `typescript` + `@types/node`, `tsconfig.json` /
  `tsconfig.build.json`, `typecheck` + `build` scripts, gitignore `dist/`. Proven against the
  existing `.mjs`: typecheck, build, all 115 tests, and the compiled CLI all pass.
- **Phase 1 — Shared types + leaves.** Author `lib/types.ts`; convert the dependency-free leaves.
- **Phase 2 — Mid-tier.** Convert the modules above in dependency order.
- **Phase 3 — Entry point.** Convert `bin/hooker.ts` (keep the `#!/usr/bin/env node` shebang; the
  existing `setWriter`/`main` seams carry over).
- **Phase 4 — Tests + tighten.** Convert `__tests__/*.mjs` → `.ts`, turn **off** `allowJs`, point
  `bin`/`files` at `dist/`, add `prepublishOnly`, and wire `typecheck` into CI.

## Shared types to define (`lib/types.ts`)

`Tier`, `Status`, `EventRecord` (start/end/tier/hook/command + optional subcommand/status/sourceKey),
`MarkerEvent` (phase/corr/key/ts/…), `Flags` / `ParsedArgs`, `Report` / `ReportGroup` / `Totals`,
and DB row types.

## Known gotchas (scoped)

1. **Import extensions.** Write `./db.ts` in source; `rewriteRelativeImportExtensions` (TS 5.7+)
   rewrites to `.js` in `dist/`. Same file runs under Node strip *and* compiles cleanly.
2. **`node:sqlite` rows are `unknown`.** With `noUncheckedIndexedAccess`, `.get()`/`.all()` need typed
   wrappers — add small generic query helpers in `db.ts` so callers get real row types.
3. **`hooks/` + `profileHome`.** Build copies `hooks/` → `dist/hooks/` so the published `profileHome`
   (= `dist/`) resolves recorders; dev mode (running `lib/` source) resolves the repo-root `hooks/`.
4. **`exactOptionalPropertyTypes`.** Forces a deliberate choice on the event shape's optional fields
   (`subcommand?: string` vs `string | null`) given the pervasive `?? null`.
5. **Executable bit.** `tsc` won't set `+x` on `dist/bin/hooker.js`; `prepublishOnly` will `chmod`.
6. **`verbatimModuleSyntax`.** Type-only imports must use `import type`.

## Config (installed in Phase 0)

See `tsconfig.json` (type-check, `allowJs`, `noEmit`) and `tsconfig.build.json` (emit to `dist/`).
