import { markAsExtensionUi } from './ui-marker';

const CONTAINER_ID = '__browser_agent_toast_container__';
const TOAST_DURATION_MS = 1600;

function getContainer(): HTMLDivElement {
  const existing = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
  if (existing) return existing;

  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  markAsExtensionUi(el);
  el.style.position = 'fixed';
  el.style.top = '16px';
  el.style.right = '16px';
  el.style.zIndex = '2147483647';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.gap = '6px';
  el.style.pointerEvents = 'none';
  el.style.fontFamily = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';
  document.documentElement.appendChild(el);
  return el;
}

export function showToast(step: number, label: string): void {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.textContent = `✓ Step ${step}: ${label}`;
  toast.style.background = '#16213e';
  toast.style.color = '#ecf0f1';
  toast.style.borderLeft = '4px solid #2ecc71';
  toast.style.borderRadius = '4px';
  toast.style.padding = '8px 12px';
  toast.style.fontSize = '12px';
  toast.style.maxWidth = '320px';
  toast.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.35)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(10px)';
  toast.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, TOAST_DURATION_MS);
}

export function clearToasts(): void {
  document.getElementById(CONTAINER_ID)?.remove();
}
