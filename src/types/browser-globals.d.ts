// Ambient browser globals for the web entrypoints (`src/web.ts`, `src/main.ts`).
//
// Typechecking targets Node (the `lib` array intentionally omits `DOM`, so the
// CLI build never pulls browser types), but a few modules feature-detect or use
// the browser worker globals — `typeof window`, `BrowserMessageReader(self)`,
// `window.addEventListener(...)`.
//
// Declared with `var` (NOT `let`/`const`) so they also become properties of
// `globalThis`; `tests/main.test.ts` assigns and deletes them via
// `global.window` / `global.self`, which requires the index signature only a
// global `var` provides. The eslint-disable is load-bearing: `no-var`'s autofix
// rewrites `var`→`let`, which silently drops the `globalThis` property and
// reintroduces the `tests/main.test.ts` type errors.
/* eslint-disable no-var */
declare var window: any;
declare var self: any;
/* eslint-enable no-var */

// This file will possibly be removed in the future along with entrypoints
// `src/web.ts` and `src/main.ts` since https://fish-lsp.dev/playground
// achieves its own separate web server
