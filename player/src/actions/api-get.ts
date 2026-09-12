import type { ApiGetAction } from '@browser-agent/shared';

export async function apiGet(_page: unknown, action: ApiGetAction): Promise<unknown> {
  const url = new URL(action.url);
  if (action.queryParams) {
    for (const [key, value] of Object.entries(action.queryParams)) url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: action.httpHeaders });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);

  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}
