import fs from 'node:fs/promises';
import path from 'node:path';

export const LARGE_FILE_LIMIT = 10 * 1024 * 1024;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function drawProgressBar(current, total, width = 20) {
  if (total === 0) return `${'█'.repeat(width)} 0/0`;
  const filled = Math.round((current / total) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${current}/${total}`;
}

export function ageInDays(date) {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

export function errorMessage(error, target) {
  if (error?.code === 'ENOENT') return `Path not found: ${target}`;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return `Permission denied: ${target}`;
  if (error?.code === 'EISDIR') return `Expected a file but found a directory: ${target}`;
  if (error?.code === 'ENOTDIR') return `A part of the path is not a directory: ${target}`;
  if (error?.code === 'ENOSPC') return `Not enough disk space while processing: ${target}`;
  if (error?.code === 'EEXIST') return `The destination already exists: ${target}`;
  return `Unexpected filesystem error at ${target}: ${error?.message ?? error}`;
}

export async function walkFiles(directory) {
  const result = [];
  async function visit(currentDirectory) {
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      throw Object.assign(error, { targetPath: currentDirectory });
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
      // Symbolic links are deliberately skipped to avoid loops and copying outside the source.
    }
  }
  await visit(path.resolve(directory));
  return result;
}

export async function ensureDirectory(directory) {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    throw Object.assign(error, { targetPath: directory });
  }
}

export async function uniqueDestination(directory, fileName) {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let index = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${base}(${index})${extension}`);
      index += 1;
    } catch (error) {
      if (error.code === 'ENOENT') return candidate;
      throw Object.assign(error, { targetPath: candidate });
    }
  }
}

export function printFileSystemError(error) {
  console.error(`❌ ${errorMessage(error, error?.targetPath ?? 'requested path')}`);
}
