import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { walkFiles } from './utils.js';

async function calculateHash(filePath) {
  const hash = crypto.createHash('sha256');
  try {
    // Consume the readable stream chunk by chunk; the whole file is never loaded into memory.
    for await (const chunk of fs.createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch (error) {
    throw Object.assign(error, { targetPath: filePath });
  }
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    this.emit('search-start', { directory: path.resolve(directory) });
    try {
      const allPaths = await walkFiles(directory);
      const bySize = new Map();

      // Files with different sizes cannot have identical contents.
      for (const filePath of allPaths) {
        try {
          const { size } = await fsp.stat(filePath);
          const sameSize = bySize.get(size) ?? [];
          sameSize.push(filePath);
          bySize.set(size, sameSize);
        } catch (error) {
          this.emit('file-error', { path: filePath, error });
        }
      }

      const candidates = [...bySize.values()].filter(group => group.length > 1).flat();
      const hashes = new Map();
      let processed = 0;

      for (const filePath of candidates) {
        try {
          const hash = await calculateHash(filePath);
          const group = hashes.get(hash) ?? [];
          group.push(filePath);
          hashes.set(hash, group);
        } catch (error) {
          this.emit('file-error', { path: filePath, error });
        }
        processed += 1;
        this.emit('file-processed', { path: filePath, current: processed, total: candidates.length });
      }

      const duplicates = [];
      let totalWasted = 0;
      for (const [hash, filePaths] of hashes) {
        if (filePaths.length < 2) continue;
        const stats = await fsp.stat(filePaths[0]);
        const wastedSize = stats.size * (filePaths.length - 1);
        totalWasted += wastedSize;
        duplicates.push({ hash, filePaths, size: stats.size, wastedSize });
      }

      const result = { groups: duplicates, totalWasted, processedFiles: processed, totalFiles: allPaths.length };
      this.emit('duplicates-found', result);
      return result;
    } catch (error) {
      this.emit('search-error', error);
      throw error;
    }
  }
}
