import type { Page } from 'playwright';
import type { ExecutionContext } from '@browser-agent/shared';

export * from '@browser-agent/shared';

export interface PlayerOptions {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit' | 'edge';
  timeout?: number;
  debug?: boolean;
  slowMo?: number;
  args?: string[];
}

export interface ExecutionOptions {
  headless?: boolean;
  outputDir?: string;
  screenshot?: boolean;
  verbose?: boolean;
  timeout?: number;
}

export interface RunContext extends ExecutionContext {
  outputDir: string;
}

export type ActionHandler = (page: Page, action: any, context: RunContext) => Promise<any>;
