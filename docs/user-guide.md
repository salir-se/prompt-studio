# Prompt Studio user guide

[Back to README](../README.md)

## Project workflow

1. Launch `prompt-studio`. The project entry offers **Create project**, **Open project**, and recent projects. Create a project, then choose **New prompt**
   to create the first prompt. An empty project is valid; no placeholder prompt is required.
2. To continue existing work, enter a local Git repository path or an HTTPS Git repository URL in
   **Repository URL or filesystem path**, optionally select **Source branch**, then choose **Open project**.
   This can reopen a previously published branch. The editor makes an isolated in-memory copy. It never modifies
   the source checkout, its index, or its branch. **Recent projects** resumes saved work.
3. Create a prompt and write in **Write**; preview the draft and choose **Apply changes** (Ctrl/Cmd+S or Ctrl/Cmd+Enter).
   **Explorer** searches prompts and exposes a keyboard-operable section tree. Its actions add named sections,
   reorder, remove, edit, and design sub-prompts. Browsing preserves unapplied writing. On narrow screens,
   Explorer opens as a side drawer: search is focused; Close or Escape returns to your work.
   **Graph** and **Design** offer alternate views. **Variables** and **Tools** hold project-owned definitions;
   upload/download their JSON files there. Imports preview new names and conflicts before applying changes.
   The status bar counts placeholders without a declaration in project **Variables** or the open prompt's **Design**.
   Tool definitions describe availability; they do not grant runtime permissions. **Browse MCP tools** imports a discovered schema.
   In **App settings → MCP servers**, register an HTTP(S) endpoint and discover its tools. **Run → Tool responses**
   chooses predefined JSON mocks or explicit real calls; test cases can override those choices. Calls and their modes
   appear in captured run/evaluation details. Bearer tokens stay in server memory.
   Unapplied writing, Design, Variables, and Tools changes require confirmation before leaving the editor; keep the tab open
   to preserve them. Invalid schema JSON stays visible with an error and cannot be saved as the previous schema.
4. Applied edits use one project save path. **Saving changes…** becomes **Saved on this computer** after the recovery
   snapshot is written. **Versions → Save version** records a Git commit; version history can restore an earlier document
   through a new commit. Failed saves keep the pending work available for retry instead of claiming success.
   Saved versions belongs to the selected project and revision. Final prompt shows sample values in its preview while
   the editor and saved Markdown retain the original placeholders.
5. **Export project** downloads the current project files as JSON. **Import project** previews that archive and
   creates a separate project, preserving the currently open project. Prompt text, design data, variables, tools,
   unrelated files, and executable-file modes travel together; Git history and authentication do not.
   Export first saves pending edits and checks the selected project and revision. If another tab changes the
   active project or saved revision, export stops instead of downloading that tab's project.
6. When ready to share, choose **Share**, connect GitHub, supply a **New branch** and **Pull request title**, and choose
   **Publish branch and open PR**. A project created locally first needs an existing GitHub repository URL.
   Review the returned PR link. Publishing is explicit; editing and saving never send work to GitHub by themselves.

## Run and compare prompts

Open a project prompt, then choose **Run** (Alt+4). In **Settings**, choose a provider/model, enter its API key,
and configure the absolute local folder containing your skills. Studio searches that folder for `SKILL.md` files.
Keys stay in server memory; reconnect after restarting. Attach skills in any run mode. In **Single run**, supply variable values
and choose **Run prompt** (Ctrl/Cmd+Enter). The captured output, prompt and reference snapshots stay in local history.
Opening Run preserves an unapplied writing draft; the request captures its current text.

Open **Evaluations** (Alt+5) for a bottom panel where **Test suites** saves input cases and output checks. Expand or minimize it without losing drafts; desktop writing stays available above it. In **Compare**, choose two Git tags or a tag and
the current draft. **Save a Git version tag** commits saved project content and creates a tag without overwriting
an existing one. Apply writing and wait for project saving before tagging. Tags remain in Studio's isolated Git copy;
creating one does not push to the source repository. Existing local/remote repository tags are offered automatically.

Run a comparison with the same suite, model, skills and current file context for both prompt versions. Optionally
supply a judge model and rubric. Per-case outputs, deterministic check results and advisory judge verdicts remain
separate and reviewable. Download an evaluation as JSON when needed. Suites/results stay on this computer and are
excluded from project exports and GitHub publication. Skills and project files supply text context; scripts and Mermaid workflows are not executed. MCP tools run only through explicitly selected real/mock bindings.

## Add a verification harness

