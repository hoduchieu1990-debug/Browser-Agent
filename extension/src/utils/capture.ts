export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // spreading the whole array at once overflows the call stack
  let binary = '';

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return btoa(binary);
}

// Renders a frame through the devtools protocol, which does not care whether
// the tab is on screen. captureVisibleTab fails with "image readback failed"
// on a minimized window; this is what makes background runs able to capture.
// The clip is in document coordinates and CDP does the cropping for us.
export async function captureElementViaDebugger(tabId: number, pageRect: CaptureRect): Promise<string> {
  // The clip is read in the page's own unzoomed coordinates, while the rect
  // came from a zoomed page — at anything but 100% the two disagree and the
  // capture lands somewhere else entirely.
  const zoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  const clip =
    zoom === 1
      ? { ...pageRect, scale: 1 }
      : {
          x: pageRect.x * zoom,
          y: pageRect.y * zoom,
          width: pageRect.width * zoom,
          height: pageRect.height * zoom,
          scale: 1,
        };

  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const result = (await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip,
    })) as { data: string } | undefined;

    if (!result?.data) throw new Error('Page.captureScreenshot returned no image');
    return `data:image/png;base64,${result.data}`;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// A small, lossy preview of just the element's own area — kept light and
// fast rather than capturing (and re-encoding) the whole tab on every step.
const THUMBNAIL_MAX_DIMENSION = 200;
const THUMBNAIL_PADDING_PX = 12; // a little breathing room, not the whole page

// getBoundingClientRect (where `rect` comes from) is always in the page's own
// CSS pixels, unaffected by the browser's page zoom — but captureVisibleTab
// photographs what is actually on screen, which zoom does change. At
// anything but 100% zoom, multiplying by dpr alone lands the crop somewhere
// else entirely, off by more the farther the element sits from the top-left
// corner (confirmed on a real Nexacro app: a login card offset from the
// origin came back showing unrelated content to its left and cut off on its
// own right/bottom edge). captureElementViaDebugger already corrects for
// this the same way; these two callers just never had a zoom to ask about.
function toDevicePixels(rect: CaptureRect, dpr: number, zoom: number): CaptureRect {
  const scale = dpr * zoom;
  return { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
}

export async function captureThumbnail(windowId: number, rect: CaptureRect, dpr: number, zoom = 1): Promise<string> {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(fullDataUrl)).blob());
  const scaled = toDevicePixels(rect, dpr, zoom);

  const srcX = Math.max(0, Math.round(scaled.x - THUMBNAIL_PADDING_PX * dpr * zoom));
  const srcY = Math.max(0, Math.round(scaled.y - THUMBNAIL_PADDING_PX * dpr * zoom));
  const srcW = Math.max(1, Math.min(bitmap.width - srcX, Math.round(scaled.width + THUMBNAIL_PADDING_PX * 2 * dpr * zoom)));
  const srcH = Math.max(1, Math.min(bitmap.height - srcY, Math.round(scaled.height + THUMBNAIL_PADDING_PX * 2 * dpr * zoom)));

  const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas to crop the screenshot');

  ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return `data:image/jpeg;base64,${toBase64(await blob.arrayBuffer())}`;
}

// Chrome can only screenshot the whole visible tab, so crop the element out of
// it here — the service worker has OffscreenCanvas but no DOM to do it in.
export async function captureElement(windowId: number, rect: CaptureRect, dpr: number, zoom = 1): Promise<string> {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(fullDataUrl)).blob());
  const scaled = toDevicePixels(rect, dpr, zoom);

  const width = Math.max(1, Math.round(scaled.width));
  const height = Math.max(1, Math.round(scaled.height));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas to crop the screenshot');

  ctx.drawImage(bitmap, Math.round(scaled.x), Math.round(scaled.y), width, height, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return `data:image/png;base64,${toBase64(await blob.arrayBuffer())}`;
}
