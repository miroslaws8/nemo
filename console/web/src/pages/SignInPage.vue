<script setup lang="ts">
import { LogInIcon } from "@lucide/vue";
import { useTitle } from "@vueuse/core";
import { computed } from "vue";
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
      text: "Sign in again to get back to the runs.",
    }),
    expired: () => ({
      title: "That sign-in expired",
      text: "It took too long, or it began in another tab. Start it again.",
    }),
    refused: () => ({
      title: "The app did not sign you in",
      text: "The sign-in was cancelled or refused. Try again.",
    }),
    unreachable: () => ({
      title: "The app did not answer",
      text: "The console could not reach the app to finish the sign-in. Try again in a minute.",
    }),
    impersonated: () => ({
      title: "Not as someone else",
      text: "Stop impersonating in the app, then sign in as yourself.",
    }),
    unverified: (email) => ({
      title: "Verify your email first",
      text: `${
        email ?? "Your email"
      } is not verified in the app yet. Verify it there, then sign in again.`,
    }),
    "not-listed": (email) => ({
      title: "No access to the console",
      text: `${
        email ?? "Your account"
      } is not on the console's list. Ask whoever runs it to add you; to use another account, sign out of the app first.`,
    }),
    stuck: () => ({
      title: "Signing in did not stick",
      text: "The browser did not keep the console's cookie. Open the console at its own address, allow its cookies and try again.",
    }),
  };

const DEFAULT_MESSAGE: ISignInMessage = {
  title: "Sign in to the QA Console",
  text: "Use your account of the app the console tests.",
};

const message = computed(() =>
  props.notice === null ? DEFAULT_MESSAGE : NOTICES[props.notice](props.email)
);

useTitle("Sign in — QA Console");

function start(): void {
  signIn(`${window.location.origin}/`);
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-background px-4 py-10">
    <div class="w-full max-w-sm space-y-6">
      <p class="flex items-center gap-2 font-semibold tracking-tight">
        <img src="/favicon.svg" alt="" class="size-6" />
        QA Console
      </p>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold tracking-tight text-balance">
          {{ message.title }}
        </h1>
        <p class="text-sm text-muted-foreground">{{ message.text }}</p>
      </div>
      <Button class="w-full" @click="start">
        <LogInIcon aria-hidden="true" />
        Sign in
      </Button>
    </div>
  </main>
</template>
