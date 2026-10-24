/**
 * sieve-test.js — ทดสอบโปรแกรมตัวอย่างที่ 1: Sieve of Eratosthenes (WAT ล้วน)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * รัน: node sieve-test.js   (ต้องมี wat2wasm จาก WABT)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wat = path.join(dir, 'sieve.wat');
const wasmFile = path.join(dir, 'sieve.wasm');

console.log('=== โปรแกรมตัวอย่างที่ 1: Sieve of Eratosthenes (WAT) ===\n');

execSync(`wat2wasm "${wat}" -o "${wasmFile}"`);
execSync(`wasm-validate "${wasmFile}"`);
const bytes = fs.readFileSync(wasmFile);
console.log(`1. wat2wasm + wasm-validate สำเร็จ: ${bytes.length} ไบต์`);

const { instance } = await WebAssembly.instantiate(bytes);
const { sieve, is_prime, memory } = instance.exports;

// ตัวอ้างอิงฝั่ง JS
function jsSieve(n) {
  const a = new Uint8Array(n + 1).fill(1);
  a[0] = 0; if (n >= 1) a[1] = 0;
  for (let i = 2; i * i <= n; i++) if (a[i]) for (let j = i * i; j <= n; j += i) a[j] = 0;
  return a;
}

console.log('\n2. เทียบผลกับ JS reference:');
for (const n of [1, 2, 10, 100, 1000, 10000, 65535]) {
  const ref = jsSieve(n);
  const expected = ref.reduce((s, v, i) => s + (i >= 2 ? v : 0), 0);
  const got = sieve(n);
  console.log(`   π(${n}) = ${got}`);
  assert.strictEqual(got, expected, `π(${n}) ไม่ตรง`);
  const mem = new Uint8Array(memory.buffer, 0, n + 1);
  assert.deepStrictEqual(Array.from(mem), Array.from(ref), `bitmap n=${n} ไม่ตรง`);
}
assert.strictEqual(sieve(100), 25);
assert.strictEqual(sieve(10000), 1229);
console.log('   ✅ π(100)=25, π(10000)=1229 ตรงตามคณิตศาสตร์');

console.log('\n3. is_prime():');
sieve(100);
const primes = [];
for (let i = 0; i <= 100; i++) if (is_prime(i)) primes.push(i);
console.log('   ', primes.join(' '));
assert.strictEqual(primes.length, 25);

console.log('\n4. ป้องกัน out-of-bounds:');
assert.strictEqual(sieve(65536), -1);
console.log('   sieve(65536) = -1 (ปฏิเสธก่อนเขียนเกินหน่วยความจำ) ✅');

console.log('\n5. Benchmark (n=65535, 2000 รอบ):');
const R = 2000;
let t = performance.now();
for (let r = 0; r < R; r++) sieve(65535);
const tw = performance.now() - t;
t = performance.now();
for (let r = 0; r < R; r++) jsSieve(65535);
const tj = performance.now() - t;
console.log(`   Wasm: ${tw.toFixed(1)} ms | JS: ${tj.toFixed(1)} ms`);

fs.unlinkSync(wasmFile);
console.log('\n🎉 ผ่านทุกขั้นตอน');
