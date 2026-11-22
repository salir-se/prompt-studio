/**
 * Where Prompt Studio is installed, and the page that packages that install.
 *
 * The functions below are pasted into the install page with Function.toString().
 * They must not call anything defined outside this file except the language itself.
 * install.sh and install.ps1 are built from the same functions, so the terminal
 * command and the downloaded zip put the program on PATH in the same place.
 */

/** Shell lines that save the Mac program, the credential, and PATH. */
export function unixInstallCommands(placeBinary: string, placeCredential: string): string {
  return [
    'mkdir -p "$HOME/.local/bin" "$HOME/.config/prompt-studio"',
    placeBinary,
    'chmod 755 "$HOME/.local/bin/prompt-studio"',
    placeCredential,
    'path_line=\'export PATH="$HOME/.local/bin:$PATH"\'',
    'for profile in "$HOME/.zprofile" "$HOME/.bash_profile"; do',
    '  touch "$profile"',
    '  if ! grep -qxF "$path_line" "$profile"; then',
    '    printf \'\\n%s\\n\' "$path_line" >> "$profile"',
    '  fi',
    'done',
    'echo "Prompt Studio is installed. Next time, run: prompt-studio"',
  ].join('\n');
}

/** PowerShell lines that create the Windows folder the credential and the program share. */
export function windowsDirectory(): string {
  return [
    "$dir = Join-Path $env:LOCALAPPDATA 'Prompt Studio'",
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
  ].join('\n');
}

/** PowerShell lines that put that folder on the user Path. */
export function windowsPathUpdate(): string {
  return [
    "$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if (-not $userPath) { $userPath = '' }",
    'if ($userPath -notlike "*$dir*") {',
    '  $joined = if ($userPath.Length -gt 0) { "$dir;$userPath" } else { $dir }',
    "  [Environment]::SetEnvironmentVariable('Path', $joined, 'User')",
    '}',
    "Write-Output 'Prompt Studio is installed. Next time, run: prompt-studio'",
  ].join('\n');
}

/** Installer inside the Windows zip. It copies the files beside it and updates Path. */
export function windowsZipScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$here = Split-Path -Parent $MyInvocation.MyCommand.Path',
    windowsDirectory(),
    "Copy-Item -Force (Join-Path $here 'prompt-studio.exe') (Join-Path $dir 'prompt-studio.exe')",
    "Copy-Item -Force (Join-Path $here 'credential') (Join-Path $dir 'credential')",
    windowsPathUpdate(),
  ].join('\n');
}

/** Zip of stored entries. `mode` is a Unix st_mode, for example 0o100755. */
export function storeZip(entries: readonly { name: string; data: Uint8Array; mode: number }[]): Uint8Array {
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) {
      crc ^= data[index] ?? 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 0x0314, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, entry.mode << 16, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}

/**
 * The file the Download button saves. The signed URL is not inside it.
 * The zip holds the program, the update credential, and a script that copies
 * both into place and puts the program on PATH.
 */
export function buildInstallZip(input: { bytes: Uint8Array; credential: string; platform: string }): Uint8Array {
  const windows = input.platform === 'windows-x64';
  const binaryName = windows ? 'prompt-studio.exe' : 'prompt-studio';
  const scriptName = windows ? 'install.ps1' : 'install.command';
  const script = windows
    ? windowsZipScript()
    : `#!/bin/sh\nset -eu\nhere=$(CDPATH= cd -- "$(dirname "$0")" && pwd)\n${unixInstallCommands('cp "$here/prompt-studio" "$HOME/.local/bin/prompt-studio"', 'cp "$here/credential" "$HOME/.config/prompt-studio/credential"')}\n`;
  const encoder = new TextEncoder();
  return storeZip([
    { name: binaryName, data: input.bytes, mode: 0o100755 },
    { name: 'credential', data: encoder.encode(input.credential), mode: 0o100644 },
    { name: scriptName, data: encoder.encode(script), mode: 0o100755 },
  ]);
}

/** Source pasted into the install page so the button runs this installer, not a second copy. */
export function installPageRuntime(): string {
  return [unixInstallCommands, windowsDirectory, windowsPathUpdate, windowsZipScript, storeZip, buildInstallZip]
    .map((fn) => fn.toString())
    .join('\n');
}
