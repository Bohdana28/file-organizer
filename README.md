# File Organizer

A Node.js CLI utility that scans directories, finds duplicate files, copies files into categories, and safely identifies old files for cleanup.

## Requirements

- Node.js 20.1.0 or newer
- npm (included with Node.js)

## Installation

```bash
git clone <your-github-repository-url>
cd file-organizer
npm install
```

There are no third-party dependencies.

## Commands

### 1. Scan a directory

```bash
node file-organizer.js scan ./Downloads
# or
npm run scan -- ./Downloads
```

Recursively scans files and reports total file count and size, statistics by extension, age buckets (last 7 days, last 30 days, older than 90 days), the three largest files, and the oldest file.

### 2. Find duplicates

```bash
node file-organizer.js duplicates ./Downloads
# or
npm run duplicates -- ./Downloads
```

Calculates SHA-256 hashes using readable streams and reports groups with identical content. Wasted space is calculated as file size multiplied by the number of extra copies. Files are grouped by size first to avoid hashing files that cannot be duplicates.

### 3. Organize files

```bash
node file-organizer.js organize ./Downloads --output ./Organized
# or
npm run organize -- ./Downloads --output ./Organized
```

Copies files into `Documents`, `Images`, `Archives`, `Code`, `Videos`, and `Other`. Files of at least 10 MB are copied with streams and `pipeline`; smaller files use `fs.copyFile`. Existing destination names are preserved by adding suffixes such as `file(1).pdf`. Source files are never deleted. The output directory must not be inside the source directory.

### 4. Clean up old files

Preview files older than 90 days (no deletion):

```bash
node file-organizer.js cleanup ./Downloads --older-than 90
```

Delete the listed files:

```bash
node file-organizer.js cleanup ./Downloads --older-than 90 --confirm
```

The age is based on the last modification time (`mtime`). Without `--confirm`, the command runs in dry-run mode and does not delete anything. Use `--confirm` only after checking the preview.

## Project structure

```text
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js
└── lib/
    ├── utils.js
    ├── scanner.js
    ├── duplicates.js
    ├── organizer.js
    └── cleanup.js
```

Each command is implemented as a separate class extending `EventEmitter`. Events report starts, progress, errors, and completion. Shared helpers are in `lib/utils.js`.

## Error handling

Filesystem operations are handled with `try...catch`. Common errors such as missing paths (`ENOENT`), permission problems (`EACCES`/`EPERM`), directories used as files (`EISDIR`), and insufficient disk space (`ENOSPC`) receive readable messages. The process exits with a non-zero status on command-level failure.

## Notes

- Symbolic links are skipped to avoid recursive loops and accidentally processing files outside the requested directory.
- The tool copies files during organization; it does not move or remove source files.
- Always inspect the cleanup preview before using `--confirm`.
