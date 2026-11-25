@AGENTS.md

# Claude Code notes

The import above pulls in the repo's canonical guide (`AGENTS.md`), so edit that file rather than repeating
project rules here. Anything that doesn't understand `@` imports should read `AGENTS.md` directly.

- **Skills:** `.claude/skills/` is the edit source, mirrored byte-for-byte into `.agents/skills/` for Codex.
  CI runs `diff -r .claude/skills .agents/skills` and fails when the two drift.
- **Search:** for broad, read-only questions prefer the `Explore` subagent over reading files one by one.
- **Permissions:** no project-specific MCP servers, hooks or permission settings are configured.
- **Reference:** deeper detail lives in `docs/` and `CODEMAP.md`.
