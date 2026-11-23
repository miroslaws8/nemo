# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/miroslaws8/nemo/security/advisories/new):
what is affected, how to reproduce it, and what an attacker could do with it.

You will get an answer within a week. Once a fix is out, the advisory is published with credit to
you, unless you would rather not be named.

## Supported versions

Only the latest commit of `main` gets security fixes.

## What is in scope

- The QA console (`console/`): sign-in and roles, the access of each route, the run files' own
  origin and its tickets, the separation of branch code from the console's settings and tokens
  (the runner users), the ingest tokens, the audit log.
- The engine (`engine/`): the cleanup guard (`engine/cleanup/guard.ts`), which must never delete
  data the tests did not create, and the handling of credentials and sessions.
- The CI scripts (`ci/`) and the Docker image (`Dockerfile`).

Reports, traces and `.auth/` hold session tokens of the QA accounts by design: they are
git-ignored and served only behind the console's access rules. Leaking them through the console
is in scope; finding them on your own disk is not.
