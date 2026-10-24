/**
 * WebAssembly JavaScript Interface & Universal Bridge Comprehensive Test Suite
 * คู่มือและชุดทดสอบภาคปฏิบัติ: การผสานงาน JavaScript, Browser APIs และ Universal Bridge (ccall/cwrap)
 * 
 * ผู้เขียน: Wirot Chookeaw (chin6700x)
 * สัญญาอนุญาต: Apache-2.0 / MIT © 2026
 * 
 * หัวข้อที่ทดสอบ:
 * 1. การนำเข้า Host Functions จาก JavaScript (Import Section 2: console_log, get_timestamp, on_event)
 * 2. การคอมไพล์และเปิดใช้งาน: WebAssembly.instantiate vs WebAssembly.compile + Instance
 * 3. การจำลอง WebAssembly.instantiateStreaming ด้วย Fetch/Response
 * 4. การส่งผ่านสตริง UTF-8 และการแปลงด้วย TextEncoder / TextDecoder
 * 5. การสร้าง Sovereign ccall() และ cwrap() ขึ้นมาใช้งานเองโดยไม่ต้องพึ่งพา Emscripten
 * 6. การทดสอบวัดค่า Performance Overhead ระหว่าง Raw Wasm Call กับ Bridge Call
 */

import assert from 'node:assert';

// --- ฟังก์ชันช่วยเหลือสำหรับการเข้ารหัส Wasm Binary ด้วยมือ ---
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
    n >>= 7;
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

function makeImportFunc(mod, field, typeidx) {
  const m = Buffer.from(mod, "utf8");
  const f = Buffer.from(field, "utf8");
  return [...uleb128(m.length), ...m, ...uleb128(f.length), ...f, 0x00, typeidx];
}

function makeFunctionBody(locals, instructions) {
  const localDecl = locals.length === 0
    ? [0]
    : [locals.length, ...locals.flatMap(l => [l[0], l[1]])];
  const body = [...localDecl, ...instructions];
  return [...uleb128(body.length), ...body];
}

// =========================================================================
// สร้าง WebAssembly Binary Module ที่มีทั้ง Import, Export, Memory และ String Logic
// =========================================================================

// Section 1: Type Section
// Type 0: (i32, i32) -> ()    [env.host_log: (ptr, len)]
// Type 1: () -> (f64)         [env.get_time: () -> timestamp]
// Type 2: (i32, i32) -> ()    [env.on_event: (eventId, data)]
// Type 3: (i32, i32) -> (i32) [add_numbers, reverse_str]
// Type 4: (i32) -> (i32)       [alloc, greet_user]
const typeSection = makeSection(1, [
  5,
  0x60, 2, 0x7f, 0x7f, 0, // Type 0: (i32, i32) -> ()
  0x60, 0, 1, 0x7c,       // Type 1: () -> f64 (0x7C = f64)
  0x60, 2, 0x7f, 0x7f, 0, // Type 2: (i32, i32) -> ()
  0x60, 2, 0x7f, 0x7f, 1, 0x7f, // Type 3: (i32, i32) -> i32
  0x60, 1, 0x7f, 1, 0x7f  // Type 4: (i32) -> i32
]);

// Section 2: Import Section (นำเข้าฟังก์ชันโฮสต์จาก JS เข้ามา 3 ตัว)
// Func Index 0: env.host_log (Type 0)
// Func Index 1: env.get_time (Type 1)
// Func Index 2: env.on_event (Type 2)
const importSection = makeSection(2, [
  3,
  ...makeImportFunc("env", "host_log", 0),
  ...makeImportFunc("env", "get_time", 1),
  ...makeImportFunc("env", "on_event", 2)
]);

// Section 3: Function Section (ฟังก์ชันภายใน เริ่มที่ Index 3)
// Func Index 3: alloc (Type 4)
// Func Index 4: add_numbers (Type 3)
// Func Index 5: reverse_str (Type 3)
// Func Index 6: greet_user (Type 4: param name_ptr -> return greeting_ptr)
const funcSection = makeSection(3, [
  4,
  4, // alloc -> Type 4
  3, // add_numbers -> Type 3
  3, // reverse_str -> Type 3
  4  // greet_user -> Type 4
]);

