# Order-status assistant: starting point

The empty project that episode 1 of [Prompt Studio: zero to hero](../../docs/guides/zero-to-hero.md) starts from.
It has no prompts yet. Copy it to a new folder, make it a Git repository, and open it in Prompt Studio:

```bash
cp -r examples/order-status-start ~/order-status && cd ~/order-status
git init -q -b main && git add -A && git commit -q -m "Empty project"
bunx @salir-se/prompt-studio --repo .
```

The finished state is in [`../order-status`](../order-status/).
