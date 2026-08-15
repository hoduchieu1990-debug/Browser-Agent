import type { ExecutionError } from '@browser-agent/shared';

export function toExecutionError(actionId: string, step: number, error: unknown): ExecutionError {
  return {
    actionId,
    type: error instanceof Error ? error.constructor.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    step,
    timestamp: new Date().toISOString(),
  };
}