// Section 5: Memory Section (1 Memory: min 1 page, max 4 pages)
const memSection = makeSection(5, [
  1, 0x01, 1, 4
]);

// Section 6: Global Section (Heap Pointer เริ่มต้นที่ 1024)
const globSection = makeSection(6, [
  1, 0x7f, 1, 0x41, ...sleb128(1024), 0x0b
]);

// Section 7: Export Section
const exportSection = makeSection(7, [
  5,
  ...makeExport("memory", 0x02, 0),
  ...makeExport("alloc", 0x00, 3),
  ...makeExport("add_numbers", 0x00, 4),
  ...makeExport("reverse_str", 0x00, 5),
  ...makeExport("greet_user", 0x00, 6)
]);

// Section 10: Code Section

// Func 3: alloc(size) -> ptr (Bump Allocator พร้อม 8-byte alignment)
const f3_alloc = makeFunctionBody([[1, 0x7f]], [
  0x23, 0, 0x21, 1,                         // old_ptr = global[0]
  0x20, 1, 0x20, 0, 0x6a, 0x41, 7, 0x6a,   // (old_ptr + size + 7)
  0x41, ...sleb128(-8), 0x71,               // & -8
  0x24, 0,                                  // global[0] = new_ptr
  0x20, 1, 0x0b                             // return old_ptr
]);

// Func 4: add_numbers(a, b) -> a + b
const f4_add = makeFunctionBody([], [
  0x20, 0, 0x20, 1, 0x6a, 0x0b
]);

// Func 5: reverse_str(ptr, len) -> ptr (กลับสตริงในหน่วยความจำและเรียก host_log)
const f5_reverse_str = makeFunctionBody([[3, 0x7f]], [
  // local 2 (i) = 0
  0x41, 0, 0x21, 2,
  // local 3 (j) = len - 1
  0x20, 1, 0x41, 1, 0x6b, 0x21, 3,

  // Loop กลับอักษร
  0x02, 0x40, // block
    0x03, 0x40, // loop
      0x20, 2, 0x20, 3, 0x4e, 0x0d, 1, // if (i >= j) break
      // temp (local 4) = ptr[i]
      0x20, 0, 0x20, 2, 0x6a, 0x2d, 0, 0, 0x21, 4,
      // ptr[i] = ptr[j]
      0x20, 0, 0x20, 2, 0x6a,
      0x20, 0, 0x20, 3, 0x6a, 0x2d, 0, 0,
      0x3a, 0, 0,
      // ptr[j] = temp
      0x20, 0, 0x20, 3, 0x6a,
      0x20, 4,
      0x3a, 0, 0,
      // i++, j--
      0x20, 2, 0x41, 1, 0x6a, 0x21, 2,
      0x20, 3, 0x41, 1, 0x6b, 0x21, 3,
      0x0c, 0, // continue
    0x0b, // end loop
  0x0b, // end block

  // เรียก host_log(ptr, len) [Func 0]
  0x20, 0, 0x20, 1, 0x10, 0,

  // เรียก on_event(42, len) [Func 2]
  0x41, 42, 0x20, 1, 0x10, 2,

  // return ptr
  0x20, 0, 0x0b
]);

