# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).
- **Zero-Token follows cc-haha.** Do not invent patches in `dsh-plugin-desktop/vendor/copaw-zero-token/` or DSH-only webauth/CDP behavior. When DSH Zero-Token breaks, copy the working path from `D:\cc-haha` (`vendor/copaw-zero-token`, `src/server/services/zeroToken*.ts`, `desktop/sidecars/*webauth*`). cc-haha defaults to **webauth-ts** (Node), not Python Playwright.
