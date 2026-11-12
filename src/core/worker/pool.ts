import { OperationCancelledError, WorkerTimeoutError, PaperweightError } from '../errors';
import type { ProgressReport } from '../types';
import type { CancellationToken } from './cancellation';
import type { WorkerJob, WorkerTaskType, WorkerStats } from './types';

interface ActiveSlot {
  job: WorkerJob;
  worker?: Worker;
  timerId?: ReturnType<typeof setTimeout>;
  unsubscribeCancel?: () => void;
}

export class WorkerPool {
  private static instance: WorkerPool | null = null;
  private readonly maxWorkers: number;
  private queue: WorkerJob[] = [];
  private activeSlots = new Map<string, ActiveSlot>();
  private totalJobsProcessed = 0;
  private isDisposed = false;

  constructor(maxWorkers?: number) {
    const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    // Default to hardwareConcurrency - 1 (leave 1 thread for main UI responsiveness, min 1)
    this.maxWorkers = maxWorkers ?? Math.max(1, Math.min(hardware - 1, 8));
  }

  public static getInstance(): WorkerPool {
    if (!WorkerPool.instance) {
      WorkerPool.instance = new WorkerPool();
    }
    return WorkerPool.instance;
  }

  public getStats(): WorkerStats {
    return {
      totalJobsProcessed: this.totalJobsProcessed,
      activeWorkers: this.activeSlots.size,
      queuedJobs: this.queue.length,
      maxWorkers: this.maxWorkers,
    };
  }

  /**
   * Enqueues a job for background processing with progress reporting, timeout, and cancellation support.
   */
  public execute<TInput, TOutput>(options: {
    type: WorkerTaskType;
    payload: TInput;
    transferables?: Transferable[];
    timeoutMs?: number;
    cancellationToken?: CancellationToken;
    onProgress?: (report: ProgressReport) => void;
  }): Promise<TOutput> {
    if (this.isDisposed) {
      return Promise.reject(
        new PaperweightError({
          code: 'ERR_POOL_DISPOSED',
          title: 'Worker Pool Inactive',
          message: 'The worker pool has been shut down.',
        })
      );
    }

    if (options.cancellationToken?.isCancelled) {
      return Promise.reject(new OperationCancelledError());
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return new Promise<TOutput>((resolve, reject) => {
      const job: WorkerJob<TInput, TOutput> = {
        id: jobId,
        type: options.type,
        payload: options.payload,
        transferables: options.transferables,
        timeoutMs: options.timeoutMs ?? 120_000, // 2 minutes default guard
        cancellationToken: options.cancellationToken,
        onProgress: options.onProgress,
        resolve: resolve as (val: unknown) => void,
        reject,
        createdAt: Date.now(),
      };

      // If cancelled while queued
      if (options.cancellationToken) {
        const unsubscribe = options.cancellationToken.onCancelled(() => {
          this.removeQueuedJob(jobId);
          reject(new OperationCancelledError());
          unsubscribe();
        });
      }

      this.queue.push(job as WorkerJob);
      this.drainQueue();
    });
  }

  private removeQueuedJob(jobId: string): boolean {
    const idx = this.queue.findIndex((j) => j.id === jobId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  private drainQueue(): void {
    if (this.isDisposed) return;

    while (this.activeSlots.size < this.maxWorkers && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      // Check if job was cancelled right before start
      if (job.cancellationToken?.isCancelled) {
        job.reject(new OperationCancelledError());
        continue;
      }

      this.runJob(job);
    }
  }

  private runJob(job: WorkerJob): void {
    const slot: ActiveSlot = { job };
    this.activeSlots.set(job.id, slot);

    // Setup cancellation listener during active execution
    if (job.cancellationToken) {
      slot.unsubscribeCancel = job.cancellationToken.onCancelled(() => {
        this.terminateJob(job.id, new OperationCancelledError());
      });
    }

    // Setup timeout guard
    if (job.timeoutMs && job.timeoutMs > 0) {
      slot.timerId = setTimeout(() => {
        this.terminateJob(job.id, new WorkerTimeoutError(job.type));
      }, job.timeoutMs);
    }

    // Skeleton execution: in Phase 1 this simulates or executes inline/mock tasks.
    // In Phase 2+, dedicated Web Workers are spawned or pulled from worker pool.
    this.executeInWorker(slot);
  }

  private executeInWorker(slot: ActiveSlot): void {
    const { job } = slot;

    // Report initial progress
    job.onProgress?.({
      taskId: job.id,
      phase: 'starting',
      current: 0,
      total: 100,
      percentage: 0,
      message: `Initializing ${job.type}...`,
    });

    // Baseline fallback execution for skeleton verification
    const timer = setTimeout(() => {
      try {
        if (job.cancellationToken?.isCancelled) {
          throw new OperationCancelledError();
        }

        job.onProgress?.({
          taskId: job.id,
          phase: 'completed',
          current: 100,
          total: 100,
          percentage: 100,
          message: 'Complete',
        });

        this.finishJob(job.id, job.payload);
      } catch (err) {
        this.failJob(job.id, err);
      }
    }, 10);

    // Keep reference so cancel can clear timeout if in mock phase
    slot.timerId = timer;
  }

  private finishJob(jobId: string, result: unknown): void {
    const slot = this.activeSlots.get(jobId);
    if (!slot) return;

    this.cleanupSlot(slot);
    this.activeSlots.delete(jobId);
    this.totalJobsProcessed++;

    slot.job.resolve(result);
    this.drainQueue();
  }

  private failJob(jobId: string, error: unknown): void {
    const slot = this.activeSlots.get(jobId);
    if (!slot) return;

    this.cleanupSlot(slot);
    this.activeSlots.delete(jobId);

    slot.job.reject(error);
    this.drainQueue();
  }

  private terminateJob(jobId: string, reason: Error): void {
    const slot = this.activeSlots.get(jobId);
    if (!slot) return;

    if (slot.worker) {
      try {
        slot.worker.terminate();
      } catch (e) {
        console.warn('Worker termination warning:', e);
      }
    }

    this.cleanupSlot(slot);
    this.activeSlots.delete(jobId);

    slot.job.reject(reason);
    this.drainQueue();
  }

  private cleanupSlot(slot: ActiveSlot): void {
    if (slot.timerId) {
      clearTimeout(slot.timerId);
      slot.timerId = undefined;
    }
    if (slot.unsubscribeCancel) {
      slot.unsubscribeCancel();
      slot.unsubscribeCancel = undefined;
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    for (const job of this.queue) {
      job.reject(new OperationCancelledError('Worker pool disposed'));
    }
    this.queue = [];

    for (const [, slot] of this.activeSlots) {
      if (slot.worker) {
        slot.worker.terminate();
      }
      this.cleanupSlot(slot);
      slot.job.reject(new OperationCancelledError('Worker pool disposed'));
    }
    this.activeSlots.clear();
  }
}
