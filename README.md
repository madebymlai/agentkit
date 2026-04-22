# agentkit

Setup tool for AI coding agents. Installs and configures tools across Claude Code, Codex, and OpenCode.

## Install

```bash
npx @madebymlai/agentkit
```

## What it installs

| Tool | What |
|------|------|
| **tokf** | Token compression binary + global hook |
| **codebase-memory** | Code knowledge graph MCP server |
| **context7** | Library docs MCP server |
| **compound-engineering** | AI dev workflow plugin (brainstorm, plan, review, compound) |
| **impeccable** | Frontend design skills |
| **bun** | JS runtime (installed if missing, needed for some plugin installers) |
