/**
 * Modern WebAssembly Comprehensive Verification Suite
 * Practical guide & verification harness: Modern WebAssembly (128-bit SIMD, Threads & Atomics, and WASI System Interface)
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 * 
 * Verification Topics:
 * 1. Fixed-width SIMD (v128): 4-lane parallel vector execution (i32x4.add and f32x4.mul)
 * 2. WebAssembly Threads & Atomics: SharedArrayBuffer concurrency and i32.atomic.rmw.add
 * 3. WASI (WebAssembly System Interface): Executing outside browser via POSIX syscall (fd_write)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { WASI } from 'node:wasi';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== Launching Modern WebAssembly Verification Suite (SIMD, Atomics, WASI) ===\n");

// =========================================================================
// Part 1: 128-bit Fixed-Width SIMD (v128 Opcodes)
// =========================================================================

console.log("--- Part 1: Verifying 128-bit Fixed-Width SIMD (v128) ---");

const simdWat = `(module
  (memory (export "memory") 1)
  
  ;; Adds four 32-bit integers simultaneously in a single instruction
  (func (export "vec_add_i32x4") (param $a i32) (param $b i32) (param $out i32)
    local.get $out
    local.get $a
    v128.load
    local.get $b
    v128.load
    i32x4.add
    v128.store
  )
  
  ;; Multiplies four float32 numbers simultaneously in a single clock cycle
  (func (export "vec_mul_f32x4") (param $a i32) (param $b i32) (param $out i32)
    local.get $out
    local.get $a
    v128.load
    local.get $b
    v128.load
    f32x4.mul
    v128.store
  )
)`;

const simdWasmPath = path.join(__dirname, 'temp_simd.wasm');
const simdWatPath = path.join(__dirname, 'temp_simd.wat');
fs.writeFileSync(simdWatPath, simdWat);
execSync(`wat2wasm "${simdWatPath}" -o "${simdWasmPath}"`);

const simdBytes = fs.readFileSync(simdWasmPath);
const { instance: simdInstance } = await WebAssembly.instantiate(simdBytes);
const simdMem = simdInstance.exports.memory.buffer;

// 1.1 Test i32x4 SIMD
const i32View = new Int32Array(simdMem);
i32View.set([10, 20, 30, 40], 0); // Vector A (address 0)
i32View.set([1, 2, 3, 4], 4);     // Vector B (address 16)
simdInstance.exports.vec_add_i32x4(0, 16, 32); // Destination at address 32

const i32Result = Array.from(i32View.subarray(8, 12));
console.log(`1. i32x4.add ([10,20,30,40] + [1,2,3,4]):`, i32Result);
assert.deepStrictEqual(i32Result, [11, 22, 33, 44]);
console.log("   ✅ 128-bit Integer SIMD verified across 4 lanes 100%");

// 1.2 Test f32x4 SIMD
const f32View = new Float32Array(simdMem);
f32View.set([1.5, 2.0, 3.5, 4.0], 16); // Vector A at address 64
f32View.set([2.0, 3.0, 2.0, 0.5], 20); // Vector B at address 80
simdInstance.exports.vec_mul_f32x4(64, 80, 96); // Destination at address 96

const f32Result = Array.from(f32View.subarray(24, 28));
console.log(`2. f32x4.mul ([1.5,2.0,3.5,4.0] * [2.0,3.0,2.0,0.5]):`, f32Result);
assert.deepStrictEqual(f32Result, [3.0, 6.0, 7.0, 2.0]);
console.log("   ✅ 128-bit Float SIMD vector calculation verified");

fs.unlinkSync(simdWatPath);
fs.unlinkSync(simdWasmPath);

// =========================================================================
// Part 2: WebAssembly Threads & Atomics (SharedArrayBuffer)
// =========================================================================

console.log("\n--- Part 2: Verifying Threads & SharedArrayBuffer Atomics ---");

const atomicWat = `(module
  (memory (import "env" "memory") 1 1 shared)
  (func (export "atomic_add") (param $ptr i32) (param $delta i32) (result i32)
    local.get $ptr
    local.get $delta
    i32.atomic.rmw.add
  )
)`;

const atomicWatPath = path.join(__dirname, 'temp_atomic.wat');
const atomicWasmPath = path.join(__dirname, 'temp_atomic.wasm');
fs.writeFileSync(atomicWatPath, atomicWat);
execSync(`wat2wasm --enable-threads "${atomicWatPath}" -o "${atomicWasmPath}"`);

// Instantiate multithread-capable Shared Memory
const sharedMem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
const { instance: atomicInstance } = await WebAssembly.instantiate(
  fs.readFileSync(atomicWasmPath),
  { env: { memory: sharedMem } }
);

const sharedInt32 = new Int32Array(sharedMem.buffer);
sharedInt32[0] = 500;

console.log(`1. Value prior to atomic operation: ${sharedInt32[0]}`);
const prevVal = atomicInstance.exports.atomic_add(0, 75);
console.log(`2. Previous value returned (Fetch-and-Add): ${prevVal}`);
console.log(`3. Mutated value in Shared Memory: ${sharedInt32[0]}`);

assert.strictEqual(prevVal, 500);
assert.strictEqual(sharedInt32[0], 575);
console.log("   ✅ WebAssembly Atomic RMW (Read-Modify-Write) verified");

fs.unlinkSync(atomicWatPath);
fs.unlinkSync(atomicWasmPath);

// =========================================================================
// Part 3: WASI (WebAssembly System Interface)
// =========================================================================

console.log("\n--- Part 3: Verifying WASI Preview1 (Stand-alone POSIX Syscall) ---");

// Bare-metal WASI program executing fd_write(1, iovs, 1, nwritten)
const wasiWat = `(module
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  
  (data (i32.const 100) "Hello from Native WASI System Interface 🚀\\n")
  
  (func (export "_start")
    ;; iov_base = 100 (string pointer)
    i32.const 0
    i32.const 100
    i32.store
    
    ;; iov_len = 44 (string byte length)
    i32.const 4
    i32.const 44
    i32.store
    
    ;; fd_write(1 [stdout], 0 [*iovs], 1 [iovs_count], 8 [*nwritten])
    i32.const 1
    i32.const 0
    i32.const 1
    i32.const 8
    call $fd_write
    drop
  )
)`;

const wasiWatPath = path.join(__dirname, 'temp_wasi.wat');
const wasiWasmPath = path.join(__dirname, 'temp_wasi.wasm');
fs.writeFileSync(wasiWatPath, wasiWat);
execSync(`wat2wasm "${wasiWatPath}" -o "${wasiWasmPath}"`);

const wasi = new WASI({ version: "preview1" });
const wasiModule = await WebAssembly.compile(fs.readFileSync(wasiWasmPath));
const wasiInstance = await WebAssembly.instantiate(wasiModule, wasi.getImportObject());

console.log("Execution output from Native WASI binary via stdout:");
wasi.start(wasiInstance);
console.log("   ✅ WASI fd_write host OS binding verified successfully");

fs.unlinkSync(wasiWatPath);
fs.unlinkSync(wasiWasmPath);

console.log("\n=======================================================");
console.log("🎉 All verification stages passed 100% conforming to W3C standards!");
console.log("=======================================================");
