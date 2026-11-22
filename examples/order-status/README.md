# Order-status assistant (course example)

The finished project from the course [Prompt Studio: zero to hero](../../docs/guides/zero-to-hero.md). Open this
folder in Prompt Studio to see where the course ends:

```bash
bunx @salir-se/prompt-studio --repo examples/order-status
```

- `prompts/order-status.md` — the prompt: mission, rules, tool use, examples, output format and the customer
  message, each in its own tagged section. The comment at the end of the file holds the design that the
  **Design** panel shows: the input and output contracts (JSON Schema), the workflow (Mermaid), one
  sub-prompt design per section, and the verification profiles with their checks and AI criteria.
- `.prompt-studio/project.json` — the shared variables (`customer_message`, `company_name`, with sample values)
  and the `lookup_order` tool with its JSON Schema input.
- `skills/calm-support/SKILL.md` — a tone skill you can attach in **Run** for upset customers.

The assistant reads one customer message, calls `lookup_order(order_id)` when the message contains exactly one
order ID, and returns one JSON object:

```json
{ "reply": "…", "next_action": "none" | "escalate" | "ask_for_order_id", "order_id": "ORD-10423" | null }
```

The course starts from [`../order-status-start`](../order-status-start/), an empty project.
