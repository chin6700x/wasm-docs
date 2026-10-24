/**
 * WebAssembly Linear Memory Comprehensive Verification Suite
 * Practical guide & verification harness: Linear Memory management in WebAssembly
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 * 
 * Verification Topics:
 * 1. Little-Endian Store & Load (8-bit, 16-bit, 32-bit)
 * 2. Sign-extension (load8_u vs load8_s, load16_u vs load16_s)
 * 3. JS TypedArray & DataView zero-copy bridge
 * 4. UTF-8 String exchange through Linear Memory
 * 5. memory.size & memory.grow (including Detached Buffer Gotcha)
 * 6. WebAssembly Bump Allocator (malloc implemented at bytecode level)
 * 7. Memory Bounds Trap (RuntimeError) & Max Limit Enforcement
 */

import assert from 'node:assert';

// --- Binary Encoding Utility Helpers ---
function uleb128(n) {
  const bytes = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    bytes.push(b);
  } while (n !== 0);
  return bytes;
}

function sleb128(n) {
  const bytes = [];
  let more = true;
  while (more) {
    let byte = n & 0x7f;
    n >>= 7; // sign-propagating shift
    if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function makeSection(id, payload) {
  return [id, ...uleb128(payload.length), ...payload];
}

function makeExport(name, kind, index) {
  const nameBytes = Buffer.from(name, "utf8");
  return [...uleb128(nameBytes.length), ...nameBytes, kind, index];
}

function makeFunctionBody(locals, instructions) {
  const localDecl = locals.length === 0
    ? [0]
    : [locals.length, ...locals.flatMap(l => [l[0], l[1]])];
  const body = [...localDecl, ...instructions];
  return [...uleb128(body.length), ...body];
}

// =========================================================================
// Assembling WebAssembly Binary Module Architecture
// =========================================================================

// Section 1: Type Section
// Type 0: (i32, i32) -> ()    [store32, store16, store8]
// Type 1: (i32) -> (i32)       [load32, load16_u, load16_s, load8_u, load8_s, mem_grow, malloc]
// Type 2: () -> (i32)          [mem_size, get_heap_ptr]
// Type 3: () -> ()             [reset_heap]
const typeSection = makeSection(1, [
  4, // 4 types
  0x60, 2, 0x7f, 0x7f, 0, // 0: (i32, i32) -> ()
  0x60, 1, 0x7f, 1, 0x7f, // 1: (i32) -> (i32)
  0x60, 0, 1, 0x7f,       // 2: () -> (i32)
  0x60, 0, 0              // 3: () -> ()
]);

// Section 3: Function Section (Maps function indices 0..12 to type descriptors)
const funcSection = makeSection(3, [
  13, // 13 functions
  0,  // func 0:  store32
  1,  // func 1:  load32
  0,  // func 2:  store16
  1,  // func 3:  load16_u
  1,  // func 4:  load16_s
  0,  // func 5:  store8
  1,  // func 6:  load8_u
  1,  // func 7:  load8_s
  2,  // func 8:  mem_size
  1,  // func 9:  mem_grow
  1,  // func 10: malloc
  2,  // func 11: get_heap_ptr
  3   // func 12: reset_heap
]);

// Section 5: Memory Section
// 1 Memory instance: flags=0x01 (explicit min and max), min=1 (64KB), max=4 (256KB)
const memSection = makeSection(5, [
  1,    // count = 1
  0x01, // flag 1: has maximum
  1,    // min = 1 page (65,536 bytes)
  4     // max = 4 pages (262,144 bytes)
]);

// Section 6: Global Section
// Global 0: mut i32 = 1024 (Heap starts at offset 1024 to preserve first 1KB for static/stack)
const globSection = makeSection(6, [
  1,          // count = 1
  0x7f, 0x01, // type i32, mutable = 1
  0x41, ...sleb128(1024), 0x0b // i32.const 1024, end
]);

// Section 7: Export Section
const exportSection = makeSection(7, [
  14, // 14 exports
  ...makeExport("memory",       0x02, 0),
  ...makeExport("store32",      0x00, 0),
  ...makeExport("load32",       0x00, 1),
  ...makeExport("store16",      0x00, 2),
  ...makeExport("load16_u",     0x00, 3),
  ...makeExport("load16_s",     0x00, 4),
  ...makeExport("store8",       0x00, 5),
  ...makeExport("load8_u",      0x00, 6),
  ...makeExport("load8_s",      0x00, 7),
  ...makeExport("mem_size",     0x00, 8),
  ...makeExport("mem_grow",     0x00, 9),
  ...makeExport("malloc",       0x00, 10),
  ...makeExport("get_heap_ptr", 0x00, 11),
  ...makeExport("reset_heap",   0x00, 12)
]);

// Section 10: Code Section
// Load/Store instructions follow format: [opcode] [align: u32] [offset: u32]
// align = power-of-2 exponent (2 = 2^2 = 4 bytes, 1 = 2^1 = 2 bytes, 0 = 2^0 = 1 byte)

// 0: store32(addr, val) -> addr + 0 = val
const f0_store32 = makeFunctionBody([], [
  0x20, 0,       // local.get 0 (addr)
  0x20, 1,       // local.get 1 (val)
  0x36, 2, 0,    // i32.store align=2(4B), offset=0
  0x0b           // end
]);

// 1: load32(addr) -> *(i32*)(addr)
const f1_load32 = makeFunctionBody([], [
  0x20, 0,       // local.get 0 (addr)
  0x28, 2, 0,    // i32.load align=2(4B), offset=0
  0x0b           // end
]);

// 2: store16(addr, val)
const f2_store16 = makeFunctionBody([], [
  0x20, 0,
  0x20, 1,
  0x3b, 1, 0,    // i32.store16 align=1(2B), offset=0
  0x0b
]);

// 3: load16_u(addr) -> Zero-extended 16-bit
const f3_load16_u = makeFunctionBody([], [
  0x20, 0,
  0x2f, 1, 0,    // i32.load16_u align=1(2B), offset=0
  0x0b
]);

// 4: load16_s(addr) -> Sign-extended 16-bit
const f4_load16_s = makeFunctionBody([], [
  0x20, 0,
  0x2e, 1, 0,    // i32.load16_s align=1(2B), offset=0
  0x0b
]);

// 5: store8(addr, val)
const f5_store8 = makeFunctionBody([], [
  0x20, 0,
  0x20, 1,
  0x3a, 0, 0,    // i32.store8 align=0(1B), offset=0
  0x0b
]);

// 6: load8_u(addr) -> Zero-extended 8-bit
const f6_load8_u = makeFunctionBody([], [
  0x20, 0,
  0x2d, 0, 0,    // i32.load8_u align=0(1B), offset=0
  0x0b
]);

// 7: load8_s(addr) -> Sign-extended 8-bit
const f7_load8_s = makeFunctionBody([], [
  0x20, 0,
  0x2c, 0, 0,    // i32.load8_s align=0(1B), offset=0
  0x0b
]);

// 8: mem_size() -> i32 (Returns current allocated page count)
const f8_mem_size = makeFunctionBody([], [
  0x3f, 0x00,    // memory.size 0x00
  0x0b
]);

// 9: mem_grow(delta_pages) -> i32 (Returns old page count before grow, or -1 on failure)
const f9_mem_grow = makeFunctionBody([], [
  0x20, 0,       // local.get 0 (delta_pages)
  0x40, 0x00,    // memory.grow 0x00
  0x0b
]);

// 10: malloc(size) -> ptr
// Bytecode-level Bump Allocator logic:
//   old_ptr = global[0]
//   new_ptr = (old_ptr + size + 7) & ~7  (Align to 8-byte boundary)
//   global[0] = new_ptr
//   return old_ptr
const f10_malloc = makeFunctionBody(
  [[2, 0x7f]], // 2 locals of type i32: local 1 (old_ptr), local 2 (new_ptr)
  [
    // local 1 = global[0]
    0x23, 0,
    0x21, 1,

    // new_ptr = (old_ptr + size + 7) & -8
    0x20, 1,       // local.get 1 (old_ptr)
    0x20, 0,       // local.get 0 (size)
    0x6a,          // i32.add
    0x41, 7,       // i32.const 7
    0x6a,          // i32.add
    0x41, ...sleb128(-8), // i32.const -8 (0x78 in SLEB128)
    0x71,          // i32.and
    0x21, 2,       // local.set 2 (new_ptr)

    // global[0] = new_ptr
    0x20, 2,
    0x24, 0,

    // return old_ptr
    0x20, 1,
    0x0b
  ]
);

// 11: get_heap_ptr() -> i32
const f11_get_heap = makeFunctionBody([], [
  0x23, 0, // global.get 0
  0x0b
]);

// 12: reset_heap() -> ()
const f12_reset_heap = makeFunctionBody([], [
  0x41, ...sleb128(1024), // i32.const 1024
  0x24, 0,                // global.set 0
  0x0b
]);

const codeSection = makeSection(10, [
  13, // 13 function bodies
  ...f0_store32,
  ...f1_load32,
  ...f2_store16,
  ...f3_load16_u,
  ...f4_load16_s,
  ...f5_store8,
  ...f6_load8_u,
  ...f7_load8_s,
  ...f8_mem_size,
  ...f9_mem_grow,
  ...f10_malloc,
  ...f11_get_heap,
  ...f12_reset_heap
]);

const wasmBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // \0asm
  0x01, 0x00, 0x00, 0x00, // Version 1
  ...typeSection,
  ...funcSection,
  ...memSection,
  ...globSection,
  ...exportSection,
  ...codeSection
]);