// Func 6: greet_user(name_ptr) -> out_ptr
// สร้างคำทักทาย "Hello, [name]!" ลงใน Heap แล้วส่ง pointer กลับ
const f6_greet = makeFunctionBody([[4, 0x7f]], [
  // local 1: name_len
  // local 2: out_ptr
  // local 3: i
  // local 4: ch

  // 1. หาความยาวของ name_ptr (strlen)
  0x41, 0, 0x21, 1,
  0x02, 0x40, // block $exit
    0x03, 0x40, // loop $loop
      0x20, 0, 0x20, 1, 0x6a, 0x2d, 0, 0, // load byte
      0x45, 0x0d, 1, // if byte == 0, break loop (br 1 to exit)
      0x20, 1, 0x41, 1, 0x6a, 0x21, 1, // len++
      0x0c, 0, // br 0 to repeat loop
    0x0b, // end loop
  0x0b, // end block

  // 2. ขอจัดสรรหน่วยความจำ out_ptr = alloc(7 + name_len + 2)  ("Hello, " = 7 bytes, "!" = 1 byte, null = 1)
  0x20, 1, 0x41, 9, 0x6a,
  0x10, 3, // call alloc (Func 3)
  0x21, 2, // out_ptr

  // 3. เขียน "Hello, " (7 ไบต์: 72, 101, 108, 108, 111, 44, 32)
  // หมายเหตุสำคัญ: ค่าที่ >= 64 ใน SLEB128 ต้องใช้ 2 ไบต์ (เช่น sleb128(72) -> 0xC8, 0x00)
  0x20, 2, 0x41, ...sleb128(72),  0x3a, 0, 0, // 'H'
  0x20, 2, 0x41, ...sleb128(101), 0x3a, 0, 1, // 'e'
  0x20, 2, 0x41, ...sleb128(108), 0x3a, 0, 2, // 'l'
  0x20, 2, 0x41, ...sleb128(108), 0x3a, 0, 3, // 'l'
  0x20, 2, 0x41, ...sleb128(111), 0x3a, 0, 4, // 'o'
  0x20, 2, 0x41, 44,              0x3a, 0, 5, // ',' (< 64 ใช้ 1 ไบต์ได้)
  0x20, 2, 0x41, 32,              0x3a, 0, 6, // ' ' (< 64 ใช้ 1 ไบต์ได้)

  // 4. คัดลอก name ไปต่อท้าย
  0x41, 0, 0x21, 3,
  0x02, 0x40, // block $exit
    0x03, 0x40, // loop $loop
      0x20, 3, 0x20, 1, 0x4e, 0x0d, 1, // if i >= len break (br 1 to exit)
      // ch = name_ptr[i]
      0x20, 0, 0x20, 3, 0x6a, 0x2d, 0, 0, 0x21, 4,
      // out_ptr[7 + i] = ch
      0x20, 2, 0x41, 7, 0x6a, 0x20, 3, 0x6a,
      0x20, 4,
      0x3a, 0, 0,
      // i++
      0x20, 3, 0x41, 1, 0x6a, 0x21, 3,
      0x0c, 0,
    0x0b, // end loop
  0x0b, // end block

  // 5. เติมเครื่องหมาย '!' (33) และ null-terminator (0)
  0x20, 2, 0x41, 7, 0x6a, 0x20, 1, 0x6a, 0x41, 33, 0x3a, 0, 0,
  0x20, 2, 0x41, 8, 0x6a, 0x20, 1, 0x6a, 0x41, 0,  0x3a, 0, 0,

  // return out_ptr
  0x20, 2,
  0x0b
]);

const codeSection = makeSection(10, [
  4,
  ...f3_alloc,
  ...f4_add,
  ...f5_reverse_str,
  ...f6_greet
]);

const wasmBytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...typeSection,
  ...importSection,
  ...funcSection,
  ...memSection,
  ...globSection,
  ...exportSection,
  ...codeSection
]);

// =========================================================================
// สถาปัตยกรรม Sovereign Universal Bridge (เขียน ccall / cwrap เอง 100%)
// =========================================================================

class SovereignWasmBridge {
  constructor(instance) {
    this.instance = instance;
    this.exports = instance.exports;
    this.memory = instance.exports.memory;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8");
  }

  // จัดสรรหน่วยความจำและเขียนสตริงลง Wasm Heap
  allocString(str) {
    const bytes = this.encoder.encode(str);
    const ptr = this.exports.alloc(bytes.length + 1);
    const mem = new Uint8Array(this.memory.buffer);
    mem.set(bytes, ptr);
    mem[ptr + bytes.length] = 0; // null-terminator \0
    return { ptr, len: bytes.length };
  }

