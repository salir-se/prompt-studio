// @module-tag dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubConnection } from './GithubConnection';
import { studioJson } from './prompt-repo-client';

vi.mock('./prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  localStorage.clear();
});

async function start() {
  request.mockResolvedValueOnce({ ok: true, configured: true, connected: false });
  render(<GithubConnection />);
  await act(async () => {});
}

describe('GithubConnection', () => {
  it('retries an unavailable status without asking the user to configure an app', async () => {
    request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, configured: true, connected: false });
    render(<GithubConnection />);
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: /client ID/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection status' }));
    await act(async () => {});
    expect(request).toHaveBeenLastCalledWith('/__studio/github/status');
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });

  it('authorizes in the browser, respects slow polling, and notifies the project when connected', async () => {
    vi.useFakeTimers();
    const onConnected = vi.fn();
    request
      .mockResolvedValueOnce({ ok: true, configured: true, connected: false })
      .mockResolvedValueOnce({
        ok: true,
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        interval: 5,
      })
      .mockResolvedValueOnce({ ok: true, status: 'pending', interval: 10 })
      .mockResolvedValueOnce({ ok: true, status: 'connected', login: 'octocat' });
    render(<GithubConnection onConnected={onConnected} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await act(async () => {});
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open GitHub sign-in' })).toHaveAttribute(
      'href',
      'https://github.com/login/device',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(request).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(onConnected).toHaveBeenCalledOnce();
    expect(screen.queryByText('ABCD-EFGH')).not.toBeInTheDocument();
  });

  it('cancels sign-in and ignores a poll that finishes afterwards', async () => {
    vi.useFakeTimers();
    await start();
    let complete: (value: unknown) => void = () => {};
    request.mockResolvedValueOnce({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: Date.now() + 900_000,
      interval: 5,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await act(async () => {});
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    request.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    await act(async () => {
      complete({ ok: true, status: 'connected', login: 'late-user' });
    });
    expect(request).toHaveBeenLastCalledWith('/__studio/github/disconnect', { method: 'POST' });
    expect(screen.queryByText('late-user')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });

  it('offers one-time public app setup only when unconfigured and preserves entered ID on failure', async () => {
    request.mockResolvedValueOnce({ ok: true, configured: false, connected: false });
    render(<GithubConnection />);
    await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: /GitHub App client ID/ }), {
      target: { value: 'Iv1.public' },
    });
    request.mockRejectedValueOnce(new Error('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect to GitHub');
    expect(screen.getByRole('textbox', { name: /GitHub App client ID/ })).toHaveValue('Iv1.public');
    expect(request).toHaveBeenLastCalledWith('/__studio/github/device', {
      method: 'POST',
      body: '{"clientId":"Iv1.public"}',
    });
  });
});
