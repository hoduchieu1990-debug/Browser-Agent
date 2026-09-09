// Dispatches a click through the DevTools Protocol so the page receives a
// trusted event (event.isTrusted === true) instead of a synthetic DOM
// MouseEvent — some enterprise frameworks (Nexacro's own non-component DOM,
// WebSquare, and others) branch on that, and a synthetic click can silently
// no-op where a real one works. Same attach-per-call, detach-in-finally
// shape as capture.ts/file-input.ts's debugger usage; replay steps run one
// at a time, so this never overlaps with either of those on the same tab.
export async function cdpClick(tabId: number, point: { x: number; y: number }): Promise<boolean> {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch {
    // Most commonly: real DevTools (or another debugger client) already owns
    // this tab's session — Chrome allows only one at a time. The caller falls
    // back to a plain DOM click, which is strictly worse but not fatal.
    return false;
  }
  try {
    const base = { x: point.x, y: point.y, button: 'left' as const, clickCount: 1 };
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    return true;
  } catch {
    return false;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
