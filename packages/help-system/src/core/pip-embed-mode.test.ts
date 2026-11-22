// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPipEmbedMode, pipEmbedMode } from './pip-embed-mode';

describe('pipEmbedMode', () => {
  it('embeds when isolated and credentialless iframes are supported', () => {
    expect(pipEmbedMode({ crossOriginIsolated: true, iframeCredentiallessSupported: true })).toBe('embed');
  });

  it('falls back to link-out when isolated but credentialless iframes are NOT supported (e.g. Firefox today)', () => {
    // The one dangerous combination: COEP would block the embed outright. Firefox has supported
    // COEP `credentialless` since Firefox 119 but has not shipped the iframe `credentialless`
    // attribute, so it hits this branch until it does.
    expect(pipEmbedMode({ crossOriginIsolated: true, iframeCredentiallessSupported: false })).toBe('link-out');
  });

  it('embeds when not isolated, regardless of credentialless support (e.g. Safari)', () => {
    expect(pipEmbedMode({ crossOriginIsolated: false, iframeCredentiallessSupported: true })).toBe('embed');
  });

  it('embeds when not isolated and credentialless iframes are unsupported', () => {
    expect(pipEmbedMode({ crossOriginIsolated: false, iframeCredentiallessSupported: false })).toBe('embed');
  });
});

describe('detectPipEmbedMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLIFrameElement.prototype as { credentialless?: unknown }).credentialless;
  });

  it('embeds when isolated and the browser supports the credentialless iframe attribute', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', { value: '', configurable: true });

    expect(detectPipEmbedMode()).toBe('embed');
  });

  it('falls back to link-out when isolated and the credentialless iframe attribute is absent (e.g. Firefox today)', () => {
    vi.stubGlobal('crossOriginIsolated', true);

    expect(detectPipEmbedMode()).toBe('link-out');
  });

  it('embeds when not isolated (false or undefined), regardless of credentialless support', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', { value: '', configurable: true });
    expect(detectPipEmbedMode()).toBe('embed');

    vi.unstubAllGlobals();
    expect(detectPipEmbedMode()).toBe('embed'); // crossOriginIsolated is undefined by default in happy-dom
  });
});
