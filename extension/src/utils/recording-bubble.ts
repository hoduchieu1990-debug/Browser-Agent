import { markAsExtensionUi } from './ui-marker';

const BUBBLE_ID = '__browser_agent_bubble__';
const DRAG_THRESHOLD_PX = 4;

export interface BubbleCallbacks {
  onStop: () => void;
}

export interface BubbleHandle {
  update: (count: number, lastLabel: string) => void;
  detach: () => void;
}

function styleButton(btn: HTMLButtonElement): void {
  btn.type = 'button';
  btn.style.border = '1px solid #d5dde8';
  btn.style.borderRadius = '6px';
  btn.style.padding = '6px 10px';
  btn.style.background = '#fbfcfe';
  btn.style.color = '#1e293b';
  btn.style.font = '500 12px system-ui, "Segoe UI", sans-serif';
  btn.style.cursor = 'pointer';
}

// The toolbar popup is gone the moment the user clicks the page, so during a
// recording session this bubble is the only piece of the recorder still on
// screen: it shows progress and can stop the session without reopening it.
export function attachRecordingBubble({ onStop }: BubbleCallbacks): BubbleHandle {
  document.getElementById(BUBBLE_ID)?.remove();

  const root = document.createElement('div');
  root.id = BUBBLE_ID;
  markAsExtensionUi(root);
  root.style.position = 'fixed';
  root.style.right = '20px';
  root.style.bottom = '20px';
  root.style.zIndex = '2147483646'; // just under the Add badge
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.alignItems = 'flex-end';
  root.style.gap = '8px';
  root.style.font = '500 12px system-ui, "Segoe UI", sans-serif';

  // ----- collapsed bubble -----
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = 'Browser Agent — recording';
  bubble.dataset.baRole = 'bubble';
  bubble.style.display = 'flex';
  bubble.style.alignItems = 'center';
  bubble.style.justifyContent = 'center';
  bubble.style.gap = '6px';
  bubble.style.minWidth = '52px';
  bubble.style.height = '52px';
  bubble.style.padding = '0 14px';
  bubble.style.border = 'none';
  bubble.style.borderRadius = '999px';
  bubble.style.background = '#ffffff';
  bubble.style.color = '#1e293b';
  bubble.style.boxShadow = '0 4px 16px rgba(15, 23, 42, 0.22)';
  bubble.style.cursor = 'grab';

  const dot = document.createElement('span');
  dot.style.width = '9px';
  dot.style.height = '9px';
  dot.style.borderRadius = '50%';
  dot.style.background = '#dc2626';
  dot.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.2)';
  dot.style.flexShrink = '0';

  const counter = document.createElement('span');
  counter.textContent = '0';
  counter.style.font = '600 14px system-ui, "Segoe UI", sans-serif';

  bubble.append(dot, counter);

  // ----- expanded card -----
  const card = document.createElement('div');
  card.dataset.baRole = 'card';
  card.style.display = 'none';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  card.style.width = '250px';
  card.style.padding = '12px';
  card.style.borderRadius = '10px';
  card.style.background = '#fbfcfe';
  card.style.border = '1px solid #d5dde8';
  card.style.boxShadow = '0 8px 28px rgba(15, 23, 42, 0.2)';

  const title = document.createElement('div');
  title.textContent = 'Recording';
  title.style.font = '600 13px system-ui, "Segoe UI", sans-serif';
  title.style.color = '#b91c1c';

  const summary = document.createElement('div');
  summary.dataset.baRole = 'summary';
  summary.style.fontSize = '11px';
  summary.style.color = '#64748b';
  summary.style.lineHeight = '1.5';
  summary.style.wordBreak = 'break-word';

  const stopBtn = document.createElement('button');
  stopBtn.dataset.baRole = 'stop';
  styleButton(stopBtn);
  stopBtn.textContent = '⏹ Stop recording';
  stopBtn.style.background = '#fee2e2';
  stopBtn.style.borderColor = '#f4b8b8';
  stopBtn.style.color = '#b91c1c';
  stopBtn.style.fontWeight = '600';

  card.append(title, summary, stopBtn);
  root.append(card, bubble);
  document.documentElement.appendChild(root);

  let expanded = false;
  let lastCount = 0;
  let lastLabel = '';

  const render = () => {
    counter.textContent = String(lastCount);
    summary.textContent = lastCount
      ? `${lastCount} step${lastCount === 1 ? '' : 's'} · last: ${lastLabel}`
      : 'No steps yet — interact with the page.';
    card.style.display = expanded ? 'flex' : 'none';
  };

  // ----- drag, without swallowing the click that opens the card -----
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originRight = 20;
  let originBottom = 20;

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    originRight = parseFloat(root.style.right) || 20;
    originBottom = parseFloat(root.style.bottom) || 20;
    bubble.setPointerCapture(event.pointerId);
    bubble.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    moved = true;
    root.style.right = `${Math.max(8, Math.min(originRight - dx, window.innerWidth - 80))}px`;
    root.style.bottom = `${Math.max(8, Math.min(originBottom - dy, window.innerHeight - 80))}px`;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    bubble.releasePointerCapture(event.pointerId);
    bubble.style.cursor = 'grab';
  };

  const onBubbleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (moved) return; // that click was the end of a drag
    expanded = !expanded;
    render();
  };

  const onStopClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    onStop();
  };

  bubble.addEventListener('pointerdown', onPointerDown);
  bubble.addEventListener('pointermove', onPointerMove);
  bubble.addEventListener('pointerup', onPointerUp);
  bubble.addEventListener('click', onBubbleClick, true);
  stopBtn.addEventListener('click', onStopClick, true);

  render();

  return {
    update: (count, label) => {
      lastCount = count;
      lastLabel = label;
      render();
    },
    detach: () => root.remove(),
  };
}
