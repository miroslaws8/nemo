import { createRouter, createWebHistory } from "vue-router";
import CiPage from "@/pages/CiPage.vue";
import RunPage from "@/pages/RunPage.vue";
import RunsPage from "@/pages/RunsPage.vue";
import SignInPage from "@/pages/SignInPage.vue";
import SkillComposePage from "@/pages/SkillComposePage.vue";
import SkillNewPage from "@/pages/SkillNewPage.vue";
import SkillPage from "@/pages/SkillPage.vue";
import SkillsPage from "@/pages/SkillsPage.vue";
import SkillUploadPage from "@/pages/SkillUploadPage.vue";
import { parseNotice } from "@/state/session";

// A query value as text, or null.
function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// The console serves index.html for every path that is not a file, so these are real URLs.
// A run's report and files live next to its page: /runs/<id>/report/, /runs/<id>/files/….

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: RunsPage },
    { path: "/runs/:id", name: "run", component: RunPage, props: true },
    {
      path: "/ci/:number(\\d+)",
      name: "ci",
      component: CiPage,
      props: (route) => ({ number: Number(route.params.number) }),
    },
    {
      path: "/skills",
      name: "skills",
      component: SkillsPage,
      props: (route) => ({ branch: textOf(route.query.ref) }),
    },
    { path: "/skills/new", name: "new-skill", component: SkillNewPage },
    {
      path: "/skills/new/upload",
      name: "upload-skill",
      component: SkillUploadPage,
      props: { name: null },
    },
    {
      path: "/skills/new/form",
      name: "compose-skill",
      component: SkillComposePage,
      props: (route) => ({
        template: textOf(route.query.template),
        from: textOf(route.query.from),
        origin: route.query.origin === "console" ? "console" : null,
      }),
    },
    {
      path: "/skills/:name/replace",
      name: "replace-skill",
      component: SkillUploadPage,
      props: (route) => ({ name: String(route.params.name) }),
    },
    {
      path: "/skills/:name",
      name: "skill",
      component: SkillPage,
      props: (route) => ({
        name: String(route.params.name),
        origin:
          route.query.origin === "console" || route.query.origin === "repo"
            ? route.query.origin
            : null,
        branch: textOf(route.query.ref),
      }),
    },
    {
      // Where /auth/callback sends a failed sign-in, and where signing out ends (App shows it bare).
      path: "/sign-in",
      name: "sign-in",
      component: SignInPage,
      props: (route) => ({
        notice: parseNotice(route.query.problem),
        email: typeof route.query.email === "string" ? route.query.email : null,
      }),
    },
    { path: "/:unknown(.*)*", redirect: "/" },
  ],
});
