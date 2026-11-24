<script setup lang="ts">
import type { ISkillDetail } from "@shared/types";
import { SAFETY_WORDS } from "@/lib/skills";
import SkillText from "./SkillText.vue";

// A skill's skill.yaml as people read it: what it does and changes, what it keeps to, its steps,
// its screenshots, what its report says and when it passes or fails. A reading column: headings
// at the text's size, steps numbered in a gutter of their own, lists with faint bullets.

defineProps<{ fields: NonNullable<ISkillDetail["fields"]> }>();

const HEADING = "text-sm font-semibold";
// A list with faint bullets (the marker takes the colour; the text keeps its own).
const BULLETS = "grid list-disc pl-5 marker:text-faint";
const CODE = "rounded bg-muted px-1 font-mono text-xs";
</script>

<template>
  <div class="max-w-3xl text-sm [&>section+section]:mt-6">
    <section aria-labelledby="skill-does">
      <h2 id="skill-does" :class="HEADING">What it does</h2>
      <SkillText class="mt-2" :text="fields.summary" />
    </section>

    <section aria-labelledby="skill-changes">
      <h2 id="skill-changes" :class="HEADING">What it changes</h2>
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
      <h2 id="skill-setup" :class="HEADING">Before it starts</h2>
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
      <ul v-if="fields.rules.length > 0" :class="BULLETS" class="mt-3 gap-1.5">
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
      <h2 :id="`skill-section-${index}`" :class="HEADING">
        {{ section.title }}
      </h2>
      <SkillText class="mt-2" :text="section.text" />
    </section>

    <section aria-labelledby="skill-steps">
      <h2 id="skill-steps" :class="HEADING">Steps</h2>
      <ol class="mt-2 grid gap-2.5">
        <li
          v-for="(step, index) in fields.steps"
          :key="index"
          class="grid grid-cols-[24px_minmax(0,1fr)]"
        >
          <span class="tabular-nums text-faint" aria-hidden="true"
            >{{ index + 1 }}.</span
          >
          <SkillText :text="step" />
        </li>
      </ol>
    </section>

    <section
      v-if="fields.screenshots !== undefined"
      aria-labelledby="skill-shots"
    >
      <h2 id="skill-shots" :class="HEADING">Screenshots</h2>
      <p class="mt-2 text-muted-foreground">
        In
        <code :class="CODE"
          >~/nemo-output/smoke-screens/&lt;env&gt;/{{
            fields.screenshots.folder
          }}/</code
        >
      </p>
      <ul :class="BULLETS" class="mt-2 gap-1">
        <li v-for="(file, index) in fields.screenshots.files" :key="index">
          <SkillText :text="file" />
        </li>
      </ul>
    </section>

    <section aria-labelledby="skill-report">
      <h2 id="skill-report" :class="HEADING">Report</h2>
      <p class="mt-2 text-muted-foreground">
        <code :class="CODE">RESULT: PASS</code>
        or
        <code :class="CODE">RESULT: FAIL</code>
        first, then:
      </p>
      <ul :class="BULLETS" class="mt-2 gap-1">
        <li v-for="(item, index) in fields.report" :key="index">
          <SkillText :text="item" />
        </li>
      </ul>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 class="font-medium text-pass">Passes when</h3>
          <ul
            v-if="fields.pass_if.length > 0"
            :class="BULLETS"
            class="mt-1.5 gap-1"
          >
            <li v-for="(item, index) in fields.pass_if" :key="index">
              <SkillText :text="item" />
            </li>
          </ul>
          <p v-else class="mt-1.5">none of the fail cases holds</p>
        </div>
        <div>
          <h3 class="font-medium text-fail">Fails when</h3>
          <ul :class="BULLETS" class="mt-1.5 gap-1">
            <li v-for="(item, index) in fields.fail_if" :key="index">
              <SkillText :text="item" />
            </li>
          </ul>
        </div>
      </div>
      <div v-if="fields.not_a_failure.length > 0" class="mt-4">
        <h3 class="font-medium">Not a failure</h3>
        <ul :class="BULLETS" class="mt-1.5 gap-1">
          <li v-for="(item, index) in fields.not_a_failure" :key="index">
            <SkillText :text="item" />
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
