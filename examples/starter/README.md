# Starter prompt project

An example project for Prompt Studio. Open this folder in Prompt Studio to try it:

```bash
bunx @salir/prompt-studio --repo examples/starter
```

- `prompts/support-triage.md` — a sectioned prompt with placeholders and a JSON output contract.
- `prompts/release-notes.md` — a short prompt that refers to a skill.
- `prompts/greeting.md` — the simplest kind of prompt: one paragraph, no sections.
- `skills/plain-language/SKILL.md` — a skill that prompts can attach in **Run**.
- `studio.manifest.json` — an explicit document list; `bun run dev` in this repository opens this project with it.

A project is any folder (usually a Git repository) with `prompts/<id>.md` files and optional
`skills/<id>/SKILL.md` files.
