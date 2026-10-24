/**
 * imgproc-test.js — ทดสอบระบบประมวลผลภาพ Wasm (หมุน ตัด พลิก ย่อ/ขยาย ฟิลเตอร์)
 * ทุกคำสั่งถูกเทียบกับ reference ที่เขียนแยกฝั่ง JS
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * รัน: node imgproc-test.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'imgproc.c');
const out = path.join(dir, 'imgproc.wasm');

console.log('=== ระบบประมวลผลภาพด้วย WebAssembly ===\n');

let clang = 'wasm32-clang';
try { execSync(`${clang} --version`, { stdio: 'ignore' }); }
catch { clang = '/opt/homebrew/bin/wasm32-clang'; }
execSync(`${clang} -O3 -nostdlib -mbulk-memory -Wl,--no-entry -Wl,--strip-all -o "${out}" "${src}"`,
  { stdio: 'inherit' });
const bytes = fs.readFileSync(out);
console.log(`1. คอมไพล์สำเร็จ: ${bytes.length} ไบต์ / exports ครบ`);

const { instance } = await WebAssembly.instantiate(bytes);
const X = instance.exports;

// ---------- ตัวช่วย ----------
const px = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const ch = (p, i) => (p >>> (i * 8)) & 255;

function load(w, h, pixels) {
  assert.strictEqual(X.set_size(w, h), 0);
  new Uint32Array(X.memory.buffer, X.get_src(), w * h).set(pixels);
}
function readDst() {
  const w = X.out_w(), h = X.out_h();
  return { w, h, p: Array.from(new Uint32Array(X.memory.buffer, X.get_dst(), w * h)) };
}
function readSrc() {
  const w = X.cur_w(), h = X.cur_h();
  return { w, h, p: Array.from(new Uint32Array(X.memory.buffer, X.get_src(), w * h)) };
}
// ภาพทดสอบ: ทุกพิกเซลไม่ซ้ำกัน
function makeImg(w, h) {
  const p = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    p.push(px((x * 37 + y * 11) & 255, (x * 5 + y * 71) & 255, (x * 13 + y * 29 + 7) & 255));
  return p;
}
function rand(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function randImg(w, h, seed) {
  const r = rand(seed), p = [];
  for (let i = 0; i < w * h; i++) p.push(px(r() * 256 | 0, r() * 256 | 0, r() * 256 | 0, 255));
  return p;
}

// ---------- 2. sin/cos ที่เขียนเอง (ไม่มี libm) ----------
let maxErr = 0;
for (let d = -720; d <= 720; d += 0.5) {
  maxErr = Math.max(maxErr,
    Math.abs(X.sin_deg(d) - Math.sin(d * Math.PI / 180)),
    Math.abs(X.cos_deg(d) - Math.cos(d * Math.PI / 180)));
}
console.log(`\n2. sin_deg/cos_deg เทียบ Math.sin/cos (−720°..720°): ความคลาดเคลื่อนสูงสุด ${maxErr.toExponential(2)}`);
assert(maxErr < 1e-9);

// ---------- 3. rotate90 / flip / crop ----------
{
  const w = 5, h = 3, img = makeImg(w, h);
  const at = (x, y) => img[y * w + x];

  load(w, h, img);
  assert.strictEqual(X.rotate90(1), 0);
  let r = readDst();
  assert.deepStrictEqual([r.w, r.h], [h, w]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    assert.strictEqual(r.p[x * r.w + (h - 1 - y)], at(x, y)); // 90° ตามเข็ม
  X.rotate90(3); r = readDst();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    assert.strictEqual(r.p[(w - 1 - x) * r.w + y], at(x, y)); // 90° ทวนเข็ม
  X.rotate90(2); r = readDst();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    assert.strictEqual(r.p[(h - 1 - y) * w + (w - 1 - x)], at(x, y)); // 180°
  assert.strictEqual(X.rotate90(9), -1);
  assert.strictEqual(X.commit(), -1, 'commit หลังคำสั่งที่ล้มเหลวต้องถูกปฏิเสธ');

  // หมุน 90° ตามเข็ม 4 ครั้ง ต้องได้ภาพเดิม
  load(w, h, img);
  for (let i = 0; i < 4; i++) { assert.strictEqual(X.rotate90(1), 0); assert.strictEqual(X.commit(), 0); }
  assert.deepStrictEqual(readSrc().p, img);

  load(w, h, img);
  X.flip(1); r = readDst();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.strictEqual(r.p[y * w + x], at(w - 1 - x, y));
  X.flip(2); r = readDst();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.strictEqual(r.p[y * w + x], at(x, h - 1 - y));
  assert.strictEqual(X.flip(0), -1);

  X.crop(1, 1, 3, 2); r = readDst();
  assert.deepStrictEqual([r.w, r.h], [3, 2]);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) assert.strictEqual(r.p[y * 3 + x], at(x + 1, y + 1));
  X.crop(-2, -1, 4, 3); r = readDst();                 // ล้นขอบซ้าย/บน -> ตัดให้พอดี
  assert.deepStrictEqual([r.w, r.h], [2, 2]);
  assert.strictEqual(r.p[0], at(0, 0));
  X.crop(3, 1, 100, 100); r = readDst();               // ล้นขอบขวา/ล่าง
  assert.deepStrictEqual([r.w, r.h], [2, 2]);
  assert.strictEqual(X.crop(5, 0, 1, 1), -1);          // อยู่นอกภาพทั้งหมด
  assert.strictEqual(X.crop(0, 0, 0, 5), -1);
  assert.strictEqual(X.crop(2147483000, 0, 2147483000, 1), -1); // ไม่ overflow
  console.log('\n3. rotate90 / flip / crop เทียบ reference ถูกต้อง (รวมกรณีขอบและค่าผิดปกติ) ✅');
}

// ---------- 4. หมุนมุมใดก็ได้ ----------
{
  const w = 7, h = 4, img = makeImg(w, h);
  const BG = px(1, 2, 3, 255);

  // 90/180/270 ต้องเท่ากับ rotate90 แบบ pixel ต่อ pixel
  for (const [deg, mode] of [[90, 1], [180, 2], [270, 3], [-90, 3]]) {
    load(w, h, img);
    X.rotate90(mode); const ref = readDst();
    assert.strictEqual(X.rotate_any(deg, BG), 0);
    const got = readDst();
    assert.deepStrictEqual([got.w, got.h], [ref.w, ref.h], `ขนาด ${deg}°`);
    assert.deepStrictEqual(got.p, ref.p, `พิกเซล ${deg}°`);
  }
  load(w, h, img);
  X.rotate_any(0, BG);
  assert.deepStrictEqual(readDst().p, img);   // 0° = ภาพเดิม
  X.rotate_any(360, BG);
  assert.deepStrictEqual(readDst().p, img);   // 360° = ภาพเดิม

  // 45° บนภาพจัตุรัส 101x101 สีเดียว
  const N = 101, solid = new Array(N * N).fill(px(200, 100, 50));
  load(N, N, solid);
  assert.strictEqual(X.rotate_any(45, BG), 0);
  const r = readDst();
  const expect = Math.ceil(N * Math.SQRT2 - 1e-6);
  assert.deepStrictEqual([r.w, r.h], [expect, expect]);
  assert.strictEqual(r.p[0], BG, 'มุมภาพต้องเป็นสีพื้นหลัง');
  assert.strictEqual(r.p[r.w - 1], BG);
  assert.strictEqual(r.p[(r.h >> 1) * r.w + (r.w >> 1)], px(200, 100, 50), 'กึ่งกลางต้องเป็นสีภาพ');
  const inside = r.p.filter(v => v === px(200, 100, 50)).length;
  const ratio = inside / (N * N);
  console.log(`\n4. rotate_any: 90/180/270/−90 ตรงกับ rotate90, 0°/360° คงเดิม`);
  console.log(`   45° ของ ${N}x${N} → ${r.w}x${r.h}, พื้นที่ภาพคงอยู่ ${(ratio * 100).toFixed(1)}% ของต้นฉบับ`);
  assert(ratio > 0.97 && ratio < 1.03);
  assert.strictEqual(X.rotate_any(NaN, BG), -1);
  assert.strictEqual(X.rotate_any(1e12, BG), -1);

  // ขนาดผลลัพธ์เกินบัฟเฟอร์ต้องถูกปฏิเสธ ไม่เขียนเกินหน่วยความจำ
  assert.strictEqual(X.set_size(2000, 1000), 0);
  assert.strictEqual(X.rotate_any(45, BG), -1);
  assert.strictEqual(X.commit(), -1);
  assert.strictEqual(X.set_size(5000, 5000), -1);
  console.log('   ผลลัพธ์ใหญ่เกินบัฟเฟอร์ / ขนาดผิดปกติ ถูกปฏิเสธ (คืน −1) ✅');
}

// ---------- 5. resize ----------
{
  const w = 8, h = 6, img = randImg(w, h, 42);
  load(w, h, img);
  X.resize(w, h);
  assert.deepStrictEqual(readDst().p, img);       // ขนาดเท่าเดิม = ภาพเดิม

  X.resize(4, 3); let r = readDst();              // ย่อ 2 เท่า = เฉลี่ยบล็อก 2x2
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++)
    for (let c = 0; c < 3; c++) {
      const s = [0, 1].flatMap(dy => [0, 1].map(dx => ch(img[(2 * y + dy) * w + 2 * x + dx], c)))
        .reduce((a, b) => a + b, 0);
      assert.strictEqual(ch(r.p[y * 4 + x], c), Math.floor(s / 4 + 0.5));
    }
  load(3, 3, new Array(9).fill(px(10, 20, 30)));  // ขยายภาพสีเดียว ต้องยังเป็นสีเดิม
  X.resize(11, 7); r = readDst();
  assert(r.p.every(v => v === px(10, 20, 30)));
  assert.strictEqual(X.resize(0, 5), -1);
  assert.strictEqual(X.resize(5000, 5000), -1);
  console.log('\n5. resize: คงเดิมเมื่อขนาดเท่ากัน, ย่อ = เฉลี่ย 2x2 ตรงทุกช่อง, ขยายสีเดียวคงสี ✅');
}

// ---------- 6. สีและฟิลเตอร์ ----------
{
  const w = 17, h = 13, img = randImg(w, h, 7);
  const c255 = v => v < 0 ? 0 : v > 255 ? 255 : v;

  load(w, h, img);
  X.grayscale(); let r = readDst();
  img.forEach((p, i) => {
    const y = (ch(p, 0) * 77 + ch(p, 1) * 150 + ch(p, 2) * 29) >> 8;
    assert.strictEqual(r.p[i], px(y, y, y, ch(p, 3)));
  });
  X.invert(); r = readDst();
  img.forEach((p, i) => assert.strictEqual(r.p[i], px(255 - ch(p, 0), 255 - ch(p, 1), 255 - ch(p, 2), ch(p, 3))));
  for (const [b, c] of [[0, 100], [40, 100], [-60, 100], [0, 150], [20, 50], [0, 0]]) {
    X.brightness_contrast(b, c); r = readDst();
    img.forEach((p, i) => {
      const f = v => c255(Math.trunc(((v - 128) * c) / 100) + 128 + b);
      assert.strictEqual(r.p[i], px(f(ch(p, 0)), f(ch(p, 1)), f(ch(p, 2)), ch(p, 3)), `b=${b} c=${c}`);
    });
  }
  X.brightness_contrast(0, 100);
  assert.deepStrictEqual(readDst().p, img);

  const K = { 1: [[1, 2, 1, 2, 4, 2, 1, 2, 1], 16], 2: [[0, -1, 0, -1, 5, -1, 0, -1, 0], 1], 3: [[-1, -1, -1, -1, 8, -1, -1, -1, -1], 1] };
  for (const kind of [1, 2, 3]) {
    const [k, div] = K[kind];
    X.filter(kind); r = readDst();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ch(img[y * w + x], 3);
      let pxl = 0;
      const chans = [0, 1, 2].map(c => {
        let acc = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const yy = Math.min(h - 1, Math.max(0, y + j)), xx = Math.min(w - 1, Math.max(0, x + i));
          acc += k[(j + 1) * 3 + i + 1] * ch(img[yy * w + xx], c);
        }
        return c255(div > 1 ? Math.trunc((acc + div / 2) / div) : acc);
      });
      pxl = px(chans[0], chans[1], chans[2], o);
      assert.strictEqual(r.p[y * w + x], pxl, `filter ${kind} @(${x},${y})`);
    }
  }
  assert.strictEqual(X.filter(9), -1);

  // คุณสมบัติ: ภาพสีเดียว — blur/sharpen คงเดิม, edge = ดำ
  load(9, 9, new Array(81).fill(px(120, 80, 200)));
  X.filter(1); assert(readDst().p.every(v => v === px(120, 80, 200)));
  X.filter(2); assert(readDst().p.every(v => v === px(120, 80, 200)));
  X.filter(3); assert(readDst().p.every(v => v === px(0, 0, 0)));
  console.log('\n6. grayscale / invert / brightness_contrast / blur / sharpen / edge ตรงกับ reference ทุกพิกเซล ✅');
}

// ---------- 7. ไล่คำสั่งต่อเนื่อง + commit ----------
{
  load(6, 4, makeImg(6, 4));
  const steps = [() => X.crop(1, 0, 4, 4), () => X.rotate90(1), () => X.flip(1), () => X.resize(8, 6), () => X.filter(1)];
  for (const s of steps) { assert.strictEqual(s(), 0); assert.strictEqual(X.commit(), 0); }
  assert.deepStrictEqual([X.cur_w(), X.cur_h()], [8, 6]);
  assert.strictEqual(X.commit(), -1, 'commit ซ้ำโดยไม่มีคำสั่งใหม่ต้องล้มเหลว');
  console.log('\n7. ไล่ crop → rotate → flip → resize → blur ต่อเนื่องด้วย commit ได้ภาพ 8x6 ✅');
}

// ---------- 8. Benchmark ----------
{
  const W = 1024, H = 1024;
  load(W, H, randImg(W, H, 1));
  const time = (name, f) => { const t = performance.now(); assert.strictEqual(f(), 0); return `${name} ${(performance.now() - t).toFixed(1)}ms`; };
  console.log('\n8. Benchmark ภาพ 1024x1024:');
  console.log('   ' + [
    time('rotate90', () => X.rotate90(1)),
    time('rotate_any(30°)', () => X.rotate_any(30, 0xFF000000)),
    time('resize→512', () => X.resize(512, 512)),
    time('blur', () => X.filter(1)),
    time('grayscale', () => X.grayscale()),
  ].join(' | '));
}

console.log(`\n🎉 ผ่านทุกขั้นตอน (เก็บ ${path.basename(out)} ไว้ให้ imgproc.html ใช้งาน)`);
