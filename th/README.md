# ⚡ คู่มือวิศวกรรม WebAssembly ฉบับมาตรฐานสากล W3C & MDN
## (The Definitive WebAssembly Engineering & Sovereign Implementation Guide)
**ผู้ประพันธ์:** Wirot Chookeaw (`chin6700x`)  
**สัญญาอนุญาตเอกสาร:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)  
**สัญญาอนุญาตซอร์สโค้ด:** [Apache-2.0 / MIT](../LICENSE) © 2026  
**มาตรฐานอ้างอิง:** [W3C WebAssembly Core Specification](https://webassembly.org/specs/) • [MDN WebAssembly Documentation](https://developer.mozilla.org/en-US/docs/WebAssembly)

---

## 🎯 วัตถุประสงค์ของคู่มือชุดนี้ (Purpose & Mission)
คู่มือชุดนี้จัดทำขึ้นเพื่อให้วิศวกรซอฟต์แวร์และผู้พัฒนาระบบคอมไพเลอร์เข้าใจสถาปัตยกรรมภายในของ **WebAssembly (WASM)** อย่างถ่องแท้ ตั้งแต่ระดับโครงสร้างไบต์ (Binary Bytecode Level), เครื่องกลเสมือนแบบสแตก (Stack Machine), กฎความปลอดภัย (Validation Rules) ตลอดจน**การสร้างตัวกำเนิด WebAssembly (Wasm Emitter) ด้วยภาษา C ขึ้นมาเองจากศูนย์ (Clean-Room Sovereign Implementation)** โดยไม่ต้องพึ่งพา Toolchain ขนาดใหญ่อย่าง Emscripten หรือ LLVM

---

## 📑 สารบัญหลัก (Table of Contents)

### 📌 [บทนำ: ปรัชญาและรากฐานของ WebAssembly](#บทนำ-ปรัชญาและรากฐานของ-webassembly)
* 0.1 ทำไมต้อง WebAssembly? ปัญหาของ JavaScript ในงาน High-Performance
* 0.2 มาตรฐานเปิด W3C และเป้าหมาย 4 ประการ (Fast, Safe, Portable, Compact)
* 0.3 ระบบนิเวศของ Wasm: จากเบราว์เซอร์ สู่ Serverless และ Embedded Systems (WASI)

---

### 🏛️ [บทที่ 1: สถาปัตยกรรมแกนกลางของ WebAssembly (Core Architecture & Stack Machine)](#บทที่-1-สถาปัตยกรรมแกนกลางของ-webassembly)
* 1.1 แนวคิดเครื่องจักรแบบสแตก (Stack-based Virtual Machine vs Register-based)
* 1.2 โครงสร้างโมดูล 4 เสาหลัก:
  * 1.2.1 **Functions:** หน่วยการประมวลผลคำสั่ง
  * 1.2.2 **Linear Memory:** หน่วยความจำดิบแบบเส้นตรง (Byte Array)
  * 1.2.3 **Tables:** ตารางอ้างอิงฟังก์ชันแบบปลอดภัย (Function Pointers / Dynamic Dispatch)
  * 1.2.4 **Globals:** ตัวแปรสากลประจำโมดูล (Mutable & Immutable)
* 1.3 วงจรชีวิตของ WebAssembly (Module -> Instantiation -> Instance -> Execution)

---

### 💾 [บทที่ 2: โครงสร้าง Binary Format ตามมาตรฐาน W3C (Binary Structure & Sections)](#บทที่-2-โครงสร้าง-binary-format-ตามมาตรฐาน-w3c)
* 2.1 Magic Number (`\0asm`) และ Version Field (8 ไบต์แรกที่ต้องมีเสมอ)
* 2.2 โครงสร้างไบนารีแบบ Section ID และ Payload Length
* 2.3 ตารางแจกแจง W3C Sections (ID 0 ถึง 12):
  * **Section 0 (Custom Section):** ข้อมูลดีบักและชื่อสัญลักษณ์ (`name`, `sourceMappingURL`)
  * **Section 1 (Type Section):** ลายเซ็นของฟังก์ชันทั้งหมดในโมดูล
  * **Section 2 (Import Section):** ฟังก์ชัน, หน่วยความจำ, หรือตัวแปรที่นำเข้าจากภายนอก
  * **Section 3 (Function Section):** การจับคู่ระหว่าง Index ฟังก์ชันกับ Type Index
  * **Section 4 (Table Section):** การประกาศตารางสำหรับ Indirect Calls
  * **Section 5 (Memory Section):** การประกาศ Linear Memory และขีดจำกัดขนาดหน้า (Pages)
  * **Section 6 (Global Section):** การกำหนดตัวแปร Global และค่าเริ่มต้น
  * **Section 7 (Export Section):** การส่งออกฟังก์ชันและหน่วยความจำให้ JavaScript/Host เรียกใช้งาน
  * **Section 8 (Start Section):** ฟังก์ชัน Auto-run เมื่อโมดูลถูกโหลด
  * **Section 9 (Element Section):** การกำหนดค่าเริ่มต้นลงใน Table
  * **Section 10 (Code Section):** ตัวเนื้อคำสั่ง Bytecode และ Local Variables ของแต่ละฟังก์ชัน
  * **Section 11 (Data Section):** ข้อมูลดิบตั้งต้น (Data Segments) เช่น สตริง หรือ ตารางค่าคงที่
  * **Section 12 (Data Count Section):** จำนวน Data Segments (จำเป็นใน Bulk Memory Operations)

---

### 🔢 [บทที่ 3: ระบบประเภทข้อมูลและการเข้ารหัส LEB128 (Type System & LEB128 Encoding)](#บทที่-3-ระบบประเภทข้อมูลและการเข้ารหัส-leb128)
* 3.1 Primitive Value Types ใน Wasm Core:
  * `i32` (`0x7F`), `i64` (`0x7E`), `f32` (`0x7D`), `f64` (`0x7C`)
* 3.2 Reference Types: `funcref` (`0x70`), `externref` (`0x6F`)
* 3.3 Vector Type (SIMD): `v128` (`0x7B`)
* 3.4 ขั้นตอนการเข้ารหัสตัวเลขประหยัดพื้นที่ด้วย **LEB128 (Little Endian Base 128)**:
  * 3.4.1 **Unsigned LEB128 (ULEB128):** สำหรับ Index และความยาว Section
  * 3.4.2 **Signed LEB128 (SLEB128):** สำหรับค่าคงที่จำนวนเต็มบวก/ลบ
  * 3.4.3 ซอร์สโค้ดภาษา C สำหรับฟังก์ชัน Encode/Decode ULEB128 และ SLEB128

---

### ⚙️ [บทที่ 4: ชุดคำสั่งและการประมวลผล (Instruction Set & Opcode Reference)](#บทที่-4-ชุดคำสั่งและการประมวลผล)
* 4.1 คำสั่งค่าคงที่ (Constants): `i32.const` (`0x41`), `i64.const` (`0x42`), `f32.const`, `f64.const`
* 4.2 คำสั่งตัวแปรเฉพาะที่ (Local & Global Variables):
  * `local.get` (`0x20`), `local.set` (`0x21`), `local.tee` (`0x22`)
  * `global.get` (`0x23`), `global.set` (`0x24`)
* 4.3 คำสั่งพีชคณิตและการเปรียบเทียบ (Arithmetic & Comparisons):
  * Addition, Subtraction, Multiplication, Division (`div_s`, `div_u`, `rem_s`)
  * Bitwise Operators (`and`, `or`, `xor`, `shl`, `shr_s`, `shr_u`, `rotl`, `rotr`)
  * Comparisons (`eq`, `ne`, `lt_s`, `le_s`, `gt_s`, `ge_s`, `eqz`)
* 4.4 คำสั่งแปลงประเภทข้อมูล (Conversions & Type Casting):
  * `i32.wrap_i64` (`0xA7`), `i64.extend_i32_s` (`0xAC`), `i64.extend_i32_u` (`0xAD`)
  * `f32.convert_i32_s`, `f64.promote_f32`, `i32.trunc_f32_s`
* 4.5 คำสั่งจัดการสแตก (Parametric Instructions): `drop` (`0x1A`), `select` (`0x1B`)

---

### 🔀 [บทที่ 5: กฎการควบคุมการไหลและโครงสร้างบล็อก (Structured Control Flow & Validation)](#บทที่-5-กฎการควบคุมการไหลและโครงสร้างบล็อก)
* 5.1 ทำไม WebAssembly ถึงไม่มีคำสั่งกระโดดอิสระ (`goto`)?
* 5.2 โครงสร้างบล็อกควบคุม:
  * `block` (`0x02`), `loop` (`0x03`), `if` (`0x04`), `else` (`0x05`), `end` (`0x0B`)
* 5.3 กฎการกระโดดด้วย Label Depth (`br` `0x0C`, `br_if` `0x0D`, `br_table` `0x0E`):
  * ความแตกต่างระหว่างการ `br` ออกจาก `block` (Exit) กับการ `br` ใน `loop` (Continue/Loop again)
* 5.4 การจำลองสถาปัตยกรรม Arbitrary CFG (Control Flow Graph) ของภาษา C:
  * การสร้าง **State-Machine Dispatch Loop** ด้วยตัวแปร `pc` (Program Counter)
* 5.5 กฎการตรวจสอบความถูกต้องของสแตก (Stack Validation & Polymorphic Stack):
  * กฎการทำงานเมื่อเจอคำสั่ง `unreachable` (`0x00`) และ `return` (`0x0F`)

---

### 🧠 [บทที่ 6: แบบจำลองหน่วยความจำเชิงเส้น (Linear Memory Model & Page Architecture)](#บทที่-6-แบบจำลองหน่วยความจำเชิงเส้น)
* 6.1 โครงสร้างของ Linear Memory: Byte Array ขนาดยักษ์แบบไม่มี Segment Register
* 6.2 หน่วยของ Memory Page (1 Page = 65,536 ไบต์ = 64 KB ตายตัว)
* 6.3 คำสั่งอ่านและเขียนหน่วยความจำ (Memory Load & Store):
  * `i32.load` (`0x28`), `i64.load` (`0x29`), `f32.load`, `f64.load`
  * `i32.store` (`0x36`), `i64.store` (`0x37`), `f32.store`, `f64.store`
  * คำสั่งโหลดขนาดสั้น: `i32.load8_s`, `i32.load8_u`, `i32.load16_s`, `i32.store8`, `i32.store16`
* 6.4 ค่า Memory Immediate: Memory Index, Alignment Exponent และ Dynamic Offset
* 6.5 การขยายหน่วยความจำขณะทำงาน: `memory.size` (`0x3F`) และ `memory.grow` (`0x40`)
* 6.6 การสร้าง Heap Memory Allocator ขนาดจิ๋ว (Minimal Bump Allocator) ภายใน Wasm

---

### 📇 [บทที่ 7: ฟังก์ชันพอยน์เตอร์และตารางทางอ้อม (Tables & Indirect Call Dispatch)](#บทที่-7-ฟังก์ชันพอยน์เตอร์และตารางทางอ้อม)
* 7.1 ปัญหาของ Function Pointer ในระบบ Type-Safe Sandbox
* 7.2 โครงสร้าง Table Section และ Element Section
* 7.3 การเรียกฟังก์ชันผ่าน Index ด้วยคำสั่ง `call_indirect` (`0x11`)
* 7.4 การทำ Dynamic Dispatch, Polymorphism, และ Virtual Method Table (VTABLE) บน Wasm

---

### 🌐 [บทที่ 8: การทำงานร่วมกับ JavaScript และ Browser API (JS & Web API Integration)](#บทที่-8-การทำงานร่วมกับ-javascript-และ-browser-api)
* 8.1 WebAssembly JavaScript Interface:
  * `WebAssembly.instantiate()` และ `WebAssembly.instantiateStreaming()`
  * `WebAssembly.compile()`, `WebAssembly.Module`, `WebAssembly.Instance`
  * `WebAssembly.Memory` (การเข้าถึงผ่าน `TypedArray`: `Uint8Array`, `Int32Array`)
* 8.2 การส่งผ่านข้อมูลระหว่าง JavaScript $\leftrightarrow$ WebAssembly:
  * 8.2.1 การส่งตัวเลขพื้นฐาน (Scalars)
  * 8.2.2 การส่งสตริง UTF-8 (การจัดสรรบัฟเฟอร์ใน Wasm $\rightarrow$ เขียนไบต์ $\rightarrow$ ส่ง Pointer)
  * 8.2.3 การอ่านสตริงผลลัพธ์กลับสู่ JavaScript (`TextDecoder`)
  * 8.2.4 การสร้างฟังก์ชัน `ccall()` และ `cwrap()` ขึ้นมาเองโดยไม่ต้องง้อ Emscripten
* 8.3 การนำเข้าฟังก์ชันจากเบราว์เซอร์เข้าสู่ Wasm (Import Object):
  * `console.log`, `performance.now()`, DOM manipulation ผ่าน Host Callback

---

### 🛠️ [บทที่ 9: การคอมไพล์ C/C++ สู่ Wasm ด้วย Clang โดยไม่ใช้ Emscripten (Bare-Metal Wasm Toolchain)](#บทที่-9-การคอมไพล์-cc-สู่-wasm-ด้วย-clang-โดยไม่ใช้-emscripten)
* 9.1 ความแตกต่างระหว่าง `emcc` กับ `clang --target=wasm32`
* 9.2 การใช้ Clang และ LLVM `wasm-ld`:
  * พารามิเตอร์สำคัญ: `-nostdlib`, `-Wl,--no-entry`, `-Wl,--export-all`, `-Wl,--allow-undefined`
* 9.3 ปัญหาขาดแคลน C Standard Library (Libc-less Environment) และทางออก
* 9.4 ตัวอย่างคำสั่งสร้างไบนารี WASM ขนาดเล็กกว่า 1 KB

---

### 🚀 [บทที่ 10: การสร้าง Sovereign WebAssembly Emitter ด้วยตนเอง (Clean-Room Compiler in C)](#บทที่-10-การสร้าง-sovereign-webassembly-emitter-ด้วยตนเอง)
* 10.1 วิเคราะห์สถาปัตยกรรม [`sld_wasm.c`](file:///Volumes/Mac%20Backup/compiler-dev/sld-compiler/src/sld_wasm.c) ใน `sld-compiler`:
  * การจัดสรรบัฟเฟอร์แบบไดนามิก (`wasm_buf_t`)
  * การรวมรวมลูปสร้าง Section ต่างๆ แบบ Single-Pass
* 10.2 การเชื่อมต่อตัวสร้าง Micro-IR เข้ากับ Wasm Generator
* 10.3 การสร้างระบบ Base64 Data URI และ Universal JS Bridge Generator อัตโนมัติ
* 10.4 กรณีศึกษา: การคอมไพล์ 13 ไฟล์ของ Syn-Prism ได้ไบนารี Wasm ในเวลาเพียง 20 มิลลิวินาที

---

### 🔍 [บทที่ 11: การตรวจสอบความถูกต้องและการดีบัก (Validation, Tools & Debugging)](#บทที่-11-การตรวจสอบความถูกต้องและการดีบัก)
* 11.1 กฎเกณฑ์ที่ V8 / SpiderMonkey / JavaScriptCore ใช้ปฏิเสธโมดูล Wasm
* 11.2 เครื่องมือสำคัญจาก WebAssembly Binary Toolkit (WABT):
  * `wat2wasm` (แปลง WebAssembly Text Format เป็น Binary)
  * `wasm2wat` (ถอดรหัส Binary กลับมาเป็น Text Format)
  * `wasm-validate` (ตรวจสอบความถูกต้องตามสเปก 100%)
  * `wasm-objdump` (ส่องดู Header และ Section Dump)
* 11.3 การดีบัก WebAssembly ใน Chrome DevTools และ Safari Web Inspector:
  * การตั้ง Breakpoint ใน Wasm Bytecode
  * การส่องค่าใน Linear Memory Tab

---

### 🔮 [บทที่ 12: Wasm ยุคใหม่และอนาคต (WASI, SIMD, Threads & Component Model)](#บทที่-12-wasm-ยุคใหม่และอนาคต)
* 12.1 Fixed-width SIMD (128-bit SIMD Opcodes `v128`) สำหรับงานคำนวณและกราฟิก
* 12.2 WebAssembly Threads และ SharedArrayBuffer (`atomics`)
* 12.3 WASI (WebAssembly System Interface): รัน Wasm นอกเบราว์เซอร์เหมือนไบนารีระบบ
* 12.4 Wasm GC (Garbage Collection Proposal) สำหรับภาษาระดับสูง (Kotlin, Dart, Java)
* 12.5 Wasm Component Model: ยุคใหม่ของการเชื่อมต่อโมดูลข้ามภาษา

---

### 🧪 [บทที่ 13: โปรแกรมตัวอย่างที่ 1 — Sieve of Eratosthenes ด้วย WAT ล้วน](13-example-sieve.md)
* 13.1 โจทย์และ API ที่ Export (`sieve`, `is_prime`, `memory`)
* 13.2 การออกแบบหน่วยความจำ: 1 ไบต์ต่อ 1 ตัวเลข และการป้องกัน out-of-bounds
* 13.3 เขียนโปรแกรมด้วย WebAssembly Text Format: `memory.fill`, `block`/`loop`, `br_if`
* 13.4 คอมไพล์ด้วย `wat2wasm` ตรวจด้วย `wasm-validate` (ไบนารี 233 ไบต์)
* 13.5 เรียกใช้จาก JavaScript และอ่าน bitmap จาก Linear Memory
* 13.6 ผลทดสอบเทียบกับ JS reference + แบบฝึกหัด

---

### 🎨 [บทที่ 14: โปรแกรมตัวอย่างที่ 2 — Mandelbrot Explorer (C → Wasm + Canvas)](14-example-mandelbrot.md)
* 14.1 โจทย์: Wasm คำนวณพิกเซล, JS วาดลง `<canvas>` แบบ Zero-copy
* 14.2 อัลกอริทึม $z_{n+1} = z_n^2 + c$ แยกส่วนจริง/จินตภาพ
* 14.3 โค้ด C แบบ Bare-Metal (ไม่มี libc) และรูปแบบสี RGBA Little-Endian
* 14.4 คอมไพล์ด้วย `wasm32-clang` (ไบนารี 945 ไบต์) และอ่านผล `wasm-objdump`
* 14.5 หน้าเว็บ `mandelbrot.html`: คลิกซูมเข้า/ออก ปรับ `max_iter`
* 14.6 ชุดทดสอบ: เทียบ 750 จุดและผลรวมรอบกับ JS + แบบฝึกหัด (Julia set, SIMD, Workers)

---

### 🖼️ [บทที่ 15: โปรแกรมตัวอย่างที่ 3 — Wasm Image Studio (หมุน ตัด ย่อ/ขยาย ฟิลเตอร์ภาพ)](15-example-image-studio.md)
* 15.1 โจทย์และฟีเจอร์: rotate, flip, crop, resize, grayscale, blur/sharpen/edge
* 15.2 สถาปัตยกรรม Double Buffer และความหมายของ `commit()`
* 15.3 อัลกอริทึม: Inverse Mapping, Bilinear, sin/cos แบบไม่ใช้ libm, Kernel 3×3
* 15.4 คอมไพล์ด้วย `wasm32-clang` (ไบนารี 8.5 KB)
* 15.5 เชื่อมต่อจาก JavaScript และหน้าเว็บ `imgproc.html` (อัปโหลด, ลากครอป, Undo)
* 15.6 วิธีรัน, ผลทดสอบเทียบ reference ทุกพิกเซล + แบบฝึกหัด

---

## 📚 แหล่งข้อมูลอ้างอิงระดับทางการ (Official References)
1. **W3C WebAssembly Core Specification (Version 2.0 Draft / 1.0 Final):**  
   https://webassembly.github.io/spec/core/
2. **MDN WebAssembly Reference & Guides:**  
   https://developer.mozilla.org/en-US/docs/WebAssembly
3. **WebAssembly Official Site:**  
   https://webassembly.org/
4. **WABT (WebAssembly Binary Toolkit):**  
   https://github.com/WebAssembly/wabt
