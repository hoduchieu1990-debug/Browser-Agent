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

// Chrome can only screenshot the whole visible tab, so crop the element out of
// it here — the service worker has OffscreenCanvas but no DOM to do it in.
export async function captureElement(windowId: number, rect: CaptureRect, dpr: number): Promise<string> {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(fullDataUrl)).blob());

  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas to crop the screenshot');

  ctx.drawImage(bitmap, Math.round(rect.x * dpr), Math.round(rect.y * dpr), width, height, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return `data:image/png;base64,${toBase64(await blob.arrayBuffer())}`;
}
