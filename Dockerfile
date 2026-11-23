# The QA Console as the team's server (README → QA Console → Docker): the console's code, the
# browsers of Playwright, git for the commits it tests and Hermes Agent for the agent checks. The tag must equal @playwright/test in
# package.json (pnpm validate checks it); a branch with another version gets its own Chromium
# in /data/browsers.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

# git: runs test commits of myqa; procps: ps finds runs again after a restart; tini: PID 1,
# hands SIGTERM to the console (which stops its runs first) and reaps what their browsers leave;
# sudo: branch code runs as qa-runner (open environments) or qa-runner-guarded (prod), never as
# the console (QA_CONSOLE_RUNNERS=sudo; console/runner-sudoers). The console is in both groups.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git procps tini sudo \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1002 --user-group --create-home --shell /usr/sbin/nologin qa-runner \
 && useradd --uid 1003 --user-group --create-home --shell /usr/sbin/nologin qa-runner-guarded \
 && usermod --append --groups qa-runner,qa-runner-guarded pwuser \
 && install -d -m 0700 -o qa-runner -g qa-runner /home/qa-runner/tmp \
 && install -d -m 0700 -o qa-runner-guarded -g qa-runner-guarded /home/qa-runner-guarded/tmp
COPY console/runner-sudoers /etc/sudoers.d/qa-console
RUN chmod 0440 /etc/sudoers.d/qa-console \
 && visudo --check --file=/etc/sudoers.d/qa-console

# Hermes Agent (Nous Research): the LLM agent of the agent checks (hermes/, README → QA Console),
# pinned to a release commit and installed once into /opt/hermes, owned by root. Its dependency
# environment gets the anthropic package (the agent's provider); the runner users run that
# environment's own hermes (/usr/local/bin/qa-hermes) with a Hermes home of their own, so nothing
# is installed per runner and nothing under /opt/hermes is theirs to write. Its browser is the
# image's Playwright Chromium (no Chromium of its own); what headless runs do not need goes
# (git history, tests, docs, ffmpeg, the TUI's node_modules, the generation before the extra).
ARG HERMES_COMMIT=2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19
RUN curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.sh" -o /tmp/hermes-install.sh \
 && bash /tmp/hermes-install.sh --commit "${HERMES_COMMIT}" --hermes-home /opt/hermes \
      --non-interactive --skip-browser --skip-computer-use \
 && HERMES_HOME=/opt/hermes /opt/hermes/hermes-agent/.hermes/bin/hermes pm install --extra anthropic \
 && venv="$(python3 -c 'import glob, json; print(json.load(open(glob.glob("/opt/hermes/installs/*/facts.json")[0]))["packages"]["venv"]["environment"])')" \
 && ln -s "$venv/bin/hermes" /usr/local/bin/qa-hermes \
 && for generation in /opt/hermes/installs/*/environments/*; do \
      [ "$generation/venv" = "$venv" ] || rm -rf "$generation"; \
    done \
 && rm -rf /tmp/hermes-install.sh /opt/hermes/cache /opt/hermes/.env /root/.cache /root/.npm \
      /opt/hermes/hermes-agent/.git /opt/hermes/hermes-agent/tests /opt/hermes/hermes-agent/website \
      /opt/hermes/hermes-agent/node_modules /opt/hermes/tools/ffmpeg-* \
 && chmod -R a+rX /opt/hermes/hermes-agent /opt/hermes/installs /opt/hermes/tools \
 && /usr/local/bin/qa-hermes --version

# pnpm as the apps install it; the console also runs it, for the packages of the commits it tests.
RUN npm install -g pnpm@latest-10 \
 && rm -rf /root/.npm

WORKDIR /app

# The packages first: a change to the code does not install them again. The console's server
# (NestJS) has its own; it runs from source through SWC, which they include. Each install's
# store goes with its layer: the packages stay in node_modules, hard-linked.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store
COPY console/server/package.json console/server/pnpm-lock.yaml console/server/
RUN pnpm --dir console/server install --frozen-lockfile --prod --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store
COPY console/web/package.json console/web/pnpm-lock.yaml console/web/
RUN pnpm --dir console/web install --frozen-lockfile --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store

COPY . .
# The web app is built here and its packages go; the console's own cleanups (and their login)
# write reports and test results here, everything else goes to /data.
RUN pnpm --dir console/web build \
 && rm -rf console/web/node_modules \
 && mkdir -p /data reports test-results \
 && chown pwuser:pwuser /data reports test-results

# The image's tag, as /api/health reports it (CI passes it; the apps do the same).
ARG BUILD_ID=local
ENV QA_CONSOLE_MODE=server \
    QA_CONSOLE_DATA_DIR=/data \
    QA_CONSOLE_RUNNERS=sudo \
    QA_CONSOLE_HERMES=/usr/local/bin/qa-hermes \
    QA_CONSOLE_BUILD=$BUILD_ID \
    SWC_NODE_PROJECT=/app/console/server/tsconfig.json
USER pwuser
EXPOSE 7357
ENTRYPOINT ["tini", "--"]
CMD ["node", "-r", "./console/server/node_modules/@swc-node/register", "console/server/main.ts"]
