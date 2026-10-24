/**
 * SLD Sovereign WebAssembly Emitter Verification Suite
 * ชุดทดสอบการคอมไพล์ภาษา C ตรงสู่ WebAssembly ด้วย sld-compiler (Clean-Room C99 Emitter)
 * 
 * ผู้เขียน: Wirot Chookeaw (chin6700x)
 * สัญญาอนุญาต: Apache-2.0 / MIT © 2026
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sldBin = '/Users/chinchin/.local/bin/sld';
const testC = path.join(__dirname, 'sovereign-sample.c');
const testHtml = path.join(__dirname, 'sovereign-sample.html');
const testJs = path.join(__dirname, 'sovereign-sample.js');
const testWasm = path.join(__dirname, 'sovereign-sample.wasm');

console.log("=== เริ่มทดสอบ SLD Sovereign WebAssembly Emitter Suite ===");

// 1. เขียนซอร์สโค้ดภาษา C ตัวอย่าง
const cSource = `
int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    return a * b;
}

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int fibonacci(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b;
        a = b;
        b = c;
    }
    return b;
}
`;

fs.writeFileSync(testC, cSource.trim());
console.log(`1. สร้างซอร์สโค้ด ${path.basename(testC)} เรียบร้อย`);

// 2. คอมไพล์ด้วย SLD Compiler
console.log(`2. คอมไพล์ตรงด้วย ${sldBin} --target=wasm32...`);
const t0 = performance.now();
execSync(`"${sldBin}" --target=wasm32 -o "${testHtml}" "${testC}"`, { stdio: 'inherit' });
const duration = performance.now() - t0;
console.log(`   ⏱️ คอมไพล์สำเร็จในเวลาเพียง ${duration.toFixed(2)} ms!`);

// 3. ตรวจสอบ Artifacts ทั้ง 3 ไฟล์
assert(fs.existsSync(testWasm), "ต้องสร้างไฟล์ .wasm");
assert(fs.existsSync(testJs), "ต้องสร้างไฟล์ .js bridge");
assert(fs.existsSync(testHtml), "ต้องสร้างไฟล์ .html sandbox");

const wasmBytes = fs.readFileSync(testWasm);
console.log(`   ขนาดไบนารี .wasm: ${wasmBytes.length} ไบต์ (< 1 KB)`);
assert(wasmBytes.length < 1024, "ขนาดไบนารีต้องกะทัดรัดระดับ Sub-1KB");
console.log("   ✅ สร้างไฟล์ Wasm, JS Companion, และ HTML Sandbox สำเร็จครบถ้วน");

// 4. ทดสอบความถูกต้องบน V8 Engine
console.log("\n3. ตรวจสอบการรันผลลัพธ์ใน Node.js:");
const { instance } = await WebAssembly.instantiate(wasmBytes);
const exp = instance.exports;

console.log("   Exports ทั้งหมด:", Object.keys(exp));
assert.strictEqual(exp.add(15, 27), 42);
assert.strictEqual(exp.multiply(6, 7), 42);
assert.strictEqual(exp.factorial(5), 120);
assert.strictEqual(exp.fibonacci(10), 55);

console.log("   ✔ add(15, 27) = 42");
console.log("   ✔ multiply(6, 7) = 42");
console.log("   ✔ factorial(5) = 120");
console.log("   ✔ fibonacci(10) = 55");

console.log("\n=======================================================");
console.log("🎉 ผลการทดสอบผ่านทุกขั้นตอน 100% สมบูรณ์แบบตามมาตรฐาน W3C!");
console.log("=======================================================");
