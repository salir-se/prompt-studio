// @module-tag pure
import { describe, expect, it } from 'vitest';
import { findFingerprintedLines, findMarkers, lineFingerprint } from './check-public-content';

describe('findMarkers', () => {
  it('reports an internal host and a private key header', () => {
    // Given: text that names an internal host and contains a private key header
    const text = "fetch('https://ai.salir.se');\n-----BEGIN OPENSSH PRIVATE KEY-----";
    // When: the scan reads it
    // Then: both markers are reported
    expect(findMarkers(text)).toEqual(['ai.salir.se', 'BEGIN OPENSSH PRIVATE KEY']);
  });

  it('passes neutral prompt text', () => {
    // Given: the starter example's kind of content
    // When / Then: nothing is reported
    expect(findMarkers('You are the support triage assistant for {{company_name}}.')).toEqual([]);
  });
});

describe('findFingerprintedLines', () => {
  it('reports a fingerprinted line regardless of indentation', () => {
    // Given: a fingerprint of one long prose line
    const secret = 'This is a long private prompt line that must never be published again.';
    const fingerprints = new Set([lineFingerprint(secret)]);
    // When: a file contains that line with different indentation
    const text = `first line\n    ${secret}\nlast line`;
    // Then: the scan reports its line number
    expect(findFingerprintedLines(text, fingerprints)).toEqual([2]);
  });

  it('ignores short lines even when their hash matches', () => {
    // Given: a fingerprint of a short line
    const fingerprints = new Set([lineFingerprint('short')]);
    // When / Then: short lines are never reported
    expect(findFingerprintedLines('short', fingerprints)).toEqual([]);
  });
});
