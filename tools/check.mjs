import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
let count = 0;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.m?js$/.test(file)) { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); count += 1; }
  }
}
for (const dir of ['src', 'tests', 'tools']) check(dir);
console.log(`Syntax checked ${count} JavaScript files`);
