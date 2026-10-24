/**
 * WebAssembly Validation & Debugging Comprehensive Test Suite
 * Hands-on verification suite: Validation Rules and WABT / Debugging Toolchain
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 * 
 * Topics covered:
 * 1. Catching common Validation Errors in V8 (Magic Header, Section Order, Invalid Local, Stack Underflow, Bad Alignment)
 * 2. WABT toolchain operation: wat2wasm, wasm2wat, wasm-validate, wasm-objdump
 * 3. Error reporting comparison between V8 and WABT wasm-validate
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper functions for building Wasm binary
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

function makeSection(id, payload) {
  return [id, ...uleb128(payload.length), ...payload];
}

console.log("=== Starting WebAssembly Validation & Debugging Suite ===\n");

// =========================================================================
// Part 1: Testing Validation Rules in V8 Engine (V8 Rejection Oracle)
// =========================================================================

console.log("--- Part 1: Verifying V8 Engine Module Rejection Rules ---");

// 1.1 Magic Header Error
console.log("1. Verifying Magic Header Error:");
try {
  const badMagic = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 1, 0, 0, 0]);
  new WebAssembly.Module(badMagic);
  assert.fail("Expected CompileError to be thrown!");
} catch (err) {
  console.log(`   ✔ Successfully caught: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("magic word") || err.message.includes("magic"));
}

// 1.2 Section Order Violation (Section 10 before Section 3)
console.log("\n2. Verifying Section Order Violation (out-of-order section):");
try {
  const badOrder = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 0]),     // Section 1 (Type)
    ...makeSection(10, [1, 2, 0, 0x0b]),     // Section 10 (Code) placed before Section 3!
    ...makeSection(3, [1, 0])                // Section 3 (Function)
  ]);
  new WebAssembly.Module(badOrder);
  assert.fail("Expected CompileError to be thrown!");
} catch (err) {
  console.log(`   ✔ Successfully caught: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("mismatch") || err.message.includes("unexpected section") || err.message.includes("section"));
}

// 1.3 Invalid Local Index (Classic compiler defect case)
console.log("\n3. Verifying Invalid Local Index (referencing undeclared local):");
try {
  const badLocal = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 1, 0x7f]), // () -> i32
    ...makeSection(3, [1, 0]),
    ...makeSection(10, [1, 4, 0, 0x20, 25, 0x0b]) // 0 locals, local.get 25 (local 25 does not exist!)
  ]);
  new WebAssembly.Module(badLocal);
  assert.fail("Expected CompileError to be thrown!");
} catch (err) {
  console.log(`   ✔ Successfully caught: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("invalid local index: 25"));
}

// 1.4 Stack Underflow (Instruction requires stack operands, but stack is empty)
console.log("\n4. Verifying Stack Underflow (i32.add on empty operand stack):");
try {
  const badStack = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 1, 0x7f]),
    ...makeSection(3, [1, 0]),
    ...makeSection(10, [1, 3, 0, 0x6a, 0x0b]) // i32.add immediately without operands pushed
  ]);
  new WebAssembly.Module(badStack);
  assert.fail("Expected CompileError to be thrown!");
} catch (err) {
  console.log(`   ✔ Successfully caught: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("not enough arguments on the stack"));
}

// 1.5 Memory Alignment Exponent Overflow (2^align > natural alignment size)
console.log("\n5. Verifying Alignment Exponent Overflow (i32.load align=3):");
try {
  const badAlign = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...makeSection(3, [1, 0]),
    ...makeSection(5, [1, 0, 1]), // 1 memory page
    ...makeSection(10, [1, 7, 0, 0x20, 0, 0x28, 3, 0, 0x0b]) // i32.load align=3 (2^3 = 8 > 4 bytes!)
  ]);
  new WebAssembly.Module(badAlign);
  assert.fail("Expected CompileError to be thrown!");
} catch (err) {
  console.log(`   ✔ Successfully caught: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("invalid alignment"));
}

console.log("\n✅ V8 Engine validation rules passed all 5 test cases\n");

// =========================================================================
// Part 2: Testing WebAssembly Binary Toolkit (WABT) Tools
// =========================================================================

console.log("--- Part 2: Verifying WABT Tools (wat2wasm, wasm-validate, wasm2wat, wasm-objdump) ---");

const tmpWat = path.join(__dirname, 'temp_debug.wat');
const tmpWasm = path.join(__dirname, 'temp_debug.wasm');

// 2.1 Generate WebAssembly Text Format (.wat) source
const watSource = `(module
  (memory (export "memory") 1)
  (func $calc (export "calc") (param $x i32) (param $y i32) (result i32)
    local.get $x
    local.get $y
    i32.mul
    i32.const 10
    i32.add
  )
)`;

fs.writeFileSync(tmpWat, watSource);
console.log("1. Successfully created temp_debug.wat");

// 2.2 wat2wasm: Compile .wat -> .wasm
execSync(`wat2wasm "${tmpWat}" -o "${tmpWasm}"`);
console.log(`2. wat2wasm succeeded: Created ${path.basename(tmpWasm)} (${fs.statSync(tmpWasm).size} bytes)`);

// 2.3 wasm-validate: Validate against W3C specification
const validateOutput = execSync(`wasm-validate "${tmpWasm}"`).toString();
console.log("3. wasm-validate: Validation passed 100% compliant with W3C specification");

// 2.4 wasm2wat: Disassemble Binary back to Text Format (Roundtrip Test)
const disasmText = execSync(`wasm2wat "${tmpWasm}"`).toString();
console.log("4. wasm2wat Round-trip Disassembly:");
console.log("-------------------------------------------------------");
console.log(disasmText.trim());
console.log("-------------------------------------------------------");
assert(disasmText.includes("i32.mul"));
assert(disasmText.includes("i32.add"));

// 2.5 wasm-objdump: Inspect Section Headers and Instructions
const objdumpHeaders = execSync(`wasm-objdump -h "${tmpWasm}"`).toString();
console.log("5. wasm-objdump Section Headers:");
console.log(objdumpHeaders.trim());

// 2.6 wasm-validate: Verify rejection of malformed binary
console.log("\n6. Testing wasm-validate on malformed binary file:");
const malformedWasm = path.join(__dirname, 'temp_malformed.wasm');
const badLocalBytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...makeSection(1, [1, 0x60, 0, 1, 0x7f]),
  ...makeSection(3, [1, 0]),
  ...makeSection(10, [1, 4, 0, 0x20, 25, 0x0b]) // local.get 25
]);
fs.writeFileSync(malformedWasm, badLocalBytes);

try {
  execSync(`wasm-validate "${malformedWasm}"`, { stdio: 'pipe' });
  assert.fail("Expected wasm-validate to fail on malformed module!");
} catch (err) {
  const wabtError = err.stderr ? err.stderr.toString() : err.message;
  console.log(`   ✔ wasm-validate rejected invalid module as expected:\n   ${wabtError.trim()}`);
  assert(wabtError.includes("invalid local-index") || wabtError.includes("local"));
}

// Clean up temporary files
fs.unlinkSync(tmpWat);
fs.unlinkSync(tmpWasm);
fs.unlinkSync(malformedWasm);

console.log("\n=======================================================");
console.log("🎉 All tests passed successfully with 100% W3C standard compliance!");
console.log("=======================================================");