Graph sections show automatic/AI counts before running checks, with basic/authored and Design-derived/authored
breakdowns. Click a count or activate it with the keyboard to open that section. Not checked, Current and Stale
are independent for automatic and AI review; counts never imply a passing result.
After a check, expanded sections label their finding count, such as `1 finding` or `2 findings`.

In **Checks & criteria**, choose a source-aware preset or edit an automatic check to save and recheck directly.
AI criteria remain editable before an explicit save. Harness setup preserves the prompt; View source and Save and
recheck perform an intentional repair. Optional project AI review uses the shared Run connection and authoritative
saved profiles, capturing source/profile hashes. Closing the panel preserves review evidence in the open editor.
**Whole-prompt evaluation tests** opens the bottom panel; cases are not counted as section tests without a mapping.

## Connect GitHub

Choose **Connect GitHub**, open the displayed GitHub authorization link, and enter its one-time code. Return to
Prompt Studio while it checks authorization. The distributed app supplies a public GitHub client ID; advanced
installations can override it with `STUDIO_GITHUB_CLIENT_ID` or the connection panel's client ID field.

For an independently registered GitHub App, enable **Device flow**, grant repository **Contents: Read and write**
and **Pull requests: Read and write**, and install the app on the selected repositories. Use its **Client ID**,
not the numeric App ID. Device authorization does not use a callback URL or client secret. Access is limited by
both the user's permissions and the app's installation. See GitHub's
[device authorization documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token)
and [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

Editor authorization stays in server memory. Reconnect after restarting the program or when authorization
expires. It is never included in project files, browser storage, recovery snapshots, or exports.

## Files and recovery

Prompt documents use `prompts/<id>.md`; skills use `skills/<name>/SKILL.md`. Authored prompt Markdown retains its
embedded design metadata. Shared definitions live in `.prompt-studio/project.json` with format
`prompt-studio-project@1`, project name, serializable authored variable definitions, and tools containing
`name`, `description`, and `inputSchema`. Samples are examples, not credentials; secret/server-only variable
samples cannot contain values.

The server keeps repository contents and Git objects in memory. Its atomic local recovery file is
`~/Salir Prompt Studio/repositories/projects.json`; the installed starter folder is
`~/Salir Prompt Studio/repository`. Browser recovery journals retain failed applied edits by project identity.
Local imports preserve tracked files and their current working changes, plus new owned prompt and shared-definition files; they do
not sweep unrelated untracked files, local Git hooks, configuration credentials, or the source's staged index
into a Studio commit. These recovery files are local data, not remote backups.

Each editor keeps its own browser recovery journal. Saving in one tab cannot erase another tab's pending edits.
Available journals from earlier editors can be recovered explicitly: Studio copies the selected backup into the
current editor and retains the original until you remove it. If browser storage fills up, keep the tab open and
download the recovered changes before closing it.

Separate running instances cannot replace a recovery snapshot they have not loaded. If another instance saves,
preserve any pending changes and restart to load that saved work before retrying. Saving briefly creates
`~/Salir Prompt Studio/repositories/projects.lock`. A process crash can leave this lock behind: close **all**
Prompt Studio processes before removing only `projects.lock`, then restart. Keep `projects.json`; it holds your work.

The portable archive uses `prompt-studio-project-files@1`: a project name and `files` entries with `path`,
`base64`, and optional regular/executable `mode`. Import validates all entries before replacing any active state.
It rejects traversal, Git metadata, invalid definitions, and duplicate paths.

## Current limits

- Open repositories must use ordinary Git layouts. Linked worktrees and symbolic links are rejected explicitly.
  For a local checkout with detached HEAD, choose an explicit Source branch or switch the checkout to a named branch first.
- GitHub publication needs an existing repository with a base commit, appropriate write access, and app access.
  There is no automatic fork or merge. A remote source change or occupied branch stops publication; preserve/export
  your work, reopen the latest repository, reconcile it, and publish a new branch.
- A successful branch push followed by failed PR creation is retryable without pushing again or duplicating the PR,
  even if the source branch advances, provided the published branch still contains the recorded commit. A removed
  or changed published branch is rejected instead of being recreated or overwritten.
- Project archives are limited to 32 MiB and 10,000 files, including multi-megabyte binary files under Node and Bun.
  Malformed HTTP request targets receive an error without stopping the local server.
  HTTPS repositories outside GitHub can be opened, but
  GitHub authorization is not forwarded to those hosts and PR publication is GitHub-only.
- Automated tests run on Linux. macOS and Windows binaries are built in CI but not exercised by the test suite.
  The route outcome test exercises real Git transport against a controlled repository, including partial
  publication, concurrent branch creation, and remote divergence.


