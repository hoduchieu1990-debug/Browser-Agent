// A content script can never assign a real file to <input type="file"> —
// browsers block scripts from touching that value for the same reason they
// block reading it. The devtools protocol is the one legitimate way an
// extension can do this (it's the same command Playwright's setInputFiles
// uses under the hood), and the extension already opens debugger sessions
// for screenshot capture, so this reuses that same attach/detach shape.
function resolverExpression(selector: string, fallbacks: string[]): string {
  const candidates = JSON.stringify([selector, ...fallbacks]);
  return `(() => {
    function resolveOne(sel) {
      if (sel.startsWith('//') || sel.startsWith('xpath=')) {
        const expr = sel.replace(/^xpath=/, '');
        return document.evaluate(expr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      }
      const nth = sel.match(/^:nth-match\\(([\\s\\S]+),\\s*(\\d+)\\)$/);
      if (nth) {
        const list = document.querySelectorAll(nth[1]);
        return list[Number(nth[2]) - 1] ?? null;
      }
      return document.querySelector(sel);
    }
    const candidates = ${candidates};
    for (const sel of candidates) {
      const el = resolveOne(sel);
      if (el) return el;
    }
    return null;
  })()`;
}

export async function setFileInputFilesViaDebugger(
  tabId: number,
  selector: string,
  fallbacks: string[] | undefined,
  filePath: string,
): Promise<void> {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');

    const evalResult = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: resolverExpression(selector, fallbacks ?? []),
    })) as { result?: { objectId?: string } };

    if (!evalResult.result?.objectId) throw new Error(`Element not found: ${selector}`);

    const node = (await chrome.debugger.sendCommand({ tabId }, 'DOM.requestNode', {
      objectId: evalResult.result.objectId,
    })) as { nodeId: number };

    await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
      files: [filePath],
      nodeId: node.nodeId,
    });
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