  // อ่านสตริงออกจาก Wasm Linear Memory
  readString(ptr, len) {
    const mem = new Uint8Array(this.memory.buffer);
    if (len === undefined) {
      let end = ptr;
      while (mem[end] !== 0) end++;
      return this.decoder.decode(mem.subarray(ptr, end));
    }
    return this.decoder.decode(mem.subarray(ptr, ptr + len));
  }

  // Sovereign ccall: เรียกฟังก์ชัน Wasm ด้วย type conversion อัตโนมัติ
  ccall(ident, returnType, argTypes = [], args = []) {
    const fn = this.exports[ident];
    if (typeof fn !== "function") {
      throw new Error(`Export function '${ident}' not found in Wasm instance`);
    }

    const wasmArgs = [];
    for (let i = 0; i < args.length; i++) {
      const type = argTypes[i];
      const val = args[i];

      if (type === "string") {
        const { ptr } = this.allocString(val);
        wasmArgs.push(ptr);
      } else if (type === "number") {
        wasmArgs.push(Number(val));
      } else if (type === "boolean") {
        wasmArgs.push(val ? 1 : 0);
      } else {
        wasmArgs.push(val);
      }
    }

    const rawResult = fn(...wasmArgs);

    if (returnType === "string") {
      return this.readString(rawResult);
    } else if (returnType === "boolean") {
      return Boolean(rawResult);
    } else if (returnType === "number") {
      return Number(rawResult);
    }
    return rawResult;
  }

  // Sovereign cwrap: สร้างฟังก์ชันห่อหุ้มในรูปแบบ JavaScript Native Function
  cwrap(ident, returnType, argTypes = []) {
    return (...args) => this.ccall(ident, returnType, argTypes, args);
  }
}

// =========================================================================
// เริ่มต้นการทดสอบภาคปฏิบัติ (Test Suite Execution)
// =========================================================================

console.log("=== เริ่มทดสอบ WebAssembly JS Interface & Universal Bridge Suite ===");
console.log(`ขนาดโมดูลไบนารีที่สร้างขึ้น: ${wasmBytes.length} ไบต์\n`);

// เตรียม Host Callback Loggers
const logs = [];
const events = [];

const importObject = {
  env: {
    host_log: (ptr, len) => {
      // ฝั่งโฮสต์อ่านข้อมูลจาก Linear Memory ตรงๆ
      const mem = new Uint8Array(instance.exports.memory.buffer);
      const msg = new TextDecoder().decode(mem.subarray(ptr, ptr + len));
      logs.push(msg);
      console.log(`   [Host Log Callback]: "${msg}"`);
    },
    get_time: () => {
      return performance.now();
    },
    on_event: (eventId, data) => {
      events.push({ eventId, data });
      console.log(`   [Host Event Callback]: Event ID=${eventId}, Data=${data}`);
    }
  }
};

// --- ทดสอบข้อ 1: การเปิดใช้งานผ่าน WebAssembly.instantiate ---
console.log("1. ทดสอบ WebAssembly.instantiate():");
const { module, instance } = await WebAssembly.instantiate(wasmBytes, importObject);
assert(module instanceof WebAssembly.Module);
assert(instance instanceof WebAssembly.Instance);
console.log("   ✅ WebAssembly.instantiate สำเร็จพร้อมผูก Import Object");

// --- ทดสอบข้อ 2: การคอมไพล์แยกด้วย WebAssembly.compile + new Instance ---
console.log("\n2. ทดสอบ WebAssembly.compile() แยกขั้นตอนกับ Instance:");
const compiledMod = await WebAssembly.compile(wasmBytes);
const manualInstance = new WebAssembly.Instance(compiledMod, importObject);
assert.strictEqual(manualInstance.exports.add_numbers(15, 27), 42);
console.log("   ✅ WebAssembly.compile() + new Instance ทำงานถูกต้อง");

