import type { ApiPostAction } from '@browser-agent/shared';

export async function apiPost(_page: unknown, action: ApiPostAction): Promise<unknown> {
  const asJson = action.json ?? true;
  const response = await fetch(action.url, {
    method: 'POST',
    headers: { ...(asJson ? { 'Content-Type': 'application/json' } : {}), ...action.httpHeaders },
    body: action.body,
  });
  if (!response.ok) throw new Error(`POST ${action.url} failed: ${response.status} ${response.statusText}`);

  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}
