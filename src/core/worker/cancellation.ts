/**
 * Cooperative cancellation token system
 * Allows cancelling long-running batch operations and web worker tasks gracefully.
 */

import { OperationCancelledError } from '../errors';

export interface CancellationToken {
  readonly isCancelled: boolean;
  throwIfCancelled(): void;
  onCancelled(callback: () => void): () => void;
}

export class CancellationTokenSource {
  private _isCancelled = false;
  private readonly _listeners = new Set<() => void>();

  public readonly token: CancellationToken;

  constructor() {
    this.token = {
      get isCancelled(): boolean {
        return self._isCancelled;
      },
      throwIfCancelled: (): void => {
        if (this._isCancelled) {
          throw new OperationCancelledError();
        }
      },
      onCancelled: (callback: () => void): (() => void) => {
        if (this._isCancelled) {
          callback();
          return () => {};
        }
        this._listeners.add(callback);
        return () => {
          this._listeners.delete(callback);
        };
      },
    };
    const self = this;
  }

  public cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error during cancellation callback:', err);
      }
    }
    this._listeners.clear();
  }

  public dispose(): void {
    this._listeners.clear();
  }
}

export const CancellationTokenNone: CancellationToken = {
  isCancelled: false,
  throwIfCancelled: () => {},
  onCancelled: () => () => {},
};
