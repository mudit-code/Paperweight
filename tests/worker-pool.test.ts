import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerPool } from '../src/core/worker/pool';
import { CancellationTokenSource } from '../src/core/worker/cancellation';
import { OperationCancelledError } from '../src/core/errors';

describe('WorkerPool & Cancellation', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool(2);
  });

  afterEach(() => {
    pool.dispose();
  });

  it('reports progress and completes execution', async () => {
    const progressReports: number[] = [];

    const result = await pool.execute({
      type: 'noop',
      payload: { test: true },
      onProgress: (report) => {
        progressReports.push(report.percentage);
      },
    });

    expect(result).toEqual({ test: true });
    expect(progressReports).toContain(0);
    expect(progressReports).toContain(100);
  });

  it('cancels queued job before execution', async () => {
    const cancelSource = new CancellationTokenSource();
    cancelSource.cancel();

    await expect(
      pool.execute({
        type: 'noop',
        payload: { test: true },
        cancellationToken: cancelSource.token,
      })
    ).rejects.toThrow(OperationCancelledError);
  });

  it('cancels active job during execution', async () => {
    const cancelSource = new CancellationTokenSource();

    const promise = pool.execute({
      type: 'noop',
      payload: { test: true },
      cancellationToken: cancelSource.token,
    });

    // Cancel immediately after enqueuing
    cancelSource.cancel();

    await expect(promise).rejects.toThrow(OperationCancelledError);
  });
});
