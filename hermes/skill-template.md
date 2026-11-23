<!--
The base of every skill's SKILL.md. `pnpm skills` fills it in from each skill's
hermes/skills/<name>/skill.yaml (this comment stays out):
  {{key}}               a value of skill.yaml; lists come out as Markdown lists
  {{#key}} … {{/key}}   these lines only when the skill has that value (or it is yes)
  {{^key}} … {{/key}}   these lines only when it has not
read_only, records_activity and creates_data are yes for the skill's `safety`.
-->
# {{title}}

{{summary}}

{{#read_only}}
**Read-only on every environment, prod included:** the only state change is logging in. Submit nothing else.
{{/read_only}}
{{#records_activity}}
**Records the test account's own activity on every environment, prod included:** {{side_effects}}. That is expected; change nothing else.
{{/records_activity}}
{{#creates_data}}
**Creates data on every environment, prod included:** {{side_effects}}. Title what you create as the shared contract says (Titles of what you create), and never delete anything yourself.
{{/creates_data}}
{{#ai_credits}}

**Spends AI credits** on the environment it runs on.
{{/ai_credits}}

## Setup
First run `cat ~/.hermes/qa-shared.md` in the terminal (there is no `read_file` tool here) and follow it: environments, the vault login, test data, browser mechanics, screenshots, marking what is wrong.
{{^arguments}}
Arguments: the environment (`local`, `staging` or `prod`; default `staging`).
{{/arguments}}
{{#arguments}}
Arguments, in either order: the environment (`local`, `staging` or `prod`; default `staging`) and {{arguments}}.
{{/arguments}}
Any other words are a note from whoever started the skill: follow it within this skill's rules.
{{#start_at}}
Start at `<base>{{start_at}}`.
{{/start_at}}
{{#rules}}

{{rules}}
{{/rules}}

{{sections}}

## Steps
{{steps}}

{{#screenshots}}
## Screenshots
Save them in `~/myqa-output/smoke-screens/<env>/{{screenshots_folder}}/` as the shared contract's Screenshots section says (expand the home path: a relative `./` path lands in `~/.hermes`), and report their absolute paths:
{{screenshots}}

When something on a page is wrong or missing, also save a marked screenshot of it (`<name>-marked.png`), as the shared contract's Marking what is wrong section says, and name it in the report.
{{/screenshots}}

## Report
`RESULT: PASS` or `RESULT: FAIL` on the first line, then:
{{report}}

{{#pass_if}}
**PASS** if any of:
{{pass_if}}

{{/pass_if}}
**FAIL** if any of:
{{fail_if}}
{{^pass_if}}

**PASS** otherwise.
{{/pass_if}}
{{#not_a_failure}}

Not a failure:
{{not_a_failure}}
{{/not_a_failure}}
