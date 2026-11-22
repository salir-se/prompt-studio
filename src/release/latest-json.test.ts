// @module-tag pure
import { describe, expect, it } from 'vitest';
import { buildLatestJson, objectKey } from './latest-json';

describe('buildLatestJson', () => {
  it('names the version, the asset name per machine, and their checksums', () => {
    // Given: one built file for each machine
    const files = {
      'macos-arm64': new Uint8Array([1, 2, 3]),
      'macos-x64': new Uint8Array([4, 5]),
      'linux-x64': new Uint8Array([7, 8]),
      'windows-x64': new Uint8Array([6]),
    };
    // When: the release publishes latest.json
    const latest = buildLatestJson('1.2.3', files);
    // Then: each machine has its release asset name and a checksum of its own bytes
    expect(latest.version).toBe('1.2.3');
    expect(latest.objects['macos-arm64'].key).toBe(objectKey('1.2.3', 'macos-arm64'));
    expect(latest.objects['macos-arm64'].key).toBe('prompt-studio-macos-arm64');
    expect(latest.objects['macos-x64'].key).toBe('prompt-studio-macos-x64');
    expect(latest.objects['windows-x64'].key).toBe('prompt-studio-windows-x64.exe');
    expect(latest.objects['macos-arm64'].sha256).not.toBe(latest.objects['macos-x64'].sha256);
    expect(latest.objects['windows-x64'].sha256).toHaveLength(64);
  });
});
