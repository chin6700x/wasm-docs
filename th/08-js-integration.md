# บทที่ 8: การทำงานร่วมกับ JavaScript และ Browser API (JS & Web API Integration)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • เอกสาร: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • โค้ด: [Apache-2.0 / MIT](../LICENSE)
> อ้างอิง: [MDN WebAssembly JavaScript Interface](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface) • [W3C WebAssembly JS API Spec](https://webassembly.github.io/spec/js-api/)

[⬅ บทที่ 7](07-tables-indirect-call.md) | [สารบัญ](README.md) | [บทที่ 9 ➡](09-clang-bare-metal.md)

> [!NOTE]
> ตัวอย่างโค้ดสถาปัตยกรรมการเชื่อมต่อ JS $\leftrightarrow$ Wasm, การจำลอง Streaming Compilation, การผูก Host Callback, และการสร้าง Sovereign `ccall`/`cwrap` ทั้งหมดในบทนี้ ได้รับการทดสอบผ่าน V8 Engine จริงใน [examples/js-bridge-test.js](examples/js-bridge-test.js)

---

## 8.1 สถาปัตยกรรม WebAssembly JavaScript Interface

เบราว์เซอร์ยุคใหม่เปิดเผย API มาตรฐานภายใต้เนมสเปซ **`WebAssembly`** เพื่อให้ JavaScript สามารถโหลด คอมไพล์ เปิดใช้งาน (Instantiate) และแลกเปลี่ยนข้อมูลกับโมดูล WebAssembly ได้:

```
+-----------------------------------------------------------------------------------+
|                        WebAssembly JavaScript API Lifecycle                       |
|                                                                                   |
|  [ Fetch Network Stream ]                                                         |
|             │                                                                     |
|             ▼                                                                     |
|  WebAssembly.instantiateStreaming(response, importObject)                         |
|             │                                                                     |
|      ┌──────┴─────────────────────────────────┐                                   |
|      ▼                                        ▼                                   |
|  [ WebAssembly.Module ]               [ WebAssembly.Instance ]                    |
|  (Stateless Compiled Machine Code)    (Stateful Execution: Memory, Table, Globals)|
+-----------------------------------------------------------------------------------+
```

### 1. วิธีเปิดใช้งาน 3 รูปแบบหลัก

#### ก) `WebAssembly.instantiateStreaming()` (มาตรฐานสูงสุดสำหรับ Browser Production)
เป็นวิธีที่มีประสิทธิภาพสูงสุด เพราะเบราว์เซอร์จะ **ทำการคอมไพล์ไบต์โค้ดไปพร้อมๆ กับการดาวน์โหลดข้อมูลผ่านเครือข่าย (Streaming Compilation)** โดยไม่ต้องรอให้ไฟล์ดาวน์โหลดจนเสร็จสมบูรณ์ และไม่ต้องแปลง Response เป็น `ArrayBuffer`:
```javascript
const importObject = { env: { log: (x) => console.log(x) } };

// บราวเซอร์จะเริ่ม JIT-compile ทันทีที่ไบต์แรกส่งมาถึงเครื่อง
const { module, instance } = await WebAssembly.instantiateStreaming(
  fetch("app.wasm"), 
  importObject
);
```

#### ข) `WebAssembly.instantiate(bufferSource, importObject)`
ใช้เมื่อมีไบต์โค้ดอยู่ในรูป `ArrayBuffer` หรือ `Uint8Array` เรียบร้อยแล้ว (เช่น รันใน Node.js, โหลดจาก IndexedDB, หรืออ่านจาก Local File):
```javascript
const wasmBuffer = await fs.promises.readFile("app.wasm");
const { module, instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
```

#### ค) การแยกขั้นตอน: `WebAssembly.compile()` และ `new WebAssembly.Instance()`
เหมาะสำหรับระบบที่ต้องการ **แชร์ Compiled Code ข้าม Web Workers**:
```javascript
// คอมไพล์ 1 ครั้ง ได้เป็น WebAssembly.Module (ไม่มีสถานะ / Thread-safe)
const module = await WebAssembly.compile(wasmBuffer);

// ส่ง module ข้ามไปยัง Web Workers หลายๆ ตัวผ่าน postMessage() ได้ทันที
// แต่ละ Worker สร้าง Instance ของตัวเองด้วย Memory อิสระ:
const instance1 = new WebAssembly.Instance(module, importObject1);
const instance2 = new WebAssembly.Instance(module, importObject2);
```

---

## 8.2 การแลกเปลี่ยนข้อมูลระหว่าง JavaScript $\leftrightarrow$ WebAssembly

เนื่องจาก WebAssembly รองรับเฉพาะชนิดข้อมูลตัวเลขระดับต่ำ (`i32`, `i64`, `f32`, `f64`) การแลกเปลี่ยนข้อมูลที่มีโครงสร้างซับซ้อน (เช่น สตริง, อาร์เรย์, JSON, Struct) จะต้องทำผ่าน **Linear Memory Bridge**:

### 1. การส่งผ่านตัวเลขสเกลาร์ (Scalars)
- `i32`, `f32`, `f64` $\rightarrow$ ส่งผ่านและรับกลับเป็น `Number` ของ JavaScript ได้โดยตรง
- `i64` $\rightarrow$ ส่งผ่านและรับกลับเป็น **`BigInt`** ของ JavaScript (มี `n` ต่อท้าย เช่น `42n`)

---

### 2. การส่งสตริง UTF-8 จาก JS เข้าสู่ WebAssembly (Zero-Copy Transfer)

```
[ JavaScript ]                                         [ WebAssembly Linear Memory ]
const text = "Wirot";                                   
const bytes = TextEncoder.encode(text);                  
const ptr = instance.exports.alloc(bytes.length + 1); ──► [ Heap Allocator คืน ptr = 1040 ]
Uint8Array(memory.buffer).set(bytes, ptr);            ──► [ 1040: 'W' 'i' 'r' 'o' 't' '\0' ]
instance.exports.process_str(ptr);                    ──► อ่านประมวลผลผ่าน i32.load
```

#### ขั้นตอนการเขียนโค้ด:
```javascript
const encoder = new TextEncoder();
const text = "WebAssembly 2026";
const encodedBytes = encoder.encode(text);

// 1. ขอพื้นที่ Heap ใน Wasm ผ่านฟังก์ชัน alloc ที่ Export ออกมา
const ptr = instance.exports.alloc(encodedBytes.length + 1);

// 2. คัดลอกไบต์ลง Linear Memory ตรงๆ
const memoryView = new Uint8Array(instance.exports.memory.buffer);
memoryView.set(encodedBytes, ptr);
memoryView[ptr + encodedBytes.length] = 0; // เติม Null-terminator \0

// 3. ส่ง Pointer เข้าไปให้ฟังก์ชัน Wasm ประมวลผล
instance.exports.process_string(ptr, encodedBytes.length);
```

---

### 3. การอ่านสตริงผลลัพธ์กลับสู่ JavaScript (`TextDecoder`)

เมื่อฟังก์ชันใน Wasm คืนค่าเป็น `ptr` ของ Null-terminated string:
```javascript
function readStringFromWasm(instance, ptr) {
  const memoryView = new Uint8Array(instance.exports.memory.buffer);
  
  // สแกนหาความยาวจนกว่าจะเจอไบต์ 0 (\0)
  let end = ptr;
  while (memoryView[end] !== 0) {
    end++;
  }

  // สร้าง TypedArray Slice แบบ Zero-Copy แล้วถอดรหัสเป็นสตริง
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(memoryView.subarray(ptr, end));
}
```

---

## 8.3 การสร้าง Sovereign Universal Bridge (`ccall` และ `cwrap` โดยไม่ต้องง้อ Emscripten)

Emscripten มีระบบช่วยเหลืออย่าง `ccall()` และ `cwrap()` แต่ต้องแลกมาด้วยไฟล์รันไทม์ JavaScript ขนาดหลายสิบหรือหลายร้อยกิโลไบต์  
เราสามารถสร้าง **Sovereign JS Bridge ขนาดกะทัดรัดไม่ถึง 50 บรรทัด** ที่รองรับ Type Conversion อัตโนมัติได้ดังนี้:

```javascript
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
    mem[ptr + bytes.length] = 0; // Null-terminator
    return { ptr, len: bytes.length };
  }

  // อ่านสตริงออกจาก Wasm Linear Memory
  readString(ptr) {
    const mem = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return this.decoder.decode(mem.subarray(ptr, end));
  }

  // เรียกฟังก์ชัน Wasm พร้อม Type Marshaling อัตโนมัติ
  ccall(ident, returnType, argTypes = [], args = []) {
    const fn = this.exports[ident];
    if (typeof fn !== "function") {
      throw new Error(`Export '${ident}' not found in Wasm instance`);
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

    if (returnType === "string") return this.readString(rawResult);
    if (returnType === "boolean") return Boolean(rawResult);
    if (returnType === "number") return Number(rawResult);
    return rawResult;
  }

  // ห่อหุ้มฟังก์ชันให้เรียกใช้งานได้เสมือน JavaScript Function ทั่วไป
  cwrap(ident, returnType, argTypes = []) {
    return (...args) => this.ccall(ident, returnType, argTypes, args);
  }
}
```

### ตัวอย่างการใช้งานจริง:
```javascript
const bridge = new SovereignWasmBridge(instance);

// สร้างฟังก์ชัน native JS จากฟังก์ชัน C/Wasm ในบรรทัดเดียว!
const greetUser = bridge.cwrap("greet_user", "string", ["string"]);
const addNumbers = bridge.cwrap("add_numbers", "number", ["number", "number"]);

console.log(greetUser("Wirot Chookeaw")); // แสดงผล: "Hello, Wirot Chookeaw!"
console.log(addNumbers(15, 27));           // แสดงผล: 42
```

---

## 8.4 การนำเข้าฟังก์ชันโฮสต์จากเบราว์เซอร์เข้าสู่ Wasm (Import Object)

ในโครงสร้างไบนารี **Section 2 (Import Section)** อนุญาตให้โมดูล Wasm ประกาศฟังก์ชันที่ต้องการเรียกใช้จากโฮสต์:

```wat
(module
  ;; นำเข้าฟังก์ชัน console_log และ now จาก JavaScript
  (import "env" "host_log" (func $host_log (param i32 i32)))
  (import "env" "get_time" (func $get_time (result f64)))
  (import "env" "on_event" (func $on_event (param i32 i32)))
  
  (memory (export "memory") 1)
  
  (func (export "trigger")
    ;; เรียกฟังก์ชันโฮสต์ get_time
    call $get_time
    drop
    
    ;; ส่ง Event แจ้งเตือนไปยัง JavaScript
    i32.const 42
    i32.const 100
    call $on_event
  )
)
```

### การผูก Object ตอน Instantiate ใน JavaScript:
```javascript
const importObject = {
  env: {
    host_log: (ptr, len) => {
      const mem = new Uint8Array(instance.exports.memory.buffer);
      const msg = new TextDecoder().decode(mem.subarray(ptr, ptr + len));
      console.log("[Wasm Log]:", msg);
    },
    get_time: () => performance.now(),
    on_event: (eventId, data) => {
      console.log(`Event ${eventId} triggered with data ${data}`);
    }
  }
};

const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
instance.exports.trigger();
```

---

## 8.5 การวัดค่าความเร็วและ Call Overhead ระหว่าง Raw Call กับ Bridge

จากการทดสอบ Benchmark จริงใน [examples/js-bridge-test.js](examples/js-bridge-test.js) ด้วยการเรียก 1,000,000 ครั้งบน V8 (Node.js v24 Apple Silicon):

| รูปแบบการเรียก | เวลาที่ใช้ (1M Calls) | ความเร็วในการประมวลผล | จุดเด่น |
| :--- | :---: | :---: | :--- |
| **Raw Wasm Export Call** | **11.91 ms** | **~84 ล้านครั้ง / วินาที** | เร็วที่สุด เหมาะสำหรับลูปคำนวณกราฟิก/ฟิสิกส์ในระดับ Micro-benchmarks |
| **Sovereign Bridge (`cwrap`)** | **26.68 ms** | **~37 ล้านครั้ง / วินาที** | ความสะดวกสูงสุด แปลง String / Number อัตโนมัติ มี Overhead เพียง ~14 นาโนวินาทีต่อ Call |

โค้ดและชุดทดสอบที่ทำงานได้จริงแบบครบวงจรสามารถดูได้ที่ [examples/js-bridge-test.js](examples/js-bridge-test.js)

---

[⬅ บทที่ 7: ฟังก์ชันพอยน์เตอร์และตารางทางอ้อม](07-tables-indirect-call.md) | [สารบัญหลัก](README.md) | [บทที่ 9: การคอมไพล์ C/C++ สู่ Wasm ด้วย Clang โดยไม่ใช้ Emscripten ➡](09-clang-bare-metal.md)
