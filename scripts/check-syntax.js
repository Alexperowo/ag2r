import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const roots = ['server.js', 'src', 'public/js', 'scripts'];
const files = [];

function collect(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (relativePath.endsWith('.js')) {
    files.push(absolutePath);
    return;
  }

  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) collect(child);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(projectRoot, child));
  }
}

for (const root of roots) collect(root);

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
  }
}

if (failed) process.exit(1);
console.log(`Syntax OK (${files.length} JavaScript files)`);
