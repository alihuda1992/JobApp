# Tailored resumes

Local parking spot for job-specific resume files (`.docx` / `.pdf`). Files here are
**gitignored** — they contain personal data and never belong in the public repo.

Files land here two ways:

- **Claude Desktop / claude.ai**: the `tailor-resume` skill builds the file in its sandbox,
  then calls the `save_tailored_resume` MCP tool to park it here (optionally stamping a
  note on the matching pipeline card).
- **Claude Code**: writes here directly when tailoring locally.

Naming convention (matches the tailor-resume skill): `Huda_Aliraza_<Company>_<Role>.<ext>`
— clean identifiers, underscores, no spaces. Collisions get a numeric suffix (`_2`, `_3`)
so nothing is ever overwritten.

Use the `list_tailored_resumes` MCP tool to see what's here from any Claude conversation.
