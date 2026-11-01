#!/usr/bin/env node
import path from 'node:path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { formatSize, drawProgressBar, printFileSystemError } from './lib/utils.js';

function usage() {
  console.log(`
File Organizer - CLI tool for managing files

Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]

Examples:
  npm run scan -- ./Downloads
  npm run duplicates -- ./Downloads
  npm run organize -- ./Downloads --output ./Organized
  npm run cleanup -- ./Downloads --older-than 90
  npm run cleanup -- ./Downloads --older-than 90 --confirm
`);
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function printScanReport(stats) {
  console.log('\n📊 Scan Results:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total files: ${stats.processedFiles}`);
  console.log(`Total size: ${formatSize(stats.totalSize)}`);
  console.log('\nBy File Type:');
  for (const [extension, data] of [...stats.byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize)) {
    console.log(`  ${extension.padEnd(12)} ${String(data.count).padStart(5)} files   ${formatSize(data.totalSize)}`);
  }
  console.log('\nFile Age:');
  console.log(`  Last 7 days:    ${stats.age.last7Days} files`);
  console.log(`  Last 30 days:   ${stats.age.last30Days} files`);
  console.log(`  Older than 90:  ${stats.age.olderThan90Days} files`);
  console.log('\nLargest files:');
  if (!stats.largestFiles.length) console.log('  No files found.');
  stats.largestFiles.forEach((file, index) => console.log(`  ${index + 1}. ${file.name}  ${formatSize(file.size)}`));
  if (stats.oldestFile) {
    const days = Math.floor((Date.now() - stats.oldestFile.mtime.getTime()) / 86_400_000);
    console.log(`\nOldest file: ${stats.oldestFile.name} (modified ${days} days ago)`);
  }
}

async function main() {
  const [command, directory, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return usage();
  if (!directory) throw new Error(`A directory is required for "${command}".`);

  if (command === 'scan') {
    const scanner = new Scanner();
    let count = 0;
    scanner.on('scan-start', data => console.log(`📂 Scanning: ${data.directory}`));
    scanner.on('file-found', data => {
      count = data.current;
      process.stdout.write(`\\rProcessing... ${drawProgressBar(count, data.total)}`);
    });
    scanner.on('file-error', ({ path: filePath, error }) => console.error(`\\n⚠️ ${filePath}: ${error.message}`));
    scanner.on('scan-complete', printScanReport);
    const result = await scanner.scan(directory);
    if (!result.totalFiles) console.log('No files found.');
    return;
  }

  if (command === 'duplicates') {
    const finder = new DuplicateFinder();
    finder.on('search-start', data => console.log(`🔍 Searching for duplicates in: ${data.directory}`));
    finder.on('file-processed', data => process.stdout.write(`\\rCalculating hashes... ${drawProgressBar(data.current, data.total)}`));
    finder.on('file-error', ({ path: filePath, error }) => console.error(`\\n⚠️ Could not process ${filePath}: ${error.message}`));
    finder.on('duplicates-found', result => {
      console.log(`\n\\nFound ${result.groups.length} duplicate groups (${formatSize(result.totalWasted)} wasted):`);
      result.groups.forEach((group, index) => {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Group ${index + 1} (${group.filePaths.length} copies, ${formatSize(group.size)} each):`);
        console.log(`  SHA-256: ${group.hash}`);
        group.filePaths.forEach(filePath => console.log(`  📄 ${filePath}`));
        console.log(`  Wasted space: ${formatSize(group.wastedSize)}`);
      });
      console.log(`\n💾 Total wasted space: ${formatSize(result.totalWasted)}`);
    });
    await finder.find(directory);
    return;
  }

  if (command === 'organize') {
    const output = optionValue(args, '--output');
    if (!output) throw new Error('Missing required option: --output <target-directory>.');
    const organizer = new Organizer();
    organizer.on('organize-start', data => console.log(`📦 Organizing: ${data.source}\\nTarget: ${data.output}`));
    organizer.on('folders-created', ({ categories: names }) => {
      console.log('\nCreating folders...');
      names.forEach(name => console.log(`  ✓ ${name}/`));
    });
    organizer.on('copy-start', data => process.stdout.write(`\\rCopying files... ${drawProgressBar(data.current - 1, data.total)}`));
    organizer.on('copy-error', ({ source, error }) => console.error(`\\n⚠️ Could not copy ${source}: ${error.message}`));
    organizer.on('organize-complete', result => {
      console.log('\n\\n✅ Organization complete!\\n\\nSummary:');
      for (const [category, count] of Object.entries(result.counts)) {
        console.log(`  ${category.padEnd(10)} ${String(count).padStart(4)} files → ${path.join(result.output, category)}/`);
      }
      console.log(`\nTotal copied: ${result.totalCopied} files (${formatSize(result.totalSize)})`);
    });
    await organizer.organize(directory, output);
    return;
  }

  if (command === 'cleanup') {
    const olderThan = Number(optionValue(args, '--older-than'));
    if (!args.includes('--older-than') || !Number.isFinite(olderThan)) {
      throw new Error('Missing or invalid option: --older-than <days>.');
    }
    const confirm = args.includes('--confirm');
    const cleanup = new Cleanup();
    cleanup.on('cleanup-start', data => console.log(`🧹 Cleanup: ${data.directory}\\nLooking for files older than ${data.olderThanDays} days...`));
    cleanup.on('file-deleted', data => process.stdout.write(`\\rDeleting... ${drawProgressBar(data.current, data.total)}`));
    cleanup.on('file-error', ({ path: filePath, error }) => console.error(`\\n⚠️ Could not process ${filePath}: ${error.message}`));
    cleanup.on('cleanup-complete', result => {
      console.log(`\n\\nFound ${result.files.length} files ${confirm ? 'to delete' : 'that would be deleted'}:`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      result.files.slice(0, 20).forEach(file => {
        const modified = file.mtime.toISOString().slice(0, 10);
        console.log(`${file.path}\\n  Size: ${formatSize(file.size)}\\n  Modified: ${Math.floor(file.daysOld)} days ago (${modified})`);
      });
      if (result.files.length > 20) console.log(`... (${result.files.length - 20} more files)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Total: ${result.files.length} files (${formatSize(result.totalSize)})`);
      if (result.dryRun) {
        console.log('\n⚠️ DRY RUN MODE: No files were deleted.\\nTo actually delete these files, run with --confirm flag.');
      } else {
        console.log(`\n✅ Cleanup complete!\\nDeleted: ${result.deleted} files (${formatSize(result.freedSize)} freed)`);
      }
    });
    await cleanup.cleanup(directory, olderThan, confirm);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  printFileSystemError(error);
  usage();
  process.exitCode = 1;
});
