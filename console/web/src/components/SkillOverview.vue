<script setup lang="ts">
import type { ISkillDetail } from "@shared/types";
import { SAFETY_WORDS } from "@/lib/skills";
import SkillText from "./SkillText.vue";

// A skill's skill.yaml as people read it: what it does and changes, what it keeps to, its steps,
// its screenshots, what its report says and when it passes or fails.

defineProps<{ fields: NonNullable<ISkillDetail["fields"]> }>();
</script>

<template>
  <div class="grid gap-8 text-sm">
    <section aria-labelledby="skill-does">
      <h2 id="skill-does" class="text-base font-semibold">What it does</h2>
      <SkillText class="mt-2" :text="fields.summary" />
    </section>

    <section aria-labelledby="skill-changes">
      <h2 id="skill-changes" class="text-base font-semibold">
        What it changes
      </h2>
      <p class="mt-2">
        <span class="font-medium"
          >{{ SAFETY_WORDS[fields.safety].label }}:</span
        >
        {{ SAFETY_WORDS[fields.safety].hint }}
      </p>
      <SkillText
        v-if="fields.side_effects !== undefined"
        class="mt-1 text-muted-foreground"
        :text="fields.side_effects"
      />
      <p v-if="fields.ai_credits" class="mt-1 text-flaky">
        It spends AI credits on the environment.
      </p>
    </section>

    <section aria-labelledby="skill-setup">
      <h2 id="skill-setup" class="text-base font-semibold">Before it starts</h2>
      <dl class="mt-2 grid gap-1">
        <div class="flex flex-wrap gap-x-2">
          <dt class="text-muted-foreground">Takes</dt>
          <dd>
            the environment<template v-if="fields.arguments !== undefined">
              and {{ fields.arguments }}</template
            >; other words are a note from whoever starts it
          </dd>
        </div>
        <div v-if="fields.start_at !== undefined" class="flex gap-x-2">
          <dt class="text-muted-foreground">Starts at</dt>
          <dd class="font-mono text-xs leading-5">{{ fields.start_at }}</dd>
        </div>
      </dl>
      <ul
        v-if="fields.rules.length > 0"
        class="mt-3 grid list-disc gap-1.5 pl-5"
      >
        <li v-for="(rule, index) in fields.rules" :key="index">
          <SkillText :text="rule" />
        </li>
      </ul>
    </section>

    <section
      v-for="(section, index) in fields.sections"
      :key="`section-${index}`"
      :aria-labelledby="`skill-section-${index}`"
    >
      <h2 :id="`skill-section-${index}`" class="text-base font-semibold">
        {{ section.title }}
      </h2>
      <SkillText class="mt-2" :text="section.text" />
    </section>

    <section aria-labelledby="skill-steps">
      <h2 id="skill-steps" class="text-base font-semibold">Steps</h2>
      <ol class="mt-2 grid list-decimal gap-2.5 pl-5">
        <li v-for="(step, index) in fields.steps" :key="index" class="pl-1">
          <SkillText :text="step" />
        </li>
      </ol>
    </section>

    <section
      v-if="fields.screenshots !== undefined"
      aria-labelledby="skill-shots"
    >
      <h2 id="skill-shots" class="text-base font-semibold">Screenshots</h2>
      <p class="mt-2 text-muted-foreground">
        In
        <code class="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]"
          >~/myqa-output/smoke-screens/&lt;env&gt;/{{
            fields.screenshots.folder
          }}/</code
        >
      </p>
      <ul class="mt-2 grid list-disc gap-1 pl-5">
        <li v-for="(file, index) in fields.screenshots.files" :key="index">
          <SkillText :text="file" />
        </li>
      </ul>
    </section>

    <section aria-labelledby="skill-report">
      <h2 id="skill-report" class="text-base font-semibold">Report</h2>
      <p class="mt-2 text-muted-foreground">
        <code class="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]"
          >RESULT: PASS</code
        >
        or
        <code class="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]"
          >RESULT: FAIL</code
        >
        first, then:
      </p>
      <ul class="mt-2 grid list-disc gap-1 pl-5">
        <li v-for="(item, index) in fields.report" :key="index">
          <SkillText :text="item" />
        </li>
      </ul>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 class="font-medium text-pass">Passes when</h3>
          <ul
            v-if="fields.pass_if.length > 0"
            class="mt-1.5 grid list-disc gap-1 pl-5"
          >
            <li v-for="(item, index) in fields.pass_if" :key="index">
              <SkillText :text="item" />
            </li>
          </ul>
          <p v-else class="mt-1.5">none of the fail cases holds</p>
        </div>
        <div>
          <h3 class="font-medium text-fail">Fails when</h3>
          <ul class="mt-1.5 grid list-disc gap-1 pl-5">
            <li v-for="(item, index) in fields.fail_if" :key="index">
              <SkillText :text="item" />
            </li>
          </ul>
        </div>
      </div>
      <div v-if="fields.not_a_failure.length > 0" class="mt-4">
        <h3 class="font-medium">Not a failure</h3>
        <ul class="mt-1.5 grid list-disc gap-1 pl-5">
          <li v-for="(item, index) in fields.not_a_failure" :key="index">
            <SkillText :text="item" />
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
