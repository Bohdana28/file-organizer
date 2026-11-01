import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, ageInDays } from './utils.js';

export class Cleanup extends EventEmitter {
  async cleanup(directory, olderThanDays, confirm = false) {
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      throw new Error('--older-than must be a non-negative number of days.');
    }
    this.emit('cleanup-start', { directory: path.resolve(directory), olderThanDays, confirm });
    try {
      const paths = await walkFiles(directory);
      const oldFiles = [];
      for (const filePath of paths) {
        try {
          const stats = await fs.stat(filePath);
          const daysOld = ageInDays(stats.mtime);
          if (daysOld > olderThanDays) {
            const fileData = { path: filePath, name: path.basename(filePath), size: stats.size, mtime: stats.mtime, daysOld };
            oldFiles.push(fileData);
            this.emit('file-found', fileData);
          }
        } catch (error) {
          this.emit('file-error', { path: filePath, error });
        }
      }

      const totalSize = oldFiles.reduce((sum, file) => sum + file.size, 0);
      if (!confirm) {
        const result = { files: oldFiles, totalSize, deleted: 0, dryRun: true };
        this.emit('cleanup-complete', result);
        return result;
      }

      let deleted = 0;
      let freedSize = 0;
      for (const file of oldFiles) {
        try {
          await fs.unlink(file.path);
          deleted += 1;
          freedSize += file.size;
          this.emit('file-deleted', { ...file, current: deleted, total: oldFiles.length });
        } catch (error) {
          this.emit('file-error', { path: file.path, error });
        }
      }

      const result = { files: oldFiles, totalSize, deleted, freedSize, dryRun: false };
      this.emit('cleanup-complete', result);
      return result;
    } catch (error) {
      this.emit('cleanup-error', error);
      throw error;
    }
  }
}
