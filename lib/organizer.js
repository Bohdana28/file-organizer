import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import fsNative from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { walkFiles, ensureDirectory, uniqueDestination, LARGE_FILE_LIMIT } from './utils.js';

const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.xls', '.pptx', '.ppt', '.rtf', '.odt'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z', '.bz2'],
  Code: ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.json', '.xml', '.yml', '.yaml', '.sh'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm', '.wmv', '.flv', '.m4v'],
  Other: []
};

function getCategory(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return Object.entries(categories).find(([name, extensions]) =>
    name !== 'Other' && extensions.includes(extension)
  )?.[0] ?? 'Other';
}

export class Organizer extends EventEmitter {
  async organize(source, output) {
    const sourcePath = path.resolve(source);
    const outputPath = path.resolve(output);
    if (sourcePath === outputPath || outputPath.startsWith(`${sourcePath}${path.sep}`)) {
      throw new Error('The output directory must not be the source directory or a subdirectory of it.');
    }

    this.emit('organize-start', { source: sourcePath, output: outputPath });
    try {
      const files = await walkFiles(sourcePath);
      const counts = Object.fromEntries(Object.keys(categories).map(category => [category, 0]));
      const totalSize = { value: 0 };

      for (const category of Object.keys(categories)) {
        await ensureDirectory(path.join(outputPath, category));
      }
      this.emit('folders-created', { output: outputPath, categories: Object.keys(categories) });

      let completed = 0;
      for (const sourceFile of files) {
        const category = getCategory(sourceFile);
        const categoryDirectory = path.join(outputPath, category);
        const destination = await uniqueDestination(categoryDirectory, path.basename(sourceFile));
        this.emit('copy-start', { source: sourceFile, destination, current: completed + 1, total: files.length });

        try {
          const stats = await fs.stat(sourceFile);
          if (stats.size >= LARGE_FILE_LIMIT) {
            await pipeline(
              fsNative.createReadStream(sourceFile),
              fsNative.createWriteStream(destination, { flags: 'wx' })
            );
          } else {
            // copyFile uses the filesystem's copy implementation and avoids loading the file into JS memory.
            await fs.copyFile(sourceFile, destination, fsNative.constants.COPYFILE_EXCL);
          }
          counts[category] += 1;
          totalSize.value += stats.size;
          completed += 1;
          this.emit('copy-complete', { source: sourceFile, destination, category, size: stats.size, current: completed, total: files.length });
        } catch (error) {
          this.emit('copy-error', { source: sourceFile, destination, error });
          if (error.code === 'EEXIST') {
            // A race created the destination after the name check. Do not overwrite; report it.
            continue;
          }
          throw Object.assign(error, { targetPath: sourceFile });
        }
      }

      const result = { counts, totalCopied: completed, totalSize: totalSize.value, output: outputPath };
      this.emit('organize-complete', result);
      return result;
    } catch (error) {
      this.emit('organize-error', error);
      throw error;
    }
  }
}
