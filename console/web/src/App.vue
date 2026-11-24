<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { toast } from "vue-sonner";
import AppSidebar from "@/components/AppSidebar.vue";
import NewRunDialog from "@/components/NewRunDialog.vue";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { messageOf } from "@/lib/api";
import SignInPage from "@/pages/SignInPage.vue";
import { router } from "@/router";
import { loadConfig } from "@/state/config";
import { navOpen } from "@/state/dialogs";
import { loadMe, sessionState, signInNotice } from "@/state/session";
import { closeStream, followedRunId, followRun } from "@/state/stream";

// The console's frame: the sidebar on the paper, and the page in a panel beside it (below `md` the
// sidebar is a sheet the page bar opens). It first finds out who uses the tab: a server console
// signs people in (state/session.ts). /sign-in shows on its own.

const route = useRoute();
const onSignInPage = computed(() => route.name === "sign-in");

onMounted(async () => {
  await router.isReady();
  if (!onSignInPage.value) {
    await loadMe();
  }
});

// The sheet is a way to somewhere: it closes once there.
watch(
  () => route.fullPath,
  () => {
    navOpen.value = false;
  }
);

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
  <TooltipProvider v-else :delay-duration="300">
    <div class="flex h-dvh bg-paper text-foreground">
      <aside
        aria-label="Console"
        class="hidden w-58 shrink-0 flex-col p-2 md:flex"
      >
        <AppSidebar />
      </aside>
      <Sheet v-model:open="navOpen">
        <SheetContent
          side="left"
          :show-close-button="false"
          class="w-58 gap-0 border-r bg-paper p-2 md:hidden"
        >
          <SheetTitle class="sr-only">QA Console</SheetTitle>
          <SheetDescription class="sr-only"
            >Where to go, and each environment's state.</SheetDescription
          >
          <AppSidebar />
        </SheetContent>
      </Sheet>
      <!-- relative: what is positioned inside a page (sr-only labels) scrolls with it instead of
           making the whole window taller. -->
      <main
        class="relative m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-y-auto rounded-lg bg-background text-foreground ring-1 ring-border max-md:ml-2"
      >
        <RouterView />
      </main>
    </div>
    <NewRunDialog />
  </TooltipProvider>
  <Toaster position="bottom-right" />
</template>
