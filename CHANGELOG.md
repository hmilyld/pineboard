# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.10] - 2026-11-21

### Added

- Prettier, ESLint and EditorConfig baseline with `pnpm lint` / `pnpm format:check`.
- CI now runs lint, formatting, coverage, `test:p6:build` and the full e2e suite.
- Dependabot (monthly, grouped), a production audit step and a license allowlist check.
- Shared helpers for the e2e scripts (`scripts/e2e-lib.mjs`).

### Changed

- Node baseline is 24 LTS (`.nvmrc`, `engines`, CI workflows).
- `hono` updated to 4.13.19 to pick up upstream security fixes.
- `e2e-p4` now asserts the opt-in email defaults and the explicit opt-in path.
- Dependencies: `better-auth` 1.7.25, `vue` 3.5.45, `vue-router` 5.5.1, `dompurify` 3.4.18.
- Toolchain: `vite` 8.3.8, `vitest` 5.1.1, `wrangler` 4.164.0, `@cloudflare/vite-plugin` 1.70.0, `tailwindcss` 4.3.5.
- CI actions: `actions/checkout` v7, `actions/setup-node` v7, `pnpm/action-setup` v6.

## [0.2.9] - 2026-11-17

### Fixed

- Restored the header search form.

## [0.2.8] - 2026-11-17

### Added

- Keyboard-accessible, scrollable code blocks.
- Error announcements, focus routing on auth failure and a search landmark.

### Changed

- Modals use the native `<dialog>`; the mobile drawer makes the background inert.
- Text scales with relative units and follows OS text sizing and color-scheme changes.
- Small controls meet the 24px minimum target size.
- Fixed `text-` class hyphens and restored focus after closing a dropdown.

## [0.2.7] - 2026-10-29

### Added

- Turnstile gate for edits and a keyword review queue.

### Fixed

- White text on orange CTAs in dark mode.
- Board description uses the full row on phones.
