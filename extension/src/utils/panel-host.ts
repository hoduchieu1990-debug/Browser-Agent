import { markAsExtensionUi } from './ui-marker';

const HOST_ID = '__browser_agent_panel__';
const PANEL_WIDTH = 400;

// The toolbar popup cannot be positioned and closes the moment the page takes
// focus, so the recorder UI lives in the page instead: an iframe of the same
// extension page, docked to the right edge, that survives clicking around.
function build(): { host: HTMLDivElement; frame: HTMLIFrameElement; handle: HTMLButtonElement } {
  const host = document.createElement('div');
  host.id = HOST_ID;
  markAsExtensionUi(host);
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.right = '0';
  host.style.height = '100vh';
  host.style.zIndex = '2147483647';
  host.style.display = 'flex';
  host.style.alignItems = 'flex-start';
  host.style.pointerEvents = 'none'; // only the panel and its handle are clickable

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.title = 'Hide/show Browser Agent (Alt+Shift+B)';
  handle.style.pointerEvents = 'auto';
  handle.style.marginTop = '12px';
  handle.style.padding = '10px 4px';
  handle.style.border = 'none';
  handle.style.borderRadius = '8px 0 0 8px';
  handle.style.background = 'linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)';
  handle.style.color = '#fff';
  handle.style.font = '600 11px "Segoe UI", Tahoma, sans-serif';
  handle.style.cursor = 'pointer';
  handle.style.writingMode = 'vertical-rl';
  handle.style.boxShadow = '-2px 2px 10px rgba(0, 0, 0, 0.35)';

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('popup.html');
  frame.style.pointerEvents = 'auto';
  frame.style.width = `${PANEL_WIDTH}px`;
  frame.style.height = '100vh';
  frame.style.border = 'none';
  frame.style.borderLeft = '1px solid #322b52';
  frame.style.boxShadow = '-4px 0 24px rgba(0, 0, 0, 0.45)';
  frame.style.background = '#14121f';
  frame.style.colorScheme = 'dark';

  host.append(handle, frame);
  document.documentElement.appendChild(host);
  return { host, frame, handle };
}

let elements: ReturnType<typeof build> | null = null;
let visible = false;

function render(): void {
  if (!elements) return;
  elements.frame.style.display = visible ? 'block' : 'none';
  elements.handle.textContent = visible ? '⟩ Hide' : '⟨ Agent';
}

export function isPanelMounted(): boolean {
  return elements != null && document.documentElement.contains(elements.host);
}

export function setPanelVisible(next: boolean): void {
  if (!isPanelMounted()) {
    elements = build();
    elements.handle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPanelVisible(!visible);
    });
  }
  visible = next;
  render();
}

export function togglePanel(): void {
  setPanelVisible(!(isPanelMounted() && visible));
}

export function removePanel(): void {
  elements?.host.remove();
  elements = null;
  visible = false;
}