// =========================================================================
// Verification Test Execution
// =========================================================================

console.log("=== Launching WebAssembly Linear Memory Test Suite ===");
console.log(`Generated binary module footprint: ${wasmBytes.length} bytes\n`);

const module = new WebAssembly.Module(wasmBytes);
const instance = new WebAssembly.Instance(module);
const exp = instance.exports;

// --- Test 1: 32-bit Little-Endian Store & Load ---
console.log("1. Verifying 32-bit Little-Endian Store & Load:");
exp.store32(64, 0x12345678);
const readVal32 = exp.load32(64);
assert.strictEqual(readVal32, 0x12345678, "32-bit load must match stored value exactly");

// Inspect raw byte arrangement via TypedArray from JavaScript
const memBytes = new Uint8Array(exp.memory.buffer);
console.log(`   Address 64..67: [0x${memBytes[64].toString(16)}, 0x${memBytes[65].toString(16)}, 0x${memBytes[66].toString(16)}, 0x${memBytes[67].toString(16)}]`);
assert.strictEqual(memBytes[64], 0x78, "Byte 0 must be LSB (0x78)");
assert.strictEqual(memBytes[65], 0x56, "Byte 1 must be 0x56");
assert.strictEqual(memBytes[66], 0x34, "Byte 2 must be 0x34");
assert.strictEqual(memBytes[67], 0x12, "Byte 3 must be MSB (0x12)");
console.log("   ✅ Little-Endian byte arrangement confirmed 100%");

