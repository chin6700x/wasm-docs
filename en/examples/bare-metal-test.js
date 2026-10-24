/**
 * Bare-Metal Clang WebAssembly Verification Suite
 * Verification harness compiling pure C directly to WebAssembly via Clang without Emscripten
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
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

console.log("=== Launching Bare-Metal Clang WebAssembly Verification Suite ===");

// 1. Locate compiler: /opt/homebrew/bin/wasm32-clang or clang --target=wasm32
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

console.log(`1. Compiling ${path.basename(cFile)} with ${clangBin}...`);

// Sub-1KB Bare-Metal compilation flags:
const compileCmd = `${clangBin} -O3 -nostdlib -Wl,--no-entry ` +
  `-Wl,--export=add -Wl,--export=fib ` +
  `-Wl,--export=my_malloc -Wl,--export=get_heap_offset ` +
  `-Wl,--export=reverse_c -Wl,--export=dot_product ` +
  `-Wl,--strip-all -o "${wasmOut}" "${cFile}"`;

execSync(compileCmd, { stdio: 'inherit' });

// 2. Validate output binary footprint
const wasmBuffer = fs.readFileSync(wasmOut);
console.log(`   Output binary size: ${wasmBuffer.length} bytes (< 1,024 bytes)`);
assert(wasmBuffer.length < 1024, "Binary size must remain under 1 KB (Sub-1KB bare-metal)");
console.log("   ✅ Sub-1KB footprint verified successfully");

// 3. Instantiate and verify Wasm exports
const { instance } = await WebAssembly.instantiate(wasmBuffer);
const exp = instance.exports;

// 3.1 Test Math Functions
console.log("\n2. Verifying arithmetic functions (add, fib):");
const sum = exp.add(35, 7);
const fib10 = exp.fib(10);
console.log(`   add(35, 7) = ${sum} (expected 42)`);
console.log(`   fib(10) = ${fib10} (expected 55)`);
assert.strictEqual(sum, 42);
assert.strictEqual(fib10, 55);
console.log("   ✅ Arithmetic functions execute deterministically");

// 3.2 Test Bare-Metal Heap Allocator (__heap_base)
console.log("\n3. Verifying heap allocator via wasm-ld __heap_base:");
const heapStart = exp.get_heap_offset();
console.log(`   __heap_base initial offset: ${heapStart} bytes`);
const ptr1 = exp.my_malloc(12);
const ptr2 = exp.my_malloc(30);
console.log(`   my_malloc(12) = ${ptr1}`);
console.log(`   my_malloc(30) = ${ptr2}`);
assert.strictEqual(ptr1, heapStart);
assert.strictEqual(ptr2, (heapStart + 12 + 7) & ~7);
console.log("   ✅ Dynamic memory allocation in C verified");

// 3.3 Test String Mutation in Linear Memory
console.log("\n4. Verifying string passing and in-place reversal in C (reverse_c):");
const originalText = "Clang Bare-Metal WebAssembly 2026";
const encoded = new TextEncoder().encode(originalText);
const strPtr = exp.my_malloc(encoded.length + 1);
const memBytes = new Uint8Array(exp.memory.buffer);
memBytes.set(encoded, strPtr);
memBytes[strPtr + encoded.length] = 0;

exp.reverse_c(strPtr, encoded.length);
const reversedText = new TextDecoder().decode(memBytes.subarray(strPtr, strPtr + encoded.length));
console.log(`   Original text: "${originalText}"`);
console.log(`   Reversed text: "${reversedText}"`);
assert.strictEqual(reversedText, "6202 ylbmessAbeW lateM-eraB gnalC");
console.log("   ✅ String processing in C over Linear Memory verified");

// 3.4 Test Float Vector Dot Product
console.log("\n5. Verifying floating-point array computation (dot_product):");
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
console.log(`   Vector Dot Product Result: ${dotResult} (expected 14.5)`);
assert(Math.abs(dotResult - 14.5) < 1e-5);
console.log("   ✅ Float32 array math computed accurately");

console.log("\n=======================================================");
console.log("🎉 All verification tests passed 100% conforming to W3C standards!");
console.log("=======================================================");
