import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const decoder = new TextDecoder('utf-8', { fatal: true });
const mojibakeSequence = Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac]);

let hasErrors = false;

for (const file of files) {
  const contents = readFileSync(path.join(root, file));
  if (contents.includes(0)) {
    continue;
  }

  try {
    decoder.decode(contents);
  } catch {
    console.error(`${file} is not valid UTF-8`);
    hasErrors = true;
  }

  if (contents.includes(mojibakeSequence)) {
    console.error(`${file} contains a known mojibake sequence`);
    hasErrors = true;
  }

  if (contents.includes(Buffer.from('\r\n'))) {
    console.error(`${file} contains CRLF line endings`);
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exitCode = 1;
} else {
  console.log('Tracked text files are valid UTF-8 and use LF line endings.');
}
