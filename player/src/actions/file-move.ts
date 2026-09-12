import * as fs from 'fs';
import * as path from 'path';
import type { FileMoveAction } from '@browser-agent/shared';

export async function fileMove(_page: unknown, action: FileMoveAction): Promise<void> {
  if (!fs.existsSync(action.sourcePath)) {
    throw new Error(`Source file not found: ${action.sourcePath}`);
  }
  if (!action.overwrite && fs.existsSync(action.destPath)) {
    throw new Error(`Destination already exists: ${action.destPath} (set overwrite: true to replace it)`);
  }

  fs.mkdirSync(path.dirname(action.destPath), { recursive: true });
  try {
    fs.renameSync(action.sourcePath, action.destPath);
  } catch (error) {
    // rename() cannot cross drives/volumes (EXDEV) — common on Windows when
    // moving between drive letters or to a mapped network drive.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.copyFileSync(action.sourcePath, action.destPath);
    fs.unlinkSync(action.sourcePath);
  }
}
