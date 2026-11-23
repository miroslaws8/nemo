<script setup lang="ts">
import type { ICiOverview } from "@shared/types";
import { formatClock } from "@/lib/format";

// Why the CI list is empty or old: no token yet, Bitbucket's rate limit, or an error.

defineProps<{ overview: ICiOverview | null }>();
</script>

<template>
  <div class="space-y-2 px-2 text-sm text-muted-foreground">
    <template v-if="overview === null">
      <p>Asking the console about CI…</p>
    </template>
    <template v-else-if="!overview.configured">
      <p class="font-medium text-foreground">CI is not set up yet</p>
      <p>
        The console shows the Bitbucket pipelines once it knows the repository
        and has a token: put
        <span class="font-mono text-xs text-foreground"
          >QA_CONSOLE_BITBUCKET_REPOSITORY=&lt;workspace&gt;/&lt;repository&gt;</span
        >
        and
        <span class="font-mono text-xs text-foreground"
          >QA_CONSOLE_BITBUCKET_TOKEN=…</span
        >
        in myqa's <span class="font-mono text-xs">.env</span> — a repository
        access token with Pipelines: Read and Write — and start the console
        again.
      </p>
    </template>
    <template v-else>
      <p v-if="overview.pausedUntil !== null" class="text-flaky">
        Bitbucket's rate limit: the next update comes after
        {{ formatClock(overview.pausedUntil) }}.
      </p>
      <p v-else-if="overview.error !== null" class="text-fail">
        {{ overview.error }}
      </p>
      <p v-if="overview.pipelines.length === 0 && overview.error === null">
        No e2e pipeline has run yet.
      </p>
    </template>
  </div>
</template>
