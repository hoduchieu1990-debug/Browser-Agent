export function extractTableHeaders(table: HTMLTableElement): string[] {
  const headerCells = table.querySelectorAll('thead th, tr:first-child th');
  if (headerCells.length === 0) return [];
  return Array.from(headerCells).map((cell, i) => cell.textContent?.trim() || `column${i + 1}`);
}
