#!/usr/bin/env bun
/**
 * Fails when a tracked file contains content of the original private build.
 *
 * Two checks run on every tracked text file:
 * 1. Markers: internal hosts, the private repository, and private-key headers.
 * 2. Fingerprints: `private-content-fingerprints.json` holds truncated SHA-256 hashes of every prose line of the
 *    private build's prompts and skills (whitespace-normalized, 50+ characters). A tracked line with a matching
 *    hash is private prompt text. The hashes do not reveal the text.
 *
 * Run in CI on every pull request and before every release.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PRIVATE_CONTENT_MARKERS: readonly string[] = [
  'salir.one',
  'ai.salir.se',
  'github.com/salir-se/salir.git',
  'github.com/salir-se/salir/',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'AGE-SECRET-KEY-',
];

const EXEMPT = new Set([
  'scripts/check-public-content.ts',
  'scripts/check-public-content.test.ts',
  'scripts/private-content-fingerprints.json',
]);

export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

export function lineFingerprint(line: string): string {
  return createHash('sha256').update(normalizeLine(line)).digest('hex').slice(0, 24);
}

export function findMarkers(text: string): string[] {
  return PRIVATE_CONTENT_MARKERS.filter((marker) => text.includes(marker));
}

/** 1-based line numbers whose fingerprint is in `fingerprints`. */
export function findFingerprintedLines(text: string, fingerprints: ReadonlySet<string>): number[] {
  const hits: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (normalizeLine(line).length >= 50 && fingerprints.has(lineFingerprint(line))) hits.push(index + 1);
  });
  return hits;
}

if (import.meta.main) {
  const fingerprintFile = path.join(import.meta.dirname, 'private-content-fingerprints.json');
  const fingerprints = new Set<string>(JSON.parse(readFileSync(fingerprintFile, 'utf8')) as string[]);
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems: string[] = [];
  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const marker of findMarkers(text)) problems.push(`${file}: contains "${marker}"`);
    const lines = findFingerprintedLines(text, fingerprints);
    if (lines.length > 0) problems.push(`${file}: private prompt text on line(s) ${lines.slice(0, 10).join(', ')}`);
  }
  if (problems.length > 0) {
    process.stderr.write(`Private content found:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`No private content in ${files.length} tracked files.\n`);
}
