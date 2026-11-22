# Command-line control

[Back to README](../README.md)

A running Prompt Studio can be driven from a terminal. The `ps` CLI connects to the studio over WebSocket
(`/__control/ws`, see [Remote control over WebSocket](remote-control.md)), and the studio runs each command in
an **open browser tab**. CLI edits therefore run through the editor itself (transactional writes, automatic
commits, append-only history) and appear in the tab you are looking at. The studio must be running with a tab
open.

```bash
bun run ps -- targets                                # list open editor tabs (browserId, project, document)
bun run ps -- capabilities                           # list the commands the studio accepts
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

## Several tabs

With one tab open, commands go to it. With more than one, a command without `--target` fails (exit `4`) and
lists the tabs to choose from. Pick one:

```bash
bun run ps -- targets
bun run ps -- read support-triage --target tab-3f2a…
```

A tab keeps its `browserId` when you reload it.

## Flags

| Flag | Meaning |
|---|---|
| `--json` | Print the raw JSON result. On failure, print `{"ok":false,"error":{"code":…,"message":…}}` to stdout. |
| `--target BROWSER_ID` | The tab to drive (from `ps targets`). |
| `--timeout MS` | How long to wait for the tab (default `30000`, at most `300000`). |
| `--port N` | Studio port (default `5273`). |
| `--token T` | Control token. |
| `--transport ws\|http` | `ws` (default) or the deprecated HTTP relay, for an older studio. |

stdout carries only the result; messages for people go to stderr, so `ps … --json | jq` is safe.

Authentication order: `--token`, then `PROMPT_STUDIO_CONTROL_TOKEN`, then the per-launch token file
(`<tmpdir>/prompt-studio-control-<port>.token`, written with mode `0600` by the server).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | The command failed in the tab (for example "Open the document first"). |
| `2` | Usage error or invalid parameters. |
| `3` | Cannot connect: no studio on that port, wrong token, or no common protocol version. |
| `4` | No tab is ready, the named tab does not exist, or several tabs are open and none was named. |
| `5` | The tab did not answer in time, or disconnected while the command ran. The command may have run; check before you retry a change. |

The control channel can change the open editor. Keep the studio bound to loopback.
