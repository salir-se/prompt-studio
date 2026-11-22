# Compiled cut: chapters and outro card

The compiled cut joins episodes 1–6 in order, without extra material. Timestamps below are **estimates** from the
narration (140 words per minute plus 4 seconds per scene). After rendering, replace each one with the real start time
of that scene; YouTube needs the first chapter at `0:00` and each chapter to be at least 10 seconds long.

Estimated length: about 23 minutes (episodes: 4:38, 3:47, 3:34, 3:29, 3:48, 3:30).

## YouTube chapters

```text
0:00 What you will build
0:50 Start from the outcome
1:27 Create the prompt, its tool and its variable
2:55 Input and output contracts (JSON Schema)
3:55 The agent reads the contract
4:38 Let the agent draft
5:26 Review the structure in the graph
6:27 Spot the gap: untrusted input
6:51 Section edits instead of rewrites
7:44 History: every edit is a commit
8:25 Choose an architecture
8:42 The workflow pattern catalog
9:51 The agent tailors the workflow
10:50 Sub-prompt designs per section
11:59 Contracts and tools
12:20 A sample that fails, a sample that passes
13:17 Variables and tool definitions
14:01 Mocked tool responses
14:36 A real MCP tool call
15:28 Verify and test
15:49 Automatic checks
16:17 The agent proposes checks, you accept
17:13 AI review finds a gap
17:39 Fix the prompt, not the check
18:07 Edge cases first: the test suite
19:16 Change safely and ship
19:31 Tag the known-good version
20:12 Compare v1 with the draft
20:33 The judge catches a regression
21:28 The agent fixes it
21:51 Save a version and open a pull request
22:17 Checklist
```

## Outro checklist card

Shown at the end of episode 6 and of the compiled cut. Title: **Prompt quality checklist**.

1. Name who uses the output, and write the job in a few sentences.
2. Define input and output as JSON Schema before writing instructions.
3. Declare tools and variables with realistic samples; secrets never go in samples.
4. Let the agent draft; review the structure in the graph before the wording.
5. One concern per section; untrusted input last, inside its own tags.
6. Ask for section edits, not rewrites.
7. Write the workflow down; choose the smallest pattern; every branch ends in the output contract.
8. Verify a sample that should fail, then keep passing samples as examples.
9. Run tools with mocks first, real calls on purpose.
10. Accept every check yourself; fix findings in the prompt, not in the check.
11. Test edge cases before happy paths.
12. Tag a known-good version and compare every change against it before you merge.

Short form for a single-line overlay: `Outcome · Contract · Draft · Structure · Architecture · Samples · Mocks · Checks · Edge cases · Compare`.
