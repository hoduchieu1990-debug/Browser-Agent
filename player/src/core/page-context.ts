import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import type { PlayerOptions } from '../types';

export class PageContext {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private options: PlayerOptions) {}

  async launch(): Promise<Page> {
    // Running several workflows through one player must not start (and orphan)
    // a browser per run — batch jobs would leak one process per input.
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) return this.page;
    await this.close();

    const browserType = this.options.browser ?? 'chromium';
    // Edge is Chromium under the hood — Playwright drives the system-installed
    // build via the "msedge" channel instead of its own bundled binary.
    const engine = { chromium, firefox, webkit, edge: chromium }[browserType];
    this.browser = await engine.launch({
      channel: browserType === 'edge' ? 'msedge' : undefined,
      headless: this.options.headless ?? true,
      slowMo: this.options.slowMo,
      args: this.options.args,
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.options.timeout ?? 10000);
    return this.page;
  }

  getPage(): Page {
    if (!this.page) throw new Error('Browser not launched. Call launch() first.');
    return this.page;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }
}
