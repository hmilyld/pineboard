# Documentation index

English | [简体中文](zh-CN/README.md)

This directory holds all of Pineboard's design, implementation and operations documentation. If you are picking the project up for the first time, read [../AGENTS.md](../AGENTS.md) in the repository root first, then follow the paths below.

Current version: `0.2.3`

## Recommended reading paths

### New contributors / agents

1. [../AGENTS.md](../AGENTS.md): design direction, technical constraints, code and release conventions
2. This documentation index
3. [01 Architecture](01-architecture.md)
4. [02 Data, API and configuration](02-data-api-config.md)
5. [03 Authentication, permissions and email](03-auth-permissions-email.md)
6. [04 Content, Turnstile, search and upload](04-content-turnstile-search-upload.md)
7. [07 Visual and typography spec](07-design-spec.md)
8. [08 Configuration reference](08-configuration.md)

### Deployment / operations

1. [09 Deployment guide](09-deployment.md)
2. [08 Configuration reference](08-configuration.md)
3. [01 Architecture](01-architecture.md)
4. [06 Roadmap, risks and operations](06-roadmap-risks.md)

### Only changing the UI

1. [07 Visual and typography spec](07-design-spec.md)
2. [05 Front end, theming and operations](05-frontend-theming-ops.md)
3. [screenshots/](screenshots/) interface screenshots

### Only integrating with the API

1. [02 Data, API and configuration](02-data-api-config.md)
2. [03 Authentication, permissions and email](03-auth-permissions-email.md)
3. The Zod contracts in `packages/shared/`

## Document list

| Document | Contents | Authority |
|---|---|---|
| [../AGENTS.md](../AGENTS.md) | Agent workflow, design direction, technical constraints, release conventions | Single entry point for development conventions |
| [01-architecture.md](01-architecture.md) | Single Worker deployment, request path, directories, bindings, cache | Architectural facts |
| [02-data-api-config.md](02-data-api-config.md) | Tables, indexes, API, error codes, configuration options | Data/API contract |
| [03-auth-permissions-email.md](03-auth-permissions-email.md) | Sign-in, permission matrix, edit history, notifications and email | Authentication/permissions facts |
| [04-content-turnstile-search-upload.md](04-content-turnstile-search-upload.md) | Turnstile, FTS5, uploads and security | Content pipeline facts |
| [05-frontend-theming-ops.md](05-frontend-theming-ops.md) | Front-end routes, theming, PWA/SEO, historical operations notes | Front-end/operations supplement |
| [06-roadmap-risks.md](06-roadmap-risks.md) | Phase records, spikes, risks, tests and to-dos | History/risk records |
| [07-design-spec.md](07-design-spec.md) | Tokens, widths, page specs, responsive, interactions | Single source of truth for visuals |
| [08-configuration.md](08-configuration.md) | CF variables/secrets, D1 settings, precedence, tag releases | Single configuration checklist |
| [09-deployment.md](09-deployment.md) | Complete deployment, initialization, backup, rollback for open-source reuse | Single entry point for deployment |
| [screenshots/](screenshots/) | Interface screenshots | Reference, not production code |

## Find a document by question

| I want to… | See |
|---|---|
| Run it locally | [README quick start](../README.md) + [09 Deployment guide](09-deployment.md) |
| Replace deployment config in one step | `pnpm run setup`, see [09 Deployment guide](09-deployment.md) |
| Create Cloudflare resources and deploy | [09 Deployment guide](09-deployment.md) |
| Know which variables are required | [08 Configuration reference](08-configuration.md) |
| Know what can be changed in the admin | [08 Configuration reference](08-configuration.md) + [09 Deployment guide](09-deployment.md) |
| Change page width/colors/spacing | [07 Visual spec](07-design-spec.md) |
| Add an API / change a table | [02 Data and API](02-data-api-config.md) |
| Change sign-in/permissions/email | [03 Authentication and permissions](03-auth-permissions-email.md) |
| Change Turnstile/search/upload | [04 Content pipeline](04-content-turnstile-search-upload.md) |
| Look up past decisions/risks | [06 Roadmap and risks](06-roadmap-risks.md) |
| Release a version | [../AGENTS.md](../AGENTS.md) + [09 Deployment guide](09-deployment.md) |

## Documentation conventions

- Architecture, API, permissions, configuration and deployment are governed by `01`–`09` respectively; outdated descriptions in older documents should be corrected rather than supplemented with a "second set of facts".
- Design values come only from `07`; configuration options come only from `08`; open-source deployment comes only from `09`.
- Code and documentation must land in the same commit; a new document must be registered on this page.
- English is the default documentation language; Simplified Chinese translations live in `zh-CN/` (root-level files use `*.zh-CN.md`). Keep both versions in sync.
- `README.md` only keeps the system overview; conventions and design must not be written back into the README.
