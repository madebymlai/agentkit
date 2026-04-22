---
name: agentkit
description: Interactive project setup — coding principles and tokf filters.
argument-hint: ""
---

<purpose>
Interactive project setup. Writes coding principles to AGENTS.md and configures tokf filters.
You drive the conversation — propose, the user accepts or rejects.
</purpose>

<rules>
- All user interaction via direct questions — one topic at a time, never freeform
- Accumulate accepted items in memory, write files only at the end
- Explain what you found before each proposal
- Output principles as short imperative one-liners (MUST/NEVER/PREFER style)
- Keep total AGENTS.md principles section under 30 lines
</rules>

<phase name="detection">
Check if `tokf` binary is available on the system.
</phase>

<phase name="mode-selection">
<if condition="tokf available">
Ask the user: "What would you like to set up?"
- Coding principles
- tokf filters
- Both
</if>
<else>
Proceed with principles only.
</else>
</phase>

<phase name="principles">
<step name="probe">
Explore the codebase to discover project-specific patterns worth adding:

1. `get_architecture` to identify languages, frameworks, build tools.
2. `search_code` to find anti-patterns (empty catch blocks, hardcoded secrets, bare except, `as any`, `.unwrap()`).

For each finding, propose a one-liner principle. The user accepts or skips.
</step>

<step name="write">
Write accepted principles to the `# Principles` section of AGENTS.md.
Format: `- **Name** — Academic definition in 1-2 sentences.`

```
# Principles
- **SRP** — A module should have one, and only one, reason to change: responsible to one actor.
- **KISS** — Every system works best when simplicity is a key goal and unnecessary complexity is avoided.
- **Fail Fast** — Detect and report errors at the earliest possible point, at the interface where the fault originates, rather than allowing bad state to propagate.
```

If AGENTS.md already has a Principles section, ask to merge or overwrite — don't duplicate.
</step>
</phase>

<phase name="tokf-filters">
<step name="learn">
Fetch https://tokf.net/docs/writing-filters/ to learn the filter authoring format.
</step>

<step name="discover">
Run `tokf discover --json` to find commands that ran without filters in past sessions.
- If results found: propose filters for the top noisy commands, one at a time.
- If no results: fall back to codebase exploration.
</step>

<step name="codebase-exploration">
Only if discover found nothing. First understand the project:

1. `get_architecture` to identify languages, frameworks, build tools, test runners.
2. `search_graph` / `search_code` to find build scripts, task definitions, CLI entry points.

Then find commands that would benefit from filters by checking:

- package.json scripts
- Makefile targets
- justfile recipes
- pyproject.toml entry points
- Cargo.toml commands
- CI workflow steps
- Shell scripts in bin/ or scripts/
- Docker Compose service commands

Cross-reference every candidate against `tokf which "[command]"` — skip commands that already have built-in filters.
Focus on commands that produce 10+ lines of output on success.
</step>

<step name="write">
For each accepted filter:
- Write to `.tokf/filters/[tool]/[command].toml` using the format learned from the docs.
- Verify each with `tokf verify` after writing.
- For commands that are noisy but lack unique structure, suggest `.tokf/rewrites.toml` entries instead.
</step>
</phase>

<phase name="summary">
Report what was written:
- Number of principles added to AGENTS.md
- Number of filters written to `.tokf/filters/`
- Number of rewrites added to `.tokf/rewrites.toml`
</phase>
