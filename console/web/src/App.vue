<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { toast } from "vue-sonner";
import AppHeader from "@/components/AppHeader.vue";
import NewRunDialog from "@/components/NewRunDialog.vue";
import RunSidebar from "@/components/RunSidebar.vue";
import { Toaster } from "@/components/ui/sonner";
import { messageOf } from "@/lib/api";
import SignInPage from "@/pages/SignInPage.vue";
import { router } from "@/router";
import { loadConfig } from "@/state/config";
import { loadMe, sessionState, signInNotice } from "@/state/session";
import { closeStream, followedRunId, followRun } from "@/state/stream";

// The console's frame: the header, the run list and the page. It first finds out who uses the
// tab: a server console signs people in (state/session.ts). /sign-in shows on its own.

const route = useRoute();
const onSignInPage = computed(() => route.name === "sign-in");

onMounted(async () => {
  await router.isReady();
  if (!onSignInPage.value) {
    await loadMe();
  }
});

// After the page has rendered: a run page has opened the stream on its run already.
watch(
  sessionState,
  (state) => {
    if (state !== "signed-in") {
      closeStream();
      return;
    }
    loadConfig().catch((failure: unknown) => toast.error(messageOf(failure)));
    followRun(followedRunId.value);
  },
  { flush: "post" }
);
</script>

<template>
  <RouterView v-if="onSignInPage" />
  <SignInPage
    v-else-if="sessionState === 'signed-out'"
    :notice="signInNotice"
    :email="null"
  />
  <!-- Shows only when the answer is slow, so a normal load does not flash it. -->
  <div
    v-else-if="sessionState === 'checking'"
    role="status"
    class="grid h-dvh place-items-center text-sm text-muted-foreground animate-in fade-in-0 duration-200 [animation-delay:400ms] [animation-fill-mode:both]"
  >
    Connecting to the console…
  </div>
  <div v-else class="flex h-dvh flex-col">
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <div class="hidden w-72 shrink-0 border-r md:block">
        <RunSidebar />
      </div>
      <!-- relative: what is positioned inside a page (sr-only labels) scrolls with it instead of
           making the whole window taller. -->
      <main class="relative min-w-0 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>
    <NewRunDialog />
  </div>
  <Toaster position="bottom-right" />
</template>
