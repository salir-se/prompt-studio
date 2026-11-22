# Command-line control

[Back to README](../README.md)

A running Prompt Studio exposes a control channel. The CLI is a thin client for `POST /__control/command`; the
studio relays each command to the **open browser tab**. CLI edits therefore run through the editor itself
(transactional writes, automatic commits, append-only history) and appear in the tab you are looking at. The
studio must be running with a tab open.

```bash
bun run ps -- docs                                   # list every document
bun run ps -- read support-triage                    # print a document
bun run ps -- open support-triage                    # open a document in the editor tab
bun run ps -- edit support-triage --file new.md --message "tighten urgency rules"
bun run ps -- history support-triage                 # the document's commits, newest first
bun run ps -- configs                                # list configurations (active marked with *)
bun run ps -- new-config Trial                       # create a configuration
bun run ps -- use-config trial                       # switch the active configuration
bun run ps -- reset support-triage                   # reset the open document to its saved baseline
```

With the npm package, use `bunx @salir-se/prompt-studio-cli <command>` instead of `bun run ps --`.

Global flags: `--json` (raw results), `--port N` (default `5273`), `--token T`.
Authentication order: `--token`, then `PROMPT_STUDIO_CONTROL_TOKEN`, then the per-launch token file
(`<tmpdir>/prompt-studio-control-<port>.token`, written with mode `0600` by the server).

The control channel can change the open editor. Keep the studio bound to loopback.
