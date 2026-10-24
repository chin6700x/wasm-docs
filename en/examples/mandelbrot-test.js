/**
 * mandelbrot-test.js — ทดสอบโปรแกรมตัวอย่างที่ 2: Mandelbrot (C -> Wasm ด้วย Clang)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * รัน: node mandelbrot-test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'mandelbrot.c');
const out = path.join(dir, 'mandelbrot.wasm');

console.log('=== โปรแกรมตัวอย่างที่ 2: Mandelbrot (C -> Wasm) ===\n');

let clang = 'wasm32-clang';
try { execSync(`${clang} --version`, { stdio: 'ignore' }); }
catch { clang = '/opt/homebrew/bin/wasm32-clang'; }

execSync(
  `${clang} -O3 -nostdlib -Wl,--no-entry ` +
  `-Wl,--export=mandel_iter -Wl,--export=render -Wl,--export=get_fb ` +
  `-Wl,--strip-all -o "${out}" "${src}"`, { stdio: 'inherit' });
const bytes = fs.readFileSync(out);
console.log(`1. คอมไพล์สำเร็จ: ${bytes.length} ไบต์`);

const { instance } = await WebAssembly.instantiate(bytes);
const { mandel_iter, render, get_fb, memory } = instance.exports;

// ตัวอ้างอิงฝั่ง JS (อัลกอริทึมเดียวกัน)
function jsIter(cr, ci, max) {
  let zr = 0, zi = 0, i = 0;
  while (i < max && zr * zr + zi * zi <= 4.0) {
    const t = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci; zr = t; i++;
  }
  return i;
}

console.log('\n2. mandel_iter เทียบกับ JS (ทั้ง 2 ฝั่งใช้ IEEE-754 double):');
let checked = 0;
for (let y = -1.2; y <= 1.2; y += 0.1)
  for (let x = -2.2; x <= 0.8; x += 0.1) {
    assert.strictEqual(mandel_iter(x, y, 200), jsIter(x, y, 200), `(${x},${y})`);
    checked++;
  }
console.log(`   ตรงกันทั้ง ${checked} จุด ✅`);
assert.strictEqual(mandel_iter(0, 0, 100), 100);   // ศูนย์กลางอยู่ในเซต
assert.strictEqual(mandel_iter(2, 2, 100), 1);     // อยู่ไกล หนีทันที

console.log('\n3. render 320x240 และตรวจ framebuffer:');
const W = 320, H = 240, MAXI = 200;
const total = render(W, H, MAXI, -0.5, 0, 3.0);
const fbPtr = get_fb();
const px = new Uint32Array(memory.buffer, fbPtr, W * H);
console.log(`   framebuffer @ ${fbPtr}, ผลรวมรอบ = ${total}`);
assert.strictEqual(px[(H / 2) * W + Math.round(W * (0.5 / 3.0 + 0.5) )] >>> 24, 0xFF);
assert(px.every(v => (v >>> 24) === 0xFF), 'ทุกพิกเซลต้อง alpha=255');

// ผลรวมรอบเทียบกับ JS
const step = 3.0 / W, x0 = -0.5 - 1.5, y0 = 0 - step * H / 2;
let jsTotal = 0;
for (let py = 0; py < H; py++)
  for (let pxx = 0; pxx < W; pxx++) jsTotal += jsIter(x0 + step * pxx, y0 + step * py, MAXI);
assert.strictEqual(total, jsTotal);
console.log(`   ผลรวมรอบตรงกับ JS (${jsTotal}) ✅`);

console.log('\n4. ภาพ ASCII (ย่อจากผลลัพธ์จริง):');
const chars = ' .:-=+*#%@';
for (let py = 0; py < H; py += 12) {
  let line = '';
  for (let pxx = 0; pxx < W; pxx += 4) {
    const it = jsIter(x0 + step * pxx, y0 + step * py, MAXI);
    line += it >= MAXI ? '@' : chars[Math.min(8, Math.floor(it / 4))];
  }
  console.log('   ' + line);
}

console.log('\n5. Benchmark 640x480, max_iter=300:');
let t = performance.now();
const wt = render(640, 480, 300, -0.745, 0.113, 0.01);
const tw = performance.now() - t;
console.log(`   Wasm: ${tw.toFixed(1)} ms (รอบรวม ${wt})`);

console.log(`\n🎉 ผ่านทุกขั้นตอน (เก็บ ${path.basename(out)} ไว้ให้ mandelbrot.html ใช้งาน)`);
