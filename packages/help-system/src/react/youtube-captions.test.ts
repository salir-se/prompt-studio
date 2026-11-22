// @module-tag dom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { connectYouTubeCaptions } from './youtube-captions';

function setup() {
  const frame = document.createElement('iframe');
  // A local document creates a real child window without enabling iframe network loading.
  frame.srcdoc = '<!doctype html><html><body></body></html>';
  document.body.append(frame);
  const send = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const disconnect = connectYouTubeCaptions(frame, { languageCode: 'ru', kind: 'asr' }, 'sv-SE');
  onTestFinished(() => {
    disconnect();
    send.mockRestore();
    frame.remove();
  });
  const receive = (
    event: string,
    info?: unknown,
    origin = 'https://www.youtube-nocookie.com',
    source: MessageEventSource | null = frame.contentWindow,
  ) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data: JSON.stringify({ event, info }) }));
  };
  return { frame, send, receive, disconnect };
}

describe('YouTube translated captions', () => {
  it('requests the authored source track translated to the browser language when playback starts', () => {
    const { send, receive, disconnect } = setup();
    receive('onStateChange', 1);
    expect(send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'command',
        func: 'setOption',
        args: [
          'captions',
          'track',
          { languageCode: 'ru', kind: 'asr', translationLanguage: { languageCode: 'sv', languageName: 'svenska' } },
        ],
      }),
      'https://www.youtube-nocookie.com',
    );
    const calls = send.mock.calls.length;
    receive('onStateChange', 1);
    expect(send).toHaveBeenCalledTimes(calls);
    disconnect();
  });

  it('ignores spoofed origins, unrelated windows, and malformed JSON', () => {
    const { send, receive, disconnect } = setup();
    send.mockClear();
    receive('onStateChange', 1, 'https://evil.com');
    receive('onStateChange', 1, 'https://www.youtube-nocookie.com', window);
    window.dispatchEvent(new MessageEvent('message', { data: '{' }));
    expect(send).not.toHaveBeenCalled();
    disconnect();
  });

  it('removes both listeners when the player closes', () => {
    const { frame, send, receive, disconnect } = setup();
    disconnect();
    send.mockClear();
    frame.dispatchEvent(new Event('load'));
    receive('onStateChange', 1);
    expect(send).not.toHaveBeenCalled();
  });
});

it('selects translated captions again after a same-video start-offset reload', () => {
  const { frame, send, receive, disconnect } = setup();
  receive('onStateChange', 1);
  send.mockClear();
  // Opening another timestamp changes iframe src without replacing the iframe element.
  frame.dispatchEvent(new Event('load'));
  send.mockClear();
  receive('onStateChange', 1);
  expect(send).toHaveBeenCalledWith(expect.stringContaining('"func":"setOption"'), 'https://www.youtube-nocookie.com');
  disconnect();
});
