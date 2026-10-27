# Security

English | [简体中文](SECURITY.zh-CN.md)

## Reporting Vulnerabilities

Please do not paste exploit details, secrets, user data, or production URLs into public issues.
Report privately through GitHub Security Advisories, or contact the maintainers.

## Notes for Deployers

- Do not commit `.dev.vars`, `.env*`, `wrangler.site.jsonc`, backups, or D1 exports.
- Generate `BETTER_AUTH_SECRET`, `PASSWORD_PEPPER`, and `IP_HASH_SALT` using independent random values.
- Rotate Resend/Turnstile/R2 secrets regularly; before rotating `BETTER_AUTH_SECRET`, migrate the encrypted integration secrets first.
- Enable GitHub secret scanning / push protection.
- Production D1/R2 must be accessible only to deployers and least-privilege tokens.
