/**
 * WebAssembly Tables & Indirect Call (call_indirect) Comprehensive Test Suite
 * Practical guide & verification harness: WebAssembly Table architecture and indirect call dispatch
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 * 
 * Verification Topics:
 * 1. Table Section (0x04) and Element Section (0x09) binary layout
 * 2. Dynamic indirect call dispatch via call_indirect (0x11)
 * 3. JavaScript WebAssembly.Table API introspection & manipulation (table.get, table.set, table.grow)
 * 4. Runtime type safety enforcement (Signature Mismatch Trap)
 * 5. Out-of-bounds table access trapping (Table Index Out of Bounds Trap)
 * 6. Emulating C++ Virtual Method Table (VTABLE Polymorphism) over Linear Memory
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
// Module 1: Math Dispatcher, Type Safety & Dynamic Function Table
// =========================================================================

// Section 1: Type Section
// Type 0: (i32, i32) -> (i32)          [add, sub, mul, div]
// Type 1: (i32) -> (i32)               [square]
// Type 2: (i32, i32, i32) -> (i32)     [dispatch_binop: a, b, table_idx]
// Type 3: (i32, i32) -> (i32)          [dispatch_single: x, table_idx]
const typeSection1 = makeSection(1, [
  4,
  0x60, 2, 0x7f, 0x7f, 1, 0x7f, // Type 0: (i32, i32) -> i32
  0x60, 1, 0x7f, 1, 0x7f,       // Type 1: (i32) -> i32
  0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f, // Type 2: (i32, i32, i32) -> i32
  0x60, 2, 0x7f, 0x7f, 1, 0x7f  // Type 3: (i32, i32) -> i32
]);

// Section 3: Function Section
// Func 0: add (type 0)
// Func 1: sub (type 0)
// Func 2: mul (type 0)
// Func 3: square (type 1)  <-- Distinct signature: (i32) -> i32
// Func 4: dispatch_binop (type 2)
// Func 5: dispatch_single (type 3)
const funcSection1 = makeSection(3, [
  6,
  0, 0, 0, 1, 2, 3
]);

// Section 4: Table Section
// Table 0: element type funcref (0x70), flags 0x01 (min and max limits), min = 4, max = 8
const tableSection1 = makeSection(4, [
  1,
  0x70, // element type: funcref
  0x01, // flags: has max limit
  4,    // min = 4 elements
  8     // max = 8 elements
]);

// Section 7: Export Section
const exportSection1 = makeSection(7, [
  5,
  ...makeExport("table", 0x01, 0),          // export table 0
  ...makeExport("add", 0x00, 0),
  ...makeExport("square", 0x00, 3),
  ...makeExport("dispatch_binop", 0x00, 4),
  ...makeExport("dispatch_single", 0x00, 5)
]);

// Section 9: Element Section (Active Element Segment initializing Table 0)
// Mode 0x00 = Active segment targeting table 0
// Offset Expression = i32.const 0, end
// Populated function indices: [0 (add), 1 (sub), 2 (mul), 3 (square)]
const elemSection1 = makeSection(9, [
  1,
  0x00,             // Active segment, table 0
  0x41, 0x00, 0x0b, // offset expr: i32.const 0, end
  4, 0, 1, 2, 3     // 4 function indices
]);

// Section 10: Code Section
// Func 0: add
const f0_add = makeFunctionBody([], [
  0x20, 0, 0x20, 1, 0x6a, 0x0b // local.get 0, local.get 1, i32.add, end
]);

// Func 1: sub
const f1_sub = makeFunctionBody([], [
  0x20, 0, 0x20, 1, 0x6b, 0x0b // local.get 0, local.get 1, i32.sub, end
]);

// Func 2: mul
const f2_mul = makeFunctionBody([], [
  0x20, 0, 0x20, 1, 0x6c, 0x0b // local.get 0, local.get 1, i32.mul, end
]);

// Func 3: square
const f3_square = makeFunctionBody([], [
  0x20, 0, 0x20, 0, 0x6c, 0x0b // local.get 0, local.get 0, i32.mul, end
]);

// Func 4: dispatch_binop(a, b, fn_idx) -> Expects Type 0
// call_indirect: 0x11, typeidx 0, tableidx 0
const f4_dispatch_binop = makeFunctionBody([], [
  0x20, 0,       // local.get 0 (arg a)
  0x20, 1,       // local.get 1 (arg b)
  0x20, 2,       // local.get 2 (fn_idx)
  0x11, 0, 0,    // call_indirect type=0, table=0
  0x0b
]);

// Func 5: dispatch_single(x, fn_idx) -> Expects Type 1
// call_indirect: 0x11, typeidx 1, tableidx 0
const f5_dispatch_single = makeFunctionBody([], [
  0x20, 0,       // local.get 0 (arg x)
  0x20, 1,       // local.get 1 (fn_idx)
  0x11, 1, 0,    // call_indirect type=1, table=0
  0x0b
]);

const codeSection1 = makeSection(10, [
  6,
  ...f0_add,
  ...f1_sub,
  ...f2_mul,
  ...f3_square,
  ...f4_dispatch_binop,
  ...f5_dispatch_single
]);

const mod1Bytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...typeSection1,
  ...funcSection1,
  ...tableSection1,
  ...exportSection1,
  ...elemSection1,
  ...codeSection1
]);

// =========================================================================
// Module 2: Emulating C++ Virtual Method Table (VTABLE) in Linear Memory
// =========================================================================

// Type 0: (i32) -> (i32) [shape_area, rect_area, tri_area]
const typeSection2 = makeSection(1, [
  1,
  0x60, 1, 0x7f, 1, 0x7f
]);

const funcSection2 = makeSection(3, [3, 0, 0, 0]);

const tableSection2 = makeSection(4, [
  1,
  0x70, 0x01, 2, 2 // 2 elements (0: rect, 1: tri)
]);

const memSection2 = makeSection(5, [
  1,
  0x00, 1 // 1 page (64KB)
]);

const exportSection2 = makeSection(7, [
  2,
  ...makeExport("memory", 0x02, 0),
  ...makeExport("shape_area", 0x00, 2)
]);

const elemSection2 = makeSection(9, [
  1,
  0x00,
  0x41, 0, 0x0b,
  2, 0, 1 // Table[0] = func 0 (rect), Table[1] = func 1 (tri)
]);

// Func 0: rect_area(ptr) -> ptr[4] * ptr[8]
const f0_rect = makeFunctionBody([], [
  0x20, 0, 0x28, 2, 4, // load width at offset 4
  0x20, 0, 0x28, 2, 8, // load height at offset 8
  0x6c,                // i32.mul
  0x0b
]);

// Func 1: tri_area(ptr) -> (ptr[4] * ptr[8]) / 2
const f1_tri = makeFunctionBody([], [
  0x20, 0, 0x28, 2, 4,
  0x20, 0, 0x28, 2, 8,
  0x6c,
  0x41, 2,
  0x6d,                // i32.div_s
  0x0b
]);

// Func 2: shape_area(ptr) -> Dynamic Polymorphic Dispatcher
// 1. Read vtable_index from memory offset 0
// 2. Pass object instance pointer (this) as the first argument
// 3. Dispatch via call_indirect type 0, table 0
const f2_shape_area = makeFunctionBody([], [
  0x20, 0,             // push this pointer (arg 0)
  0x20, 0, 0x28, 2, 0, // load vtable index from offset 0
  0x11, 0, 0,          // call_indirect type=0, table=0
  0x0b
]);

const codeSection2 = makeSection(10, [
  3,
  ...f0_rect,
  ...f1_tri,
  ...f2_shape_area
]);

const mod2Bytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...typeSection2,
  ...funcSection2,
  ...tableSection2,
  ...memSection2,
  ...exportSection2,
  ...elemSection2,
  ...codeSection2
]);

// =========================================================================
// Verification Test Execution
// =========================================================================

console.log("=== Launching WebAssembly Tables & Indirect Call Suite ===");

const instance1 = new WebAssembly.Instance(new WebAssembly.Module(mod1Bytes));
const exp1 = instance1.exports;

// --- Test 1: Indirect Call Dispatch through Table Index ---
console.log("1. Verifying Indirect Call Dispatch (Type 0):");
const resAdd = exp1.dispatch_binop(20, 10, 0); // call func 0 (add)
const resSub = exp1.dispatch_binop(20, 10, 1); // call func 1 (sub)
const resMul = exp1.dispatch_binop(20, 10, 2); // call func 2 (mul)

console.log(`   dispatch_binop(20, 10, 0) [add] = ${resAdd}`);
console.log(`   dispatch_binop(20, 10, 1) [sub] = ${resSub}`);
console.log(`   dispatch_binop(20, 10, 2) [mul] = ${resMul}`);
assert.strictEqual(resAdd, 30);
assert.strictEqual(resSub, 10);
assert.strictEqual(resMul, 200);
console.log("   ✅ Dynamic dispatch via Table Index verified 100%");

// --- Test 2: Indirect Call with Type 1 Signature ---
console.log("\n2. Verifying Single-Parameter Indirect Call (Type 1):");
const resSq = exp1.dispatch_single(9, 3); // call func 3 (square)
console.log(`   dispatch_single(9, 3) [square] = ${resSq}`);
assert.strictEqual(resSq, 81);
console.log("   ✅ Type 1 Indirect Call verified");

// --- Test 3: Detecting Signature Mismatch (Type Safety Trap) ---
console.log("\n3. Verifying Type Safety: Signature Mismatch Trap:");
try {
  // Attempt invoking slot 3 (square: (i32)->i32) through dispatch_binop which expects (i32, i32)->i32
  exp1.dispatch_binop(10, 20, 3);
  assert.fail("Execution must trap prior to this line!");
} catch (err) {
  console.log(`   Trap caught successfully: ${err.name} - ${err.message}`);
  assert(err instanceof WebAssembly.RuntimeError);
  assert(err.message.includes("signature mismatch"));
  console.log("   ✅ WebAssembly prevents type confusion via hardware/runtime guards");
}

// --- Test 4: Detecting Out-of-Bounds Table Access ---
console.log("\n4. Verifying Table Bounds Trap (Accessing unallocated slot index):");
try {
  exp1.dispatch_binop(10, 20, 99);
  assert.fail("Execution must trap prior to this line!");
} catch (err) {
  console.log(`   Trap caught successfully: ${err.name} - ${err.message}`);
  assert(err instanceof WebAssembly.RuntimeError);
  assert(err.message.includes("out of bounds"));
  console.log("   ✅ WebAssembly traps out-of-bounds table index access safely");
}

// --- Test 5: JavaScript WebAssembly.Table API & Dynamic Swapping ---
console.log("\n5. Verifying JavaScript Table API & runtime function hot-swapping:");
const table = exp1.table;
console.log(`   Initial Table length: ${table.length} slots`);
assert.strictEqual(table.length, 4);

// Extract function reference and invoke directly from JavaScript
const fnFromTable = table.get(0);
console.log(`   Direct invocation table.get(0)(15, 25) from JS = ${fnFromTable(15, 25)}`);
assert.strictEqual(fnFromTable(15, 25), 40);

// Swap Table[1] from sub to add via table.set()
console.log("   Hot-swapping Table[1] pointer (from sub -> add)...");
table.set(1, table.get(0));
const resAfterSwap = exp1.dispatch_binop(20, 10, 1);
console.log(`   dispatch_binop(20, 10, 1) result after swap = ${resAfterSwap} (swapped to 30)`);
assert.strictEqual(resAfterSwap, 30);
console.log("   ✅ Dynamic function pointer hot-swapping verified");

// Expand table capacity with table.grow()
const oldTableLen = table.grow(2);
console.log(`   table.grow(2) returned previous length: ${oldTableLen}, new length: ${table.length}`);
assert.strictEqual(oldTableLen, 4);
assert.strictEqual(table.length, 6);
console.log("   ✅ WebAssembly.Table dynamic growth verified");

// --- Test 6: Emulating C++ VTABLE and Polymorphism on Linear Memory ---
console.log("\n6. Emulating C++ VTABLE (Polymorphism) architecture over Wasm Linear Memory:");
const instance2 = new WebAssembly.Instance(new WebAssembly.Module(mod2Bytes));
const mem32 = new Int32Array(instance2.exports.memory.buffer);

// Simulate creating Shape 1: Rectangle (w=25, h=10) at Memory Offset 100
// Memory Struct Layout:
//   Offset +0: vtable_index (0 = rect_area)
//   Offset +4: width (25)
//   Offset +8: height (10)
const rectPtr = 100;
const rectIdx = rectPtr / 4;
mem32[rectIdx + 0] = 0;  // VTABLE[0] = rect_area
mem32[rectIdx + 1] = 25; // width = 25
mem32[rectIdx + 2] = 10; // height = 10

// Simulate creating Shape 2: Triangle (w=30, h=8) at Memory Offset 200
//   Offset +0: vtable_index (1 = tri_area)
//   Offset +4: width (30)
//   Offset +8: height (8)
const triPtr = 200;
const triIdx = triPtr / 4;
mem32[triIdx + 0] = 1;  // VTABLE[1] = tri_area
mem32[triIdx + 1] = 30; // width = 30
mem32[triIdx + 2] = 8;  // height = 8

// Execute dynamic virtual method dispatch via shape_area()
const areaRect = instance2.exports.shape_area(rectPtr);
const areaTri = instance2.exports.shape_area(triPtr);

console.log(`   Calculated Rectangle area (25x10) via VTABLE: ${areaRect} (expected 250)`);
console.log(`   Calculated Triangle area (30x8/2) via VTABLE: ${areaTri} (expected 120)`);

assert.strictEqual(areaRect, 250);
assert.strictEqual(areaTri, 120);
console.log("   ✅ C++ VTABLE Polymorphism simulation verified with 100% precision");

console.log("\n=======================================================");
console.log("🎉 All verification stages passed 100% conforming to W3C standards!");
console.log("=======================================================");
