import * as fs from 'fs';
import pdfParse from 'pdf-parse';
import type { FileReadPdfAction } from '@browser-agent/shared';

export async function fileReadPdf(_page: unknown, action: FileReadPdfAction): Promise<string> {
  const buffer = fs.readFileSync(action.filePath);
  const result = await pdfParse(buffer);
  return result.text;
}
