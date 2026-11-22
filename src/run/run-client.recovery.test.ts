// @module-tag pure
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { runPost } from './run-client';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
afterEach(() => vi.resetAllMocks());

it('does not query recovery after a successful start', async () => {
  request.mockResolvedValue({ run: { runId: 'saved' } });
  await expect(runPost('', { runId: 'saved' }, '/__studio/run/saved?projectId=example')).resolves.toEqual({
    run: { runId: 'saved' },
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves the original start failure when no accepted run can be recovered', async () => {
  const original = new Error('The prompt has a missing reference.');
  request.mockRejectedValueOnce(original).mockRejectedValueOnce(new Error('Run not found.'));
  await expect(runPost('', { runId: 'saved' }, '/__studio/run/saved?projectId=example')).rejects.toBe(original);
  expect(request).toHaveBeenCalledTimes(2);
});
