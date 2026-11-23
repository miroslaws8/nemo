# QA console on Kubernetes

Everything a server console needs, in order: keys, settings and steps. `qa-console.yaml` here is
a reference manifest, checked on a cluster (k3s) with the image from this repo; adapt the host
names, namespace, ingress class and registry to your cluster.

## What it is

One pod: the console (`<registry>/qa-console:<tag>`, built from the `Dockerfile` at the repo
root). People sign in with their account of the app under test (its OAuth 2 IdP); runs test
commits of this repository fetched from git and run in the pod (Playwright and Chromium are in
the image), as users of their own through sudo (`qa-runner`, `qa-runner-guarded` for guarded
environments such as prod). The image also holds Hermes Agent, the LLM agent of the agent checks
(about 6 GB in all). Run files (reports, traces, screenshots) are served at a second host name
(`qa-files.example.com` below). All state is on one volume at `/data`; optionally the skills live
in an S3 bucket every console shares (docs/guide.md → QA Console → Skill store).

## The minimum to start

One run at a time (`QA_CONSOLE_MAX_ACTIVE_RUNS: "1"`), which is what the reference sets:

| What | The minimum | Why |
|---|---|---|
| Node | **4 vCPU, 8 GB RAM**, x86-64; or that much room on a node the cluster has already | the pod asks for 2 CPU / 4 GiB and may use up to 4 CPU / 8 GiB; an agent check peaked at 2.5 GB, the console's own 0.2 GB included |
| Node disk | **15 GB free** | the image is about 6 GB; `/tmp` may take up to 4 GiB |
| Volume | **20 GiB** block storage, `ReadWriteOnce` | runs, reports, agent homes; skills when there is no skill store |
| Architecture | x86-64 (amd64) | the image is built for amd64 |
| Replicas | **one**, no autoscaling | two consoles would share the QA accounts and the volume |

