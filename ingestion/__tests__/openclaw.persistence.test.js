import { describe, expect, it, vi } from 'vitest';

import { renameWithRetry, runOrchestrator, saveCompiledCases } from '../openclaw.mjs';

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('openclaw persistence safeguards', () => {
  it('retries Windows-style rename locks and eventually succeeds', async () => {
    const rename = vi.fn()
      .mockRejectedValueOnce(makeError('EPERM', 'file is locked'))
      .mockRejectedValueOnce(makeError('EACCES', 'access denied'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const attemptCount = await renameWithRetry('db.tmp', 'db.json', {
      fileOps: { rename },
      sleepFn,
      retryDelayMs: 25,
    });

    expect(attemptCount).toBe(3);
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 25);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 25);
  });

  it('cleans up the temp file and rethrows when rename retries are exhausted', async () => {
    const fileOps = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockRejectedValue(makeError('EPERM', 'still locked')),
      rm: vi.fn().mockResolvedValue(undefined),
    };
    const logFn = vi.fn().mockResolvedValue(undefined);

    await expect(saveCompiledCases([{ _id: 1 }], {
      dbPath: 'tmp/compiled_cases.json',
      fileOps,
      logFn,
      sleepFn: vi.fn().mockResolvedValue(undefined),
      rotateBackupsFn: vi.fn().mockResolvedValue(undefined),
      backupIntervalMs: Number.POSITIVE_INFINITY,
      nowFn: () => 0,
    })).rejects.toThrow('still locked');

    expect(fileOps.writeFile).toHaveBeenCalledOnce();
    expect(fileOps.rename).toHaveBeenCalledTimes(5);
    expect(fileOps.rm).toHaveBeenCalledWith('tmp/compiled_cases.json.tmp', { force: true });
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining('Fatal: Cannot save DB!'));
  });

  it('aborts the orchestrator after a checkpoint save failure', async () => {
    const dataset = [
      { _id: 1, value: 'a' },
      { _id: 2, value: 'b' },
    ];
    const clawFn = vi.fn(async (item) => ({
      success: true,
      data: { value: `${item.value}-patched` },
    }));
    const saveFn = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(runOrchestrator(
      'test_abort_on_save_failure',
      dataset,
      () => true,
      clawFn,
      { BATCH_SIZE: 1, DELAY_MS: 0, saveFn },
    )).rejects.toThrow('disk full');

    expect(clawFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(dataset[0].value).toBe('a-patched');
    expect(dataset[1].value).toBe('b');
  });
});
