# Contributing to Prompt Studio

Thank you for helping. This guide explains how to propose a change.

## Before you start

- Search [existing issues](https://github.com/salir-se/prompt-studio/issues) first.
- For a bug, open an issue with steps to reproduce, what you expected, and what happened.
- For a larger change, open an issue to discuss the problem before you write code. Describe who is blocked and
  what they are trying to do, not only the change you want.

## Development setup

See [docs/development.md](docs/development.md). In short:

```bash
bun install
bun run dev
```

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one problem. Unrelated refactors belong in their own pull request.
3. Add or update tests. A bug fix starts with a test that fails for the reported reason. A feature has one
   outcome test that drives the real entry point.
4. Do not delete, skip, or weaken an existing test to make the suite pass.
5. Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` before you push.
6. For a user-visible change, update `README.md` or `docs/user-guide.md`, and add a line to `CHANGELOG.md` under
   **Unreleased**.
7. For a UI change, include a screenshot of the affected screen in light and dark themes and at a 375 px width.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix: …`, `feat: …`,
`docs: …`).

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under the [Apache License, Version 2.0](LICENSE),
as described in section 5 of that licence.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