Two runs at a time (`"2"`): add 3 GiB to the memory request and the limit, so a node of 4 vCPU,
16 GB RAM; see [Sizing](#sizing).

## 1. Before you start: what to make, and where it goes

### 1.1 The git host

The console clones the tests from `QA_CONSOLE_GIT_URL`. For a private repository over https, a
token that may read it goes into `QA_CONSOLE_GIT_TOKEN`.

The CI tab reads Bitbucket Pipelines (`console/server/sources/`): a **repository access token**
with **Pipelines: Read** and **Write** → `QA_CONSOLE_BITBUCKET_TOKEN`, and the repository as
`<workspace>/<repository>` → `QA_CONSOLE_BITBUCKET_REPOSITORY`. Without them the console works
and its CI tab says CI is not set up.

**Repository variables** for `bitbucket-pipelines.yml` (Repository settings → Pipelines →
Repository variables):

| Variable | Value | Secured |
|---|---|---|
| `QA_CONSOLE_INGEST_URL` | `https://qa.example.com` | no |
| `QA_CONSOLE_INGEST_TOKEN` | a random token of 24+ characters (`openssl rand -hex 32`); the same goes into the Secret's `QA_CONSOLE_INGEST_TOKENS` | yes |
| `QA_STAGE_EMAIL`, `QA_STAGE_PASSWORD`, `QA_PROD_EMAIL`, `QA_PROD_PASSWORD` | the QA accounts the tests sign in with | yes |
| `SLACK_WEBHOOK_URL` | where the tests' CI reports failures (optional) | yes |

### 1.2 The OAuth client

People sign in through the app's IdP: an OAuth 2 authorization server that takes public clients
with PKCE (`console/server/auth/oauth.ts`). Register a public client with the redirect
`https://qa.example.com/auth/callback`; its id goes into `QA_CONSOLE_OAUTH_CLIENT_ID` (2.2). With
Laravel Passport, for example:

```bash
php artisan passport:client --public --name="QA Console" \
  --redirect_uri=https://qa.example.com/auth/callback --no-interaction
```

The role comes from the email, so whoever may create an account with a verified email on that
IdP may become anyone of `users.yaml`, an operator with prod included. Use an IdP whose accounts
you control.

### 1.3 The models' keys (agent checks)

- **OpenAI**: a key of an OpenAI project of its own, with a monthly budget on that project →
  `QA_CONSOLE_OPENAI_API_KEY`.
- **Anthropic**: a key of a workspace of its own in the Claude Console (the Default Workspace
  cannot have a spend limit), with a monthly limit → `QA_CONSOLE_ANTHROPIC_API_KEY`.

With neither key the console runs no agent checks. Besides the providers' limits, the console
stops checks for the rest of the day (UTC) once they spent `QA_CONSOLE_AGENT_DAILY_USD` (default
`5`, at list prices, both providers together).

### 1.4 The skill store (optional)

1. **The bucket** — on AWS S3 or any S3-compatible store (DigitalOcean Spaces, MinIO, …): a
   private bucket such as `nemo-skills` (it goes into `QA_CONSOLE_SKILLS_BUCKET`), and its
   endpoint into `QA_CONSOLE_SKILLS_ENDPOINT` (default `https://s3.amazonaws.com`).
2. **Versioning** on, so that an object changed by hand can be got back (the console itself never
   rewrites a version):
   ```bash
   aws s3api put-bucket-versioning --bucket nemo-skills \
     --versioning-configuration Status=Enabled \
     --endpoint-url <endpoint>
   ```
3. **Two keys** that may read and write, each limited to this bucket where the store allows it:
   - one for the pod: `QA_CONSOLE_SKILLS_ACCESS_KEY_ID` and `QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY`
     in the Secret (step 4, not before);
   - one for the developers' `.env` (their consoles add, promote and delete skills too): one of its
     own, so it can be replaced without touching the pod's.

### 1.5 DNS and TLS

`qa.example.com` and `qa-files.example.com` → the cluster's ingress, with a certificate for both
(`qa-console-tls` in the reference).

## 2. The Kubernetes objects (`qa-console.yaml`)

### 2.1 The volume

PersistentVolumeClaim `qa-console-data`: `ReadWriteOnce`, 20Gi, mounted at `/data`.

### 2.2 ConfigMap `qa-console-settings`

```yaml
QA_CONSOLE_PORT: "7357"
QA_CONSOLE_PUBLIC_URL: https://qa.example.com
QA_CONSOLE_FILES_URL: https://qa-files.example.com
QA_CONSOLE_IDP_URL: https://auth.staging.example.com
QA_CONSOLE_IDP_API_URL: https://api.staging.example.com
QA_CONSOLE_OAUTH_CLIENT_ID: "<client id>"   # from 1.2
QA_CONSOLE_USERS_FILE: /config/users.yaml
QA_CONSOLE_GIT_URL: https://github.com/<owner>/nemo.git
QA_CONSOLE_MAX_ACTIVE_RUNS: "1"
# QA_CONSOLE_BITBUCKET_REPOSITORY: <workspace>/<repository>   # the CI tab, with its token
# QA_CONSOLE_AGENT_DAILY_USD: "5"
# QA_CONSOLE_SKILLS_BUCKET: nemo-skills   # step 4, together with the key in the Secret
```

Another files host name: `QA_CONSOLE_FILES_URL` here and the Ingress rule.

### 2.3 ConfigMap `qa-console-users` (`users.yaml`)

```yaml
# The emails of the IdP's accounts, verified there.
users:
  someone@example.com: operator   # everything, prod included
  other@example.com: runner       # runs, stops, retries and cleans up on staging
  third@example.com: viewer       # watches runs and CI, reads logs and reports (not prod's)
```

Start with viewers, then runners, operators last. Edits apply at once, without a restart.

### 2.4 Secret `qa-console-secrets`

| Key | Value |
|---|---|
| `QA_STAGE_EMAIL`, `QA_STAGE_PASSWORD` | the staging QA account |
| `QA_PROD_EMAIL`, `QA_PROD_PASSWORD` | the prod QA account |
| `QA_CONSOLE_GIT_TOKEN` | from 1.1, for a private repository |
| `QA_CONSOLE_BITBUCKET_TOKEN` | from 1.1 (**Pipelines: Read** and **Write**), for the CI tab |
| `QA_CONSOLE_INGEST_TOKENS` | the same as the repository variable `QA_CONSOLE_INGEST_TOKEN`; two, comma-separated, while one is replaced |
| `QA_CONSOLE_OPENAI_API_KEY` | from 1.3 |
| `QA_CONSOLE_ANTHROPIC_API_KEY` | from 1.3 |
| `QA_CONSOLE_SKILLS_ACCESS_KEY_ID`, `QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY` | the pod's key from 1.4 — in step 4, together with `QA_CONSOLE_SKILLS_BUCKET` |

### 2.5 Deployment, Service and Ingresses

As in the reference, keeping every point of [Keep these](#keep-these-each-one-broke-or-would-break-the-console):
one replica (`strategy: Recreate`), no `command:`, `enableServiceLinks: false`,
`terminationGracePeriodSeconds: 240`, `fsGroup: 1001`, `/dev/shm` in memory,
`allowPrivilegeEscalation: true`, probes on `/api/ready` and `/api/health`, requests 2 CPU / 4Gi and
limits 4 CPU / 8Gi. Two Ingresses: `qa-console` (both hosts; long read timeouts, no buffering, for
the event stream) and `qa-console-ingest` (`/api/ingest/`: bodies up to 256m, passed on unbuffered).

### 2.6 The network

The pod reaches, over HTTPS: the environments it tests (the apps, their APIs and sign-in pages),
the git host, `api.bitbucket.org` for the CI tab, `api.openai.com` and `api.anthropic.com`, and
the skill store's endpoint. Allow them where egress is restricted.

## 3. The first deploy

1. **Build and push the image:**
   ```bash
   docker build --build-arg BUILD_ID=<tag> --tag <registry>/qa-console:<tag> .
   docker push <registry>/qa-console:<tag>
   ```
   and set the Deployment's image to it.
2. **Check it is up:**
   ```bash
   curl https://qa.example.com/api/health   # {"app":"qa-console","build":"<tag>",…}
   curl https://qa.example.com/api/ready    # 200 (503 while it shuts down)
   ```
3. **Sign in** at `https://qa.example.com` with an account of `users.yaml`.
4. **A test run:** **New run** → **Scripted tests** → staging → `smoke`: it passes, and its report
   opens on `qa-files.example.com`.
5. **An agent check:** **New run** → **Agent check** → `qa-smoke` → staging: it passes, for about
   a cent.

## 4. Turn the skill store on (after step 3)

1. **The settings, at once:** `QA_CONSOLE_SKILLS_BUCKET` in the ConfigMap and the pod's key in the
   Secret; restart the pod. One without the other and the console does not start (it says what is
   missing).
2. **Move the skills in**, once:
   ```bash
   kubectl exec -it deploy/qa-console [-n <namespace>] -- \
     pnpm --silent --dir console/server skills:migrate --dry-run
   kubectl exec -it deploy/qa-console [-n <namespace>] -- \
     pnpm --silent --dir console/server skills:migrate
   ```
   It puts in the image's `hermes/skills` folders that run no Playwright scripts (those with
   scripts stay in git) and the console's own `/data/skills` with all their versions. What the
   bucket has already is left alone, so it may run again.
3. **Check:** **Skills** lists them as `Store v1 · Prod v1`, their git copies shadowed.
4. **Only then** delete the moved skills from git, if you want the store to be their only home.

## 5. CI: runs live and agent checks on a schedule

1. **The variables** of 1.1: `QA_CONSOLE_INGEST_URL`, and `QA_CONSOLE_INGEST_TOKEN` equal to one of
   the Secret's `QA_CONSOLE_INGEST_TOKENS`.
2. **Check:** the next run of `e2e-staging` shows in the console's **CI** tab as it goes, and
   afterwards CI queues the environment's agent checks (`agent_checks` in `e2e.config.yaml`).
3. **The Schedules:** the repository's **Pipelines** → **Schedules** → **New schedule**: branch
   `develop` with `agent-checks-staging`, and `main` with `agent-checks-prod` (hourly, daily or
   weekly). The pipelines must be on those branches.

## 6. A developer's machine

`.env` at the repo root (git-ignored):

```bash
# the skill store: the same bucket, the developers' key from 1.4
QA_CONSOLE_SKILLS_BUCKET=nemo-skills
QA_CONSOLE_SKILLS_ACCESS_KEY_ID=<the developers' key id>
QA_CONSOLE_SKILLS_SECRET_ACCESS_KEY=<the developers' key secret>
# agent checks on this machine (optional)
QA_CONSOLE_OPENAI_API_KEY=<…>
QA_CONSOLE_ANTHROPIC_API_KEY=<…>
```

```bash
pnpm console:setup && pnpm console         # http://127.0.0.1:7357
pnpm skills:pull                            # the store's skills for Hermes run by hand (~/.hermes/skills)
```

## 7. After a deploy

- [ ] `/api/health` answers the new `build`; `/api/ready` is 200.
- [ ] Sign-in through the IdP works; the roles are those of `users.yaml`.
- [ ] A Scripted tests run on staging passes; its report opens on the files host.
- [ ] An agent check on staging passes and shows what it spent.
- [ ] **Skills** lists the store's skills; **Promote to prod** works.
- [ ] A CI run shows live in the **CI** tab.
- [ ] A rollout during a test leaves no data behind: the console stops its runs and their tests
      clean up.

## Sizing

- **Memory:** an agent check is Hermes (about 0.5 GB) and its Chromium. A seven-minute navigation
  check took the container to 2.5 GB at its peak, the console's own 0.2 GB included. With
  `QA_CONSOLE_MAX_ACTIVE_RUNS: "1"` a check waits for the run before it and the reference's
  4 Gi / 8 Gi hold it. With `"2"` a check may go beside a test run: add 3 Gi to the request and
  the limit.
- **The volume:** each environment has an agent home, `/data/agent-homes/<env>` (a few MB); a
  check's run folder is about 10 MB (screenshots, transcript). The 20 Gi hold them. Skills live in
  the skill store, mirrored in `/data/skills-registry`; without the store, only on the volume, in
  `/data/skills` (the console's alone): back the volume up with them in mind.

## Keep these (each one broke or would break the console)

- **`enableServiceLinks: false`** (or another name for the Service): Kubernetes hands a pod
  `QA_CONSOLE_PORT=tcp://…` for a Service named `qa-console`, and the console reads it as its own
  port setting and does not start.
- **No `command:` on the container.** The image's entrypoint is `tini`, which hands SIGTERM to the
  console; a `command:` replaces it, the console runs as PID 1 and ignores SIGTERM, and every
  rollout waits out the whole grace period.
- **One replica, `strategy: Recreate`**, a `ReadWriteOnce` volume on `/data` with `fsGroup: 1001`
  (the image's `pwuser`): two consoles at once would share the QA accounts and the volume.
- **`terminationGracePeriodSeconds: 240`**: on SIGTERM the console stops its runs so their tests
  delete their data (they get up to 3 minutes), then exits; it is not ready (503) meanwhile.
- **`/dev/shm` as a memory `emptyDir`** (1 Gi) for Chromium.
- **The event stream**: `/api/stream` stays open while a page is open; the console pings every
  15 s and sends `X-Accel-Buffering: no`. Keep the proxy's read timeout above 15 s and do not
  buffer it (the annotations in the reference).
- **`/api/ingest/`** (CI runs live): a step sends its events in small batches and, at the end, its
  report (up to 200 MB) with a PUT. The second Ingress in the reference takes bodies that big and
  passes them on as they come.
- **`allowPrivilegeEscalation: true`** on the container: the console starts branch code through
  sudo. A cluster policy that forbids it (Pod Security "restricted"): set
  `QA_CONSOLE_RUNNERS: self` in the ConfigMap; branch code then runs as the console's own user (it
  could read the console's tokens and the prod QA account).
- **A volume that not everyone may write in.** With `fsGroup` a typical block volume is `2775`
  (`root:1001`): fine. A volume writable by every user (some local provisioners make `0777`) would
  let a runner replace the console's folders: the console does not start on it and says so.
- **The files host** (`qa-files.example.com`, `QA_CONSOLE_FILES_URL`) reaches the same Service; the
  console answers it with run files only (`/t/…`).

## Checked on k3s with this reference

The image ran as `pwuser` with the volume writable; `/api/ready` and `/api/health` as probes;
sign-in; runs on staging from a commit; events through the ingress within 0.4 s (median 5 ms); a
rollout during a test that creates data: the pod was gone in 2 s, the run ended interrupted, its
test deleted its data (a dry-run cleanup found nothing), and runs and sessions were still there in
the new pod. The console in the pod is in the runner users' groups and sudo works under its
`securityContext`; on a provisioner's `0777` volume the console refused to start, on `2775` it
started.