// --- Test 2: 8-bit Sign vs Zero Extension ---
console.log("\n2. Verifying 8-bit Sign vs Zero Extension:");
exp.store8(100, 0xFE); // 0xFE = 254 (unsigned) or -2 (signed 8-bit two's complement)
const val8_u = exp.load8_u(100);
const val8_s = exp.load8_s(100);
console.log(`   load8_u(100) = ${val8_u} (expected 254)`);
console.log(`   load8_s(100) = ${val8_s} (expected -2)`);
assert.strictEqual(val8_u, 254, "load8_u must zero-extend");
assert.strictEqual(val8_s, -2, "load8_s must sign-extend to negative value");
console.log("   ✅ 8-bit sign-extension behavior confirmed");

// --- Test 3: 16-bit Sign vs Zero Extension ---
console.log("\n3. Verifying 16-bit Sign vs Zero Extension:");
exp.store16(120, 0xFF80); // 0xFF80 = 65408 (unsigned) or -128 (signed 16-bit)
const val16_u = exp.load16_u(120);
const val16_s = exp.load16_s(120);
console.log(`   load16_u(120) = ${val16_u} (expected 65408)`);
console.log(`   load16_s(120) = ${val16_s} (expected -128)`);
assert.strictEqual(val16_u, 65408, "load16_u must zero-extend");
assert.strictEqual(val16_s, -128, "load16_s must sign-extend");
console.log("   ✅ 16-bit load/store verified");

// --- Test 4: UTF-8 String Marshaling through Linear Memory ---
console.log("\n4. Verifying UTF-8 String transfer through Linear Memory:");
const testString = "WebAssembly Linear Memory UTF-8 Bridge 🚀 2026";
const encoded = Buffer.from(testString, "utf8");
const strPtr = 200;

// Zero-copy direct memory write from JS
memBytes.set(encoded, strPtr);
memBytes[strPtr + encoded.length] = 0; // Null-terminator

// Decode string back via TextDecoder
const decoder = new TextDecoder("utf-8");
const decodedString = decoder.decode(new Uint8Array(exp.memory.buffer, strPtr, encoded.length));
console.log(`   Injected string: "${testString}"`);
console.log(`   Decoded string:  "${decodedString}"`);
assert.strictEqual(decodedString, testString, "Injected and decoded strings must match byte-for-byte");
console.log("   ✅ UTF-8 string exchange verified seamlessly");

