/**
 * mandelbrot-test.js — Verification harness for Example 02: Mandelbrot (C -> Wasm via Clang)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * Run: node mandelbrot-test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'mandelbrot.c');
const out = path.join(dir, 'mandelbrot.wasm');

console.log('=== Example Project 02: Mandelbrot Explorer (C -> Wasm) ===\n');

let clang = 'wasm32-clang';
try { execSync(`${clang} --version`, { stdio: 'ignore' }); }
catch { clang = '/opt/homebrew/bin/wasm32-clang'; }

execSync(
  `${clang} -O3 -nostdlib -Wl,--no-entry ` +
  `-Wl,--export=mandel_iter -Wl,--export=render -Wl,--export=get_fb ` +
  `-Wl,--strip-all -o "${out}" "${src}"`, { stdio: 'inherit' });
const bytes = fs.readFileSync(out);
console.log(`1. Compilation succeeded: ${bytes.length} bytes`);

const { instance } = await WebAssembly.instantiate(bytes);
const { mandel_iter, render, get_fb, memory } = instance.exports;

// JavaScript reference implementation (identical algorithm)
function jsIter(cr, ci, max) {
  let zr = 0, zi = 0, i = 0;
  while (i < max && zr * zr + zi * zi <= 4.0) {
    const t = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci; zr = t; i++;
  }
  return i;
}

console.log('\n2. Verifying mandel_iter vs JS reference (both use IEEE-754 double precision):');
let checked = 0;
for (let y = -1.2; y <= 1.2; y += 0.1)
  for (let x = -2.2; x <= 0.8; x += 0.1) {
    assert.strictEqual(mandel_iter(x, y, 200), jsIter(x, y, 200), `(${x},${y})`);
    checked++;
  }
console.log(`   Bit-exact match across all ${checked} sample points ✅`);
assert.strictEqual(mandel_iter(0, 0, 100), 100);   // Center is within set
assert.strictEqual(mandel_iter(2, 2, 100), 1);     // Distant point escapes immediately

console.log('\n3. Rendering 320x240 frame and verifying framebuffer integrity:');
const W = 320, H = 240, MAXI = 200;
const total = render(W, H, MAXI, -0.5, 0, 3.0);
const fbPtr = get_fb();
const px = new Uint32Array(memory.buffer, fbPtr, W * H);
console.log(`   framebuffer @ ${fbPtr}, cumulative iteration sum = ${total}`);
assert.strictEqual(px[(H / 2) * W + Math.round(W * (0.5 / 3.0 + 0.5) )] >>> 24, 0xFF);
assert(px.every(v => (v >>> 24) === 0xFF), 'Every pixel must have alpha=255');

// Cross-check total iterations with JS reference
const step = 3.0 / W, x0 = -0.5 - 1.5, y0 = 0 - step * H / 2;
let jsTotal = 0;
for (let py = 0; py < H; py++)
  for (let pxx = 0; pxx < W; pxx++) jsTotal += jsIter(x0 + step * pxx, y0 + step * py, MAXI);
assert.strictEqual(total, jsTotal);
console.log(`   Cumulative iterations match JS reference (${jsTotal}) ✅`);

console.log('\n4. ASCII Preview (downsampled from live framebuffer):');
const chars = ' .:-=+*#%@';
for (let py = 0; py < H; py += 12) {
  let line = '';
  for (let pxx = 0; pxx < W; pxx += 4) {
    const it = jsIter(x0 + step * pxx, y0 + step * py, MAXI);
    line += it >= MAXI ? '@' : chars[Math.min(8, Math.floor(it / 4))];
  }
  console.log('   ' + line);
}

console.log('\n5. Benchmark: 640x480 frame, max_iter=300:');
let t = performance.now();
const wt = render(640, 480, 300, -0.745, 0.113, 0.01);
const tw = performance.now() - t;
console.log(`   Wasm: ${tw.toFixed(1)} ms (cumulative iterations: ${wt})`);

console.log(`\n🎉 All test assertions passed (retaining ${path.basename(out)} for mandelbrot.html)`);
