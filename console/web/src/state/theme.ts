import { useLocalStorage, usePreferredDark } from "@vueuse/core";
import { computed, watchEffect } from "vue";
import type { ComputedRef, Ref } from "vue";
import { THEME_CHOICES } from "@/types";
import type { IThemeChoice } from "@/types";

// The theme: System (default), Light or Dark, remembered in the browser. The resolved theme is
// kept on the root as `data-theme` (what style.css follows) and as `color-scheme`; the script in
// index.html does the same before the first paint.

export const THEME_STORAGE_KEY = "qa-console-theme";

export const themeChoice: Ref<IThemeChoice> = useLocalStorage<IThemeChoice>(
  THEME_STORAGE_KEY,
  "system",
  {
    serializer: {
      // A value this console never wrote counts as System.
      read: (raw) => THEME_CHOICES.find((choice) => choice === raw) ?? "system",
      write: (choice) => choice,
    },
  }
);

// The operating system's `prefers-color-scheme: dark`, live.
const systemDark = usePreferredDark();

const RESOLVERS: Record<IThemeChoice, (dark: boolean) => "light" | "dark"> = {
  system: (dark) => (dark ? "dark" : "light"),
  light: () => "light",
  dark: () => "dark",
};

export const resolvedTheme: ComputedRef<"light" | "dark"> = computed(() =>
  RESOLVERS[themeChoice.value](systemDark.value)
);

watchEffect(() => {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolvedTheme.value);
  root.style.colorScheme = resolvedTheme.value;
});
