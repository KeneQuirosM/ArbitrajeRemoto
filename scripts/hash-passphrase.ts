// Prints the value for ADMIN_PASSPHRASE_HASH. The passphrase itself is never stored.
// Interactive: npm run hash-passphrase   (asks twice, input hidden)
// Piped:       printf '%s' "$PASS" | npm run --silent hash-passphrase

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { MIN_PASSPHRASE_LENGTH, hashPassphrase } from '../server/crypto.ts';

async function readHidden(prompt: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(prompt);
  muted = true;
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

let passphrase: string;
if (process.stdin.isTTY) {
  passphrase = await readHidden('Frase de acceso: ');
  const again = await readHidden('Repite la frase: ');
  if (again !== passphrase) {
    console.error('Las frases no coinciden.');
    process.exit(1);
  }
} else {
  passphrase = await readPiped();
}

if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
  console.error(`La frase debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres (mejor 4 o más palabras).`);
  process.exit(1);
}
console.log(hashPassphrase(passphrase));
