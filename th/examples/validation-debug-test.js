/**
 * WebAssembly Validation & Debugging Comprehensive Test Suite
 * ชุดทดสอบภาคปฏิบัติ: การตรวจสอบความถูกต้อง (Validation Rules) และเครื่องมือ WABT / Debugging
 * 
 * ผู้เขียน: Wirot Chookeaw (chin6700x)
 * สัญญาอนุญาต: Apache-2.0 / MIT © 2026
 * 
 * หัวข้อที่ทดสอบ:
 * 1. การดักจับ Validation Errors ยอดนิยมใน V8 (Magic Header, Section Order, Invalid Local, Stack Underflow, Bad Alignment)
 * 2. การทำงานของเครื่องมือ WABT: wat2wasm, wasm2wat, wasm-validate, wasm-objdump
 * 3. การเปรียบเทียบการแจ้งเตือน Error ระหว่าง V8 กับ WABT wasm-validate
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper functions สำหรับสร้าง Wasm Binary
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

console.log("=== เริ่มทดสอบ WebAssembly Validation & Debugging Suite ===\n");

// =========================================================================
// ส่วนที่ 1: การทดสอบ Validation Rules ในเอนจิน V8 (V8 Rejection Oracle)
// =========================================================================

console.log("--- ส่วนที่ 1: ตรวจสอบกฎการปฏิเสธโมดูลของ V8 Engine ---");

// 1.1 Magic Header Error
console.log("1. ตรวจสอบ Magic Header Error:");
try {
  const badMagic = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 1, 0, 0, 0]);
  new WebAssembly.Module(badMagic);
  assert.fail("ต้องเกิด CompileError!");
} catch (err) {
  console.log(`   ✔ ดักจับได้: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("magic word") || err.message.includes("magic"));
}

// 1.2 Section Order Violation (Section 10 มาก่อน Section 3)
console.log("\n2. ตรวจสอบ Section Order Violation (ผิดลำดับ Section):");
try {
  const badOrder = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 0]),     // Section 1 (Type)
    ...makeSection(10, [1, 2, 0, 0x0b]),     // Section 10 (Code) วางก่อน Section 3!
    ...makeSection(3, [1, 0])                // Section 3 (Function)
  ]);
  new WebAssembly.Module(badOrder);
  assert.fail("ต้องเกิด CompileError!");
} catch (err) {
  console.log(`   ✔ ดักจับได้: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("mismatch") || err.message.includes("unexpected section") || err.message.includes("section"));
}

// 1.3 Invalid Local Index (กรณีศึกษาคลาสสิกของคอมไพเลอร์)
console.log("\n3. ตรวจสอบ Invalid Local Index (อ้างอิง Local ที่ไม่ได้ประกาศ):");
try {
  const badLocal = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 1, 0x7f]), // () -> i32
    ...makeSection(3, [1, 0]),
    ...makeSection(10, [1, 4, 0, 0x20, 25, 0x0b]) // 0 locals, local.get 25 (ไม่มี local 25!)
  ]);
  new WebAssembly.Module(badLocal);
  assert.fail("ต้องเกิด CompileError!");
} catch (err) {
  console.log(`   ✔ ดักจับได้: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("invalid local index: 25"));
}

// 1.4 Stack Underflow (เรียกคำสั่งที่ต้องการค่าบนสแตก แต่สแตกว่างเปล่า)
console.log("\n4. ตรวจสอบ Stack Underflow (i32.add บนสแตกว่าง):");
try {
  const badStack = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 0, 1, 0x7f]),
    ...makeSection(3, [1, 0]),
    ...makeSection(10, [1, 3, 0, 0x6a, 0x0b]) // i32.add ทันทีโดยไม่มีการ push ค่า
  ]);
  new WebAssembly.Module(badStack);
  assert.fail("ต้องเกิด CompileError!");
} catch (err) {
  console.log(`   ✔ ดักจับได้: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("not enough arguments on the stack"));
}

// 1.5 Memory Alignment Exponent Overflow (2^align > ขนาดธรรมชาติ)
console.log("\n5. ตรวจสอบ Alignment Exponent Overflow (i32.load align=3):");
try {
  const badAlign = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...makeSection(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...makeSection(3, [1, 0]),
    ...makeSection(5, [1, 0, 1]), // 1 memory page
    ...makeSection(10, [1, 7, 0, 0x20, 0, 0x28, 3, 0, 0x0b]) // i32.load align=3 (2^3 = 8 > 4 bytes!)
  ]);
  new WebAssembly.Module(badAlign);
  assert.fail("ต้องเกิด CompileError!");
} catch (err) {
  console.log(`   ✔ ดักจับได้: ${err.message}`);
  assert(err instanceof WebAssembly.CompileError);
  assert(err.message.includes("invalid alignment"));
}

console.log("\n✅ กฎการตรวจสอบของ V8 Engine ผ่านครบทั้ง 5 กรณีทดสอบ\n");

// =========================================================================
// ส่วนที่ 2: การทดสอบเครื่องมือ WebAssembly Binary Toolkit (WABT)
// =========================================================================

console.log("--- ส่วนที่ 2: ตรวจสอบเครื่องมือ WABT (wat2wasm, wasm-validate, wasm2wat, wasm-objdump) ---");

const tmpWat = path.join(__dirname, 'temp_debug.wat');
const tmpWasm = path.join(__dirname, 'temp_debug.wasm');

// 2.1 สร้างโค้ด WebAssembly Text Format (.wat)
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
console.log("1. สร้างไฟล์ temp_debug.wat เรียบร้อย");

// 2.2 wat2wasm: คอมไพล์ .wat -> .wasm
execSync(`wat2wasm "${tmpWat}" -o "${tmpWasm}"`);
console.log(`2. wat2wasm สำเร็จ: สร้าง ${path.basename(tmpWasm)} ขนาด ${fs.statSync(tmpWasm).size} ไบต์`);

// 2.3 wasm-validate: ตรวจสอบความถูกต้องตามสเปก W3C 100%
const validateOutput = execSync(`wasm-validate "${tmpWasm}"`).toString();
console.log("3. wasm-validate: ผลลัพธ์ผ่าน 100% ถูกต้องตามข้อกำหนด W3C");

// 2.4 wasm2wat: ถอดรหัส Binary กลับมาเป็น Text Format (Roundtrip Test)
const disasmText = execSync(`wasm2wat "${tmpWasm}"`).toString();
console.log("4. wasm2wat Round-trip Disassembly:");
console.log("-------------------------------------------------------");
console.log(disasmText.trim());
console.log("-------------------------------------------------------");
assert(disasmText.includes("i32.mul"));
assert(disasmText.includes("i32.add"));

// 2.5 wasm-objdump: ส่องดู Section Headers และ Instructions
const objdumpHeaders = execSync(`wasm-objdump -h "${tmpWasm}"`).toString();
console.log("5. wasm-objdump Section Headers:");
console.log(objdumpHeaders.trim());

// 2.6 wasm-validate ทดสอบดักจับ Malformed Binary
console.log("\n6. ทดสอบ wasm-validate บนไฟล์ที่มีข้อผิดพลาด:");
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
  assert.fail("wasm-validate ต้องล้มเหลว!");
} catch (err) {
  const wabtError = err.stderr ? err.stderr.toString() : err.message;
  console.log(`   ✔ wasm-validate ปฏิเสธโมดูลสำเร็จ:\n   ${wabtError.trim()}`);
  assert(wabtError.includes("invalid local-index") || wabtError.includes("local"));
}

// ทำความสะอาดไฟล์ชั่วคราว
fs.unlinkSync(tmpWat);
fs.unlinkSync(tmpWasm);
fs.unlinkSync(malformedWasm);

console.log("\n=======================================================");
console.log("🎉 ผลการทดสอบผ่านทุกขั้นตอน 100% สมบูรณ์แบบตามมาตรฐาน W3C!");
console.log("=======================================================");
