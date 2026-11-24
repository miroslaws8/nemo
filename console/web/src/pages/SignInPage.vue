<script setup lang="ts">
import { LogInIcon } from "@lucide/vue";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
import NoteBanner from "@/components/NoteBanner.vue";
import { Button } from "@/components/ui/button";
import { signIn } from "@/state/session";
import type { ISignInMessage, ISignInNotice } from "@/types";

// The page between the console and the app's sign-in: what went wrong (if anything) and the
// button that signs in. It never sends the browser off by itself, so it cannot go round in circles.

const props = defineProps<{
  notice: ISignInNotice | null;
  email: string | null;
}>();

const NOTICES: Record<ISignInNotice, (email: string | null) => ISignInMessage> =
  {
    "signed-out": () => ({
      title: "You signed out",
      tone: "idle",
      text: "Sign in again to get back to the runs.",
    }),
    expired: () => ({
      title: "That sign-in expired",
      tone: "flaky",
      text: "It took too long, or it began in another tab. Start it again.",
    }),
    refused: () => ({
      title: "The app did not sign you in",
      tone: "fail",
      text: "The sign-in was cancelled or refused. Try again.",
    }),
    unreachable: () => ({
      title: "The app did not answer",
      tone: "fail",
      text: "The console could not reach the app to finish the sign-in. Try again in a minute.",
    }),
    impersonated: () => ({
      title: "Not as someone else",
      tone: "flaky",
      text: "Stop impersonating in the app, then sign in as yourself.",
    }),
    unverified: (email) => ({
      title: "Verify your email first",
      tone: "flaky",
      text: `${
        email ?? "Your email"
      } is not verified in the app yet. Verify it there, then sign in again.`,
    }),
    "not-listed": (email) => ({
      title: "No access to the console",
      tone: "fail",
      text: `${
        email ?? "Your account"
      } is not on the console's list. Ask whoever runs it to add you; to use another account, sign out of the app first.`,
    }),
    stuck: () => ({
      title: "Signing in did not stick",
      tone: "fail",
      text: "The browser did not keep the console's cookie. Open the console at its own address, allow its cookies and try again.",
    }),
  };

const message = computed(() =>
  props.notice === null ? null : NOTICES[props.notice](props.email)
);

useTitle("Sign in — QA Console");

function start(): void {
  signIn(`${window.location.origin}/`);
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-paper px-4 py-10">
    <div class="w-full max-w-80 space-y-6">
      <div class="grid justify-items-center gap-3 text-center">
        <span
          class="grid size-8 place-items-center rounded-md bg-foreground text-base font-semibold text-paper"
          aria-hidden="true"
          >Q</span
        >
        <h1 class="text-base font-semibold">Sign in to QA Console</h1>
        <p v-if="message === null" class="text-sm text-muted-foreground">
          Use your account of the app the console tests.
        </p>
      </div>
      <NoteBanner v-if="message !== null" :tone="message.tone" role="status">
        <span class="block font-medium">{{ message.title }}</span>
        <span class="block text-foreground/80">{{ message.text }}</span>
      </NoteBanner>
      <Button class="w-full" @click="start">
        <LogInIcon aria-hidden="true" />
        Sign in
      </Button>
    </div>
  </main>
</template>