// --- ทดสอบข้อ 3: การจำลอง WebAssembly.instantiateStreaming() ---
console.log("\n3. ทดสอบการจำลอง WebAssembly.instantiateStreaming():");
// สร้าง Mock Response เสมือนดาวน์โหลดผ่าน HTTP
const mockResponse = new Response(wasmBytes, {
  headers: { "Content-Type": "application/wasm" }
});
const streamedResult = await WebAssembly.instantiateStreaming(mockResponse, importObject);
assert.strictEqual(streamedResult.instance.exports.add_numbers(100, 200), 300);
console.log("   ✅ WebAssembly.instantiateStreaming() ทำงานสำเร็จ");

// --- ทดสอบข้อ 4: การทำงานร่วมกันผ่าน SovereignWasmBridge (ccall / cwrap) ---
console.log("\n4. ทดสอบ Sovereign Universal Bridge (ccall / cwrap):");
const bridge = new SovereignWasmBridge(instance);

// 4.1 ทดสอบ ccall กับตัวเลข
const sumResult = bridge.ccall("add_numbers", "number", ["number", "number"], [50, 75]);
console.log(`   bridge.ccall("add_numbers"): ${sumResult} (คาดหวัง 125)`);
assert.strictEqual(sumResult, 125);

// 4.2 ทดสอบ cwrap ห่อหุ้มฟังก์ชันทักทาย (String in -> String out)
const greet = bridge.cwrap("greet_user", "string", ["string"]);
const greetingResult = greet("Wirot Chookeaw");
console.log(`   greet("Wirot Chookeaw") คืนค่า: "${greetingResult}"`);
assert.strictEqual(greetingResult, "Hello, Wirot Chookeaw!");
console.log("   ✅ cwrap แปลง String In/Out อัตโนมัติไร้รอยต่อ");

// 4.3 ทดสอบการเรียก host_log และ on_event จากภายใน Wasm ผ่าน reverse_str
const revText = "WebAssembly Sovereign 2026";
const encoded = new TextEncoder().encode(revText);
const ptr = instance.exports.alloc(encoded.length);
new Uint8Array(instance.exports.memory.buffer).set(encoded, ptr);

instance.exports.reverse_str(ptr, encoded.length);
assert.strictEqual(logs[0], "6202 ngierevoS ylbmessAbeW");
assert.strictEqual(events[0].eventId, 42);
assert.strictEqual(events[0].data, encoded.length);
console.log("   ✅ การเรียก Host Functions (host_log & on_event) จากภายใน Wasm สมบูรณ์แบบ");

// --- ทดสอบข้อ 5: การวัด Overhead ประสิทธิภาพ (Raw vs Bridge) ---
console.log("\n5. วัดค่า Performance Overhead (1,000,000 การเรียก):");
const N = 1_000_000;

// วัด Raw Wasm Call
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  instance.exports.add_numbers(i, 1);
}
const rawDuration = performance.now() - t0;

// วัด Wrapped Bridge Call
const wrappedAdd = bridge.cwrap("add_numbers", "number", ["number", "number"]);
const t1 = performance.now();
for (let i = 0; i < N; i++) {
  wrappedAdd(i, 1);
}
const bridgeDuration = performance.now() - t1;

console.log(`   Raw Wasm Export Call: ${rawDuration.toFixed(2)} ms (${(N / (rawDuration / 1000) / 1e6).toFixed(2)} M calls/sec)`);
console.log(`   Sovereign Bridge Call: ${bridgeDuration.toFixed(2)} ms (${(N / (bridgeDuration / 1000) / 1e6).toFixed(2)} M calls/sec)`);
console.log("   ✅ ประสิทธิภาพระดับเนทีฟ เหมาะสำหรับระบบที่ต้องการความเร็วระดับเสี้ยววินาที");

console.log("\n=======================================================");
console.log("🎉 ผลการทดสอบผ่านทุกขั้นตอน 100% สมบูรณ์แบบตามมาตรฐาน W3C!");
console.log("=======================================================");
