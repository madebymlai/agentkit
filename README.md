# agentstack

Setup tool for AI coding agents. Installs and configures tools across Claude Code, Codex, and OpenCode.

## Install

```bash
npx github:madebymlai/agentstack
```

Skip the interactive selector:

```bash
npx github:madebymlai/agentstack --claude --codex
npx github:madebymlai/agentstack --opencode
```

Project setup only (AGENTS.md, .gitignore):

```bash
npx github:madebymlai/agentstack --project
npx github:madebymlai/agentstack --project --codex
```

## What it does

Prompts you to select which tools you use (Claude Code, Codex, OpenCode), then:

| Tool | Description |
|------|-------------|
| [**tokf**](https://github.com/mpecan/tokf) | Token compression binary + global hooks for selected tools (Linux/MacOS only) |
| [**codebase-memory**](https://github.com/DeusData/codebase-memory-mcp) | Code knowledge graph MCP server for all selected tools |
| [**compound-engineering**](https://github.com/EveryInc/compound-engineering-plugin) | AI dev workflow plugin (Claude) / native plugin + bunx-installed agents (Codex) / bunx install (OpenCode) |
| [**bun**](https://bun.sh) | JS runtime, installed when needed |
| **AGENTS.md** | Principles template + tokf section |
| **.gitignore** | Ignores .claude/, .codex/, .opencode/, CLAUDE.md, AGENTS.md |

## /agentstack skill

Bundled skill installed globally for all selected tools. Interactive project setup:

- **Principles** - reviews AGENTS.md principles, probes codebase for project-specific additions
- **tokf filters** - discovers noisy commands, writes project-local filters
