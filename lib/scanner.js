import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkFiles, ageInDays } from './utils.js';

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory: path.resolve(directory) });
    try {
      const paths = await walkFiles(directory);
      const now = Date.now();
      const byType = new Map();
      const largestFiles = [];
      let totalSize = 0;
      let last7Days = 0;
      let last30Days = 0;
      let olderThan90Days = 0;
      let oldestFile = null;

      for (let index = 0; index < paths.length; index += 1) {
        const filePath = paths[index];
        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch (error) {
          this.emit('file-error', { path: filePath, error });
          continue;
        }

        const extension = path.extname(filePath).toLowerCase() || '(no extension)';
        const fileData = {
          path: filePath,
          name: path.basename(filePath),
          extension,
          size: stats.size,
          mtime: stats.mtime
        };

        totalSize += stats.size;
        const typeStats = byType.get(extension) ?? { count: 0, totalSize: 0 };
        typeStats.count += 1;
        typeStats.totalSize += stats.size;
        byType.set(extension, typeStats);

        const days = (now - stats.mtime.getTime()) / 86_400_000;
        if (days <= 7) last7Days += 1;
        if (days <= 30) last30Days += 1;
        if (days > 90) olderThan90Days += 1;

        if (!oldestFile || stats.mtime < oldestFile.mtime) oldestFile = fileData;
        largestFiles.push(fileData);
        largestFiles.sort((a, b) => b.size - a.size);
        if (largestFiles.length > 3) largestFiles.pop();

        this.emit('file-found', { ...fileData, current: index + 1, total: paths.length });
      }

      const statistics = {
        totalFiles: paths.length,
        processedFiles: [...byType.values()].reduce((sum, item) => sum + item.count, 0),
        totalSize,
        byType,
        age: { last7Days, last30Days, olderThan90Days },
        largestFiles,
        oldestFile
      };
      this.emit('scan-complete', statistics);
      return statistics;
    } catch (error) {
      this.emit('scan-error', error);
      throw error;
    }
  }
}
