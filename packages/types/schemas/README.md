# Salir JSON Schemas

Generated artifacts emitted from arktype schemas in `packages/types/src/schemas/`.
Do **not** edit by hand — regenerate with `bun run --filter @prompt-studio/types emit-schemas`.

**Schema version**: `1.0.0`
**JSON Schema dialect**: `draft-2020-12`
**Generated**: 2026-11-10T13:23:32.663Z

## Entities

| Entity | Collection | File | Description |
| ------ | ---------- | ---- | ----------- |
| `company` | `salir:companies` | [`company.schema.json`](./company.schema.json) | A sales prospect — the top-level record produced by the Scout agent. |
| `signal` | `salir:signals` | [`signal.schema.json`](./signal.schema.json) | A hiring signal (job post, news mention) scored by the Scout for delegation readiness. |
| `lead` | `salir:leads` | [`lead.schema.json`](./lead.schema.json) | A decision-maker contact paired with a company and (optionally) a signal. |
| `message` | `salir:messages` | [`message.schema.json`](./message.schema.json) | An outbound draft or inbound reply attached to a lead conversation. |
| `task` | `salir:tasks` | [`task.schema.json`](./task.schema.json) | A sales-person to-do item on a conversation (escalation, send failure, or draft review). |
| `account` | `salir:accounts` | [`account.schema.json`](./account.schema.json) | Account-based view of a company — tier, engagement score, linked contacts and signals. |
| `contact` | `salir:contacts` | [`contact.schema.json`](./contact.schema.json) | A person at a target account, optionally linked to one or more leads. |
| `note` | `salir:notes` | [`note.schema.json`](./note.schema.json) | An operator-authored note attached to a company or contact. |
| `order` | `salir:orders` | [`order.schema.json`](./order.schema.json) | A published order in the Salir marketplace — produced when a Closer publishes requirements. |
| `placement` | `salir:placements` | [`placement.schema.json`](./placement.schema.json) | A developer placed at a customer account against an order. |
| `campaign` | `salir:campaigns` | [`campaign.schema.json`](./campaign.schema.json) | A named outreach campaign with an ICP snapshot and metrics. |
| `watchlist` | `salir:watchlist` | [`watchlist.schema.json`](./watchlist.schema.json) | A long-running watch for new hiring signals at a specific account domain. |

## Envelope

See [`salir-export.schema.json`](./salir-export.schema.json) for the top-level wrapper.

## Compatibility policy

- **Lenient + preserve unknowns** — unknown keys on a record are accepted and kept inline on the validated record (see `packages/domain/src/import-validate.ts`). The schemas declare `onUndeclaredKey("ignore")`, so arktype does not strip them; they round-trip naturally on the next export.
- **Migrate forward** — older `version` fields are passed through `migrateImportData` in `packages/domain/src/import-migrate.ts` before schema validation.
- **Skip-not-fail (with no-blank guarantee)** — records that fail required-field validation are skipped with a per-record diagnostic; the rest of the import still proceeds. If every record in a collection fails, that collection is omitted from the storage writes so existing data is not overwritten with `[]`.