// --- Test 5: Bump Allocator (malloc inside Wasm) ---
console.log("\n5. Verifying Minimal Bump Allocator (8-byte alignment):");
const initialHeap = exp.get_heap_ptr();
console.log(`   Initial heap base: ${initialHeap} bytes`);

const ptr1 = exp.malloc(13); // Request 13 bytes
console.log(`   malloc(13) returned pointer: ${ptr1}`);
assert.strictEqual(ptr1, 1024, "ptr1 must start at offset 1024");
assert.strictEqual(exp.get_heap_ptr(), 1040, "Next heap pointer must align to 1040 (8-byte aligned)");

const ptr2 = exp.malloc(1); // Request 1 byte
console.log(`   malloc(1) returned pointer: ${ptr2}`);
assert.strictEqual(ptr2, 1040, "ptr2 must start at offset 1040");
assert.strictEqual(exp.get_heap_ptr(), 1048, "Next heap pointer must align to 1048 (8-byte aligned)");
console.log("   ✅ Bump Allocator strictly enforces 8-byte alignment");

// --- Test 6: memory.size & memory.grow (including Detached Buffer Gotcha) ---
console.log("\n6. Verifying memory expansion (memory.grow) and Detached Buffer phenomenon:");
const initPages = exp.mem_size();
console.log(`   Initial allocated pages: ${initPages} page (${initPages * 64} KB)`);
assert.strictEqual(initPages, 1);

// Retain reference to old ArrayBuffer to verify detachment
const oldBuffer = exp.memory.buffer;
assert.strictEqual(oldBuffer.byteLength, 65536);

// Grow memory by 2 pages (from 1 -> 3 pages)
const prevPages = exp.mem_grow(2);
console.log(`   mem_grow(2) returned previous page count: ${prevPages}`);
assert.strictEqual(prevPages, 1);
assert.strictEqual(exp.mem_size(), 3, "New allocated page count must equal 3");

// Verify detached buffer phenomenon in V8
console.log(`   Old ArrayBuffer length after grow: ${oldBuffer.byteLength} bytes (detached)`);
assert.strictEqual(oldBuffer.byteLength, 0, "Previous ArrayBuffer must be detached to 0 bytes!");

// Must re-acquire fresh buffer reference
const freshMemBytes = new Uint8Array(exp.memory.buffer);
console.log(`   Fresh memory.buffer length: ${freshMemBytes.byteLength} bytes (192 KB)`);
assert.strictEqual(freshMemBytes.byteLength, 3 * 65536);
console.log("   ✅ Detached Buffer Gotcha confirmed (vital engineering invariant)");

// --- Test 7: Maximum Limits Enforcement ---
console.log("\n7. Verifying maximum memory capacity enforcement (Max Pages = 4):");
// Current = 3 pages. Request 1 additional page -> 4 pages (must succeed)
const growToMax = exp.mem_grow(1);
assert.strictEqual(growToMax, 3);
assert.strictEqual(exp.mem_size(), 4);
console.log(`   mem_grow(1) succeeded; memory at maximum capacity: ${exp.mem_size()} pages`);

// Attempt requesting 1 additional page exceeding maximum limit -> must fail and return -1
const exceedGrow = exp.mem_grow(1);
console.log(`   mem_grow(1) exceeding maximum returned: ${exceedGrow} (expected -1)`);
assert.strictEqual(exceedGrow, -1, "memory.grow beyond declared maximum must return -1");
console.log("   ✅ Capacity limit guard prevents memory exhaustion conforming to W3C spec");

// --- Test 8: Out-of-Bounds Memory Trap ---
console.log("\n8. Verifying hardware trap on out-of-bounds access (Out-of-Bounds Trap):");
const maxBoundary = 4 * 65536; // 262,144 bytes
try {
  // Attempt reading beyond allocated physical boundary
  exp.load32(maxBoundary + 16);
  assert.fail("Execution must trap prior to this line!");
} catch (err) {
  console.log(`   Trap caught successfully: ${err.name} - ${err.message}`);
  assert(err instanceof WebAssembly.RuntimeError, "Must throw WebAssembly.RuntimeError");
  assert(err.message.includes("out of bounds"), "Error message must indicate memory access out of bounds");
  console.log("   ✅ Sandbox hardware memory protection verified");
}

console.log("\n=======================================================");
console.log("🎉 All verification stages passed 100% conforming to W3C standards!");
console.log("=======================================================");
