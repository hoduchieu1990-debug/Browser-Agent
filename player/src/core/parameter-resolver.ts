import { resolveParams } from '@browser-agent/shared';

export function resolveAction<T extends Record<string, any>>(
  action: T,
  params: Record<string, any>,
): T {
  const resolved: Record<string, any> = { ...action };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value.includes('${')) {
      resolved[key] = resolveParams(value, params);
    }
  }
  return resolved as T;
}
