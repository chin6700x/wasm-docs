/**
 * Bare-Metal Clang WebAssembly Verification Suite
 * ชุดทดสอบการคอมไพล์ภาษา C ตรงสู่ WebAssembly ด้วย Clang โดยไม่ใช้ Emscripten
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

const cFile = path.join(__dirname, 'bare-metal.c');
const wasmOut = path.join(__dirname, 'bare-metal.wasm');

console.log("=== เริ่มทดสอบ Bare-Metal Clang WebAssembly Toolchain ===");

// 1. ตรวจสอบ Compiler: /opt/homebrew/bin/wasm32-clang หรือ clang ทั่วไป
let clangBin = 'wasm32-clang';
try {
  execSync(`${clangBin} --version`, { stdio: 'ignore' });
} catch {
  if (fs.existsSync('/opt/homebrew/bin/wasm32-clang')) {
    clangBin = '/opt/homebrew/bin/wasm32-clang';
  } else {
    clangBin = 'clang --target=wasm32';
  }
}

console.log(`1. คอมไพล์ ${path.basename(cFile)} ด้วย ${clangBin}...`);

// คำสั่งคอมไพล์ Bare-metal แบบ Sub-1KB:
const compileCmd = `${clangBin} -O3 -nostdlib -Wl,--no-entry ` +
  `-Wl,--export=add -Wl,--export=fib ` +
  `-Wl,--export=my_malloc -Wl,--export=get_heap_offset ` +
  `-Wl,--export=reverse_c -Wl,--export=dot_product ` +
  `-Wl,--strip-all -o "${wasmOut}" "${cFile}"`;

execSync(compileCmd, { stdio: 'inherit' });

// 2. ตรวจสอบขนาดไฟล์ไบนารี
const wasmBuffer = fs.readFileSync(wasmOut);
console.log(`   ขนาดไบนารีผลลัพธ์: ${wasmBuffer.length} ไบต์ (< 1,024 ไบต์)`);
assert(wasmBuffer.length < 1024, "ขนาดไบนารีต้องเล็กกว่า 1 KB (Sub-1KB bare-metal)");
console.log("   ✅ รับรองขนาดเล็กกะทัดรัดระดับ Sub-1KB สำเร็จ");

// 3. ทดสอบการรันบน WebAssembly Instance
const { instance } = await WebAssembly.instantiate(wasmBuffer);
const exp = instance.exports;

// 3.1 ทดสอบ Math Functions
console.log("\n2. ตรวจสอบฟังก์ชันคณิตศาสตร์ (add, fib):");
const sum = exp.add(35, 7);
const fib10 = exp.fib(10);
console.log(`   add(35, 7) = ${sum} (คาดหวัง 42)`);
console.log(`   fib(10) = ${fib10} (คาดหวัง 55)`);
assert.strictEqual(sum, 42);
assert.strictEqual(fib10, 55);
console.log("   ✅ ฟังก์ชันคณิตศาสตร์ทำงานถูกต้อง");

// 3.2 ตรวจสอบ Bare-metal Heap Allocator (__heap_base)
console.log("\n3. ตรวจสอบ Heap Allocator ผ่าน wasm-ld __heap_base:");
const heapStart = exp.get_heap_offset();
console.log(`   __heap_base ตำแหน่งเริ่มต้น: ${heapStart} ไบต์`);
const ptr1 = exp.my_malloc(12);
const ptr2 = exp.my_malloc(30);
console.log(`   my_malloc(12) = ${ptr1}`);
console.log(`   my_malloc(30) = ${ptr2}`);
assert.strictEqual(ptr1, heapStart);
assert.strictEqual(ptr2, (heapStart + 12 + 7) & ~7);
console.log("   ✅ Dynamic Memory Allocation ในระดับ C ทำงานแม่นยำ");

// 3.3 ทดสอบการประมวลผล String ใน Linear Memory
console.log("\n4. ตรวจสอบการส่งสตริงและกลับอักษรใน C (reverse_c):");
const originalText = "Clang Bare-Metal WebAssembly 2026";
const encoded = new TextEncoder().encode(originalText);
const strPtr = exp.my_malloc(encoded.length + 1);
const memBytes = new Uint8Array(exp.memory.buffer);
memBytes.set(encoded, strPtr);
memBytes[strPtr + encoded.length] = 0;

exp.reverse_c(strPtr, encoded.length);
const reversedText = new TextDecoder().decode(memBytes.subarray(strPtr, strPtr + encoded.length));
console.log(`   ข้อความต้นฉบับ: "${originalText}"`);
console.log(`   ข้อความหลังกลับอักษรใน C: "${reversedText}"`);
assert.strictEqual(reversedText, "6202 ylbmessAbeW lateM-eraB gnalC");
console.log("   ✅ การประมวลผลสตริงใน C ผ่าน Linear Memory สำเร็จ");

// 3.4 ทดสอบ Float Vector Dot Product
console.log("\n5. ตรวจสอบการประมวลผล Array ทศนิยม (dot_product):");
const n = 4;
const vecAPtr = exp.my_malloc(n * 4);
const vecBPtr = exp.my_malloc(n * 4);
const floatView = new Float32Array(exp.memory.buffer);

const aValues = [1.5, 2.0, 3.5, 4.0];
const bValues = [2.0, 3.0, 1.0, 0.5];
// dot product = (1.5*2) + (2*3) + (3.5*1) + (4*0.5) = 3 + 6 + 3.5 + 2 = 14.5

floatView.set(aValues, vecAPtr / 4);
floatView.set(bValues, vecBPtr / 4);

const dotResult = exp.dot_product(vecAPtr, vecBPtr, n);
console.log(`   Vector Dot Product Result: ${dotResult} (คาดหวัง 14.5)`);
assert(Math.abs(dotResult - 14.5) < 1e-5);
console.log("   ✅ Float32 Array Math ประมวลผลได้ถูกต้อง");

console.log("\n=======================================================");
console.log("🎉 ผลการทดสอบผ่านทุกขั้นตอน 100% สมบูรณ์แบบตามมาตรฐาน W3C!");
console.log("=======================================================");
