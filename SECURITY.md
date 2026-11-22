# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through
[GitHub private vulnerability reporting](https://github.com/salir-se/prompt-studio/security/advisories/new).

Include the affected version, steps to reproduce, and the impact you observed. We aim to acknowledge a report
within 5 business days and to agree on a disclosure date with you.

## Supported versions

Security fixes are released for the latest minor version only.

## Scope and threat model

Prompt Studio is a local, single-user tool:

- The server binds to `127.0.0.1` by default and requires a per-launch token on every API request.
- API keys and GitHub authorization are held in server memory only.
- The file bridge only reads and writes inside the opened project; paths that escape it are rejected.

Running the server on a non-loopback address (`--host 0.0.0.0`) exposes the open project to the network. That
configuration is unsupported, and reports that depend on it are out of scope unless the default configuration is
also affected.
