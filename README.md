# agentkit

Setup tool for AI coding agents. Installs and configures tools across Claude Code, Codex, and OpenCode.

## Install

```bash
npx @madebymlai/agentkit
```

Project setup only (AGENTS.md, CLAUDE.md, .gitignore):

```bash
npx @madebymlai/agentkit --project
```

## What it does

Prompts you to select which tools you use (Claude Code, Codex, OpenCode), then:

| Category | What | Details |
|----------|------|---------|
| **tokf** | Token compression | Binary + global hook |
| **codebase-memory** | Code knowledge graph | MCP server configured for all selected tools |
| **context7** | Library docs | MCP server configured for all selected tools |
| **compound-engineering** | AI dev workflow | Plugin (Claude), bunx install (Codex/OpenCode) |
| **impeccable** | Frontend design | Skills installed globally for selected tools |
| **bun** | JS runtime | Installed if missing |
| **AGENTS.md** | Project config | Principles template + tokf section |
| **CLAUDE.md** | Claude config | References @AGENTS.md |
| **.gitignore** | Git config | Ignores .claude/, .codex/, .opencode/, CLAUDE.md, AGENTS.md |
| **API keys** | Environment | CONTEXT7_API_KEY written to shell profile |

## /agentkit skill

Bundled skill installed globally for all selected tools. Interactive project setup:

- **Principles** — reviews AGENTS.md principles, probes codebase for project-specific additions
- **tokf filters** — discovers noisy commands, writes project-local filters
