# บทที่ 11: การตรวจสอบความถูกต้องและการดีบัก (Validation, Tools & Debugging)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • เอกสาร: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • โค้ด: [Apache-2.0 / MIT](../LICENSE)
> อ้างอิง: [W3C WebAssembly Validation Spec](https://webassembly.github.io/spec/core/valid/index.html) • [WABT: WebAssembly Binary Toolkit](https://github.com/WebAssembly/wabt) • [Chrome DevTools WebAssembly Debugging](https://developer.chrome.com/docs/devtools/wasm)

[⬅ บทที่ 10](10-sovereign-emitter.md) | [สารบัญ](README.md) | [บทที่ 12 ➡](12-modern-wasm.md)

> [!NOTE]
> ตัวอย่างการดักจับข้อผิดพลาดระดับ Validation, การใช้เครื่องมือ WABT (`wat2wasm`, `wasm2wat`, `wasm-validate`, `wasm-objdump`), และชุดทดสอบความถูกต้องทั้งหมดในบทนี้ สามารถรันและตรวจสอบผ่านเครื่องจริงได้ทันทีด้วย [examples/validation-debug-test.js](examples/validation-debug-test.js)

---

## 11.1 กฎเกณฑ์ที่ V8 / SpiderMonkey / JavaScriptCore ใช้ปฏิเสธโมดูล Wasm

ก่อนที่เอนจินของเบราว์เซอร์จะยอมรัน WebAssembly ไบต์โค้ด มันจะส่งไบนารีเข้าสู่กระบวนการ **Single-Pass Validation Algorithm** หากพบความผิดปกติแม้แต่ไบต์เดียว เอนจินจะปฏิเสธการทำงานและโยนข้อผิดพลาด **`WebAssembly.CompileError`** ทันที เพื่อป้องกันช่องโหว่ความปลอดภัยและการโจมตีหน่วยความจำ

```
+-----------------------------------------------------------------------------------+
|                        WebAssembly Verification Pipeline                          |
|                                                                                   |
|  [ Binary Stream ] ──► [ 1. Binary Decoder ] ──► [ 2. Bytecode Validator ]       |
|                                │                              │                   |
|                        - Magic / Version              - Stack Height & Types      |
|                        - Section Sequence             - Local Index Bounds        |
|                        - LEB128 Integrity             - Control Flow Labels       |
|                                │                              │                   |
|                                ▼                              ▼                   |
|                        💥 CompileError                💥 CompileError             |
|                        (ถ้าโครงสร้างผิด)              (ถ้าละเมิดกฎสแตก)           |
+-----------------------------------------------------------------------------------+
```

### 7 กฎเหล็กที่พบบ่อยที่สุดในการปฏิเสธโมดูล:

#### 1. Magic Word & Binary Version Mismatch
4 ไบต์แรกต้องเป็น `\0asm` (`0x00 0x61 0x73 0x6D`) และ 4 ไบต์ถัดมาต้องเป็น Version 1 (`0x01 0x00 0x00 0x00`)
- **ข้อความจาก V8:** `CompileError: WebAssembly.Module(): expected magic word 00 61 73 6d, found ...`

#### 2. Section Ordering Violation (การเรียงลำดับ Section ผิดกฎ)
Section ID ที่มีเนื้อหาจริง (1 ถึง 12) **ต้องเรียงลำดับจากน้อยไปมากเสมอ** (ยกเว้น Custom Section ID 0 ที่แทรกได้ทุกที่) และหากมี DataCount Section (ID 12) จะต้องปรากฏก่อนหน้า Code Section (ID 10) เสมอ
- **ข้อความจาก V8:** `CompileError: WebAssembly.Module(): unexpected section <id> @+offset`

#### 3. Invalid Local Index (การอ้างอิง Local เกินจำนวนที่ประกาศ)
เป็นข้อผิดพลาดคลาสสิกที่เกิดขึ้นเมื่อคอมไพเลอร์ใช้คำสั่ง `local.get $idx` หรือ `local.set $idx` โดยที่ `$idx \ge (\text{param\_count} + \text{declared\_locals})`
- **ข้อความจาก V8:** `CompileError: Compiling function #0 failed: invalid local index: 25 @+offset`
- **ข้อความจาก WABT:** `error: local variable out of range (max N)`

#### 4. Stack Underflow (การดึงค่าจากสแตกว่าง)
เกิดขึ้นเมื่อเรียกคำสั่งที่ต้องการ Operand บนสแตก (เช่น `i32.add` ต้องการ 2 ค่า) แต่ขณะนั้นสแตกมีค่าน้อยกว่าที่กำหนด
- **ข้อความจาก V8:** `CompileError: Compiling function #0 failed: not enough arguments on the stack for i32.add (need 2, got 0)`

#### 5. Type Consistency Violation (ชนิดข้อมูลบนสแตกไม่ตรงกัน)
เช่น ฟังก์ชันคืนค่าเป็น `i32` แต่เมื่อถึงจุดจบฟังก์ชัน (`end`) บนสแตกกลับเป็น `i64` หรือ `f32`
- **ข้อความจาก V8:** `CompileError: type mismatch in function result, expected i32, got f32`

#### 6. Branch Stack Height & Polymorphism Mismatch
การกระโดดด้วย `br` หรือ `br_if` ไปยัง Label ที่ต้องการผลลัพธ์ แต่บนสแตกไม่มีค่ารองรับ หรือจำนวนค่าไม่ตรงกับลายเซ็นของบล็อก
- **ข้อความจาก V8:** `CompileError: expected 1 elements on the stack for branch, found 0`

#### 7. Memory Alignment Exponent Overflow ($2^{\text{align}} > \text{natural width}$)
Immediate Argument `align` ในคำสั่ง `load`/`store` เป็นเลขยกกำลังฐานสอง หากกำหนดค่าเกินขนาดจริงของชนิดข้อมูล (เช่น `i32.load` ขนาด 4 ไบต์ แต่กำหนด `align = 3` ซึ่งคือ $2^3 = 8$ ไบต์) จะถูกปฏิเสธทันที
- **ข้อความจาก V8:** `CompileError: invalid alignment; expected maximum alignment is 2, actual alignment is 3`

---

## 11.2 เครื่องมือสำคัญจาก WebAssembly Binary Toolkit (WABT)

**WABT (ออกเสียงว่า "วับ-ที")** เป็นชุดเครื่องมือมาตรฐานระดับทางการจาก W3C WebAssembly Community Group สำหรับวิเคราะห์ แปลง และตรวจสอบโมดูล Wasm:

```
+---------------------------------------------------------------------------------+
|                       WABT Toolchain Workflow Map                               |
|                                                                                 |
|   [ Text Format: .wat ]  ──────── wat2wasm ───────►  [ Binary Format: .wasm ]   |
|            ▲                                                        │           |
|            └──────────────────── wasm2wat ──────────────────────────┘           |
|                                                                     │           |
|                                ┌────────────────────────────────────┼─────────┐ |
|                                ▼                                    ▼         ▼ |
|                         wasm-validate                         wasm-objdump  wasm-decompile
|                     (ตรวจสอบความถูกต้อง 100%)                  (ส่องดูโครงสร้าง) (แปลงเป็น C-like)
+---------------------------------------------------------------------------------+
```

### 1. `wat2wasm` — ประกอบ Text Format เป็น Binary
ใช้แปลงโค้ด `.wat` เป็น `.wasm` ไบนารี พร้อมออปชันตรวจสอบ:
```bash
# คอมไพล์แบบปกติ
wat2wasm module.wat -o module.wasm

# คอมไพล์พร้อมเก็บชื่อฟังก์ชันและตัวแปรไว้ช่วยดีบัก (Debug Names Section)
wat2wasm module.wat --debug-names -o module.wasm

# เปิดใช้งานฟีเจอร์ยุคใหม่ทั้งหมด (SIMD, Threads, Multi-memory)
wat2wasm module.wat --enable-all -o module.wasm
```

### 2. `wasm2wat` — ถอดรหัส Binary กลับมาเป็น Text ที่อ่านเข้าใจง่าย
เมื่อมีไฟล์ `.wasm` ที่ไม่ทราบที่มา สามารถถอดรหัสออกมาดูไส้ในได้ทันที:
```bash
# แปลง Binary กลับเป็น WAT
wasm2wat module.wasm -o module.wat

# จัดรูปแบบนิพจน์แบบพับซ้อน (Folded Expressions สไตล์ Lisp) ช่วยให้อ่านง่ายขึ้น
wasm2wat module.wasm --fold-exprs -o readable.wat
```

### 3. `wasm-validate` — ตรวจสอบความถูกต้องตามสเปก W3C 100%
เครื่องมือที่สำคัญที่สุดสำหรับผู้สร้างคอมไพเลอร์ หากผ่านคำสั่งนี้ แปลว่าไบนารีสามารถรันได้บนทุกเบราว์เซอร์ในโลก:
```bash
wasm-validate module.wasm
```
*หากไฟล์ถูกต้อง จะไม่มี Error แสดงขึ้นมา (Exit code 0)*  
*หากมีจุดผิด จะชี้ตำแหน่ง Byte Offset และสาเหตุอย่างละเอียด:*
```
module.wasm:000001a: error: local variable out of range (max 0)
```

### 4. `wasm-objdump` — ส่องดู Header, Section Table, และ Disassembly
คล้ายกับ `objdump` บน Linux แต่สร้างมาเพื่อ WebAssembly โดยเฉพาะ:
```bash
# ดูสรุป Section Headers ทั้งหมดในไฟล์ (ขนาด, ตำแหน่งเริ่มต้น-สิ้นสุด, จำนวน entries)
wasm-objdump -h module.wasm

# ดูรายละเอียดทั้งหมดรวมถึง Type Signatures, Imports, Exports (Headers + Details)
wasm-objdump -x module.wasm

# Disassemble แสดงไบต์โค้ดคู่กับ Hex Dump แบบเรียงตามบรรทัด
wasm-objdump -d module.wasm
```

### 5. `wasm-decompile` — แปลงเป็นโค้ดหน้าตาคล้ายภาษา C (Decompiler)
ช่วยให้วิศวกรเข้าใจตรรกะการทำงานของโปรแกรมได้อย่างรวดเร็วโดยไม่ต้องอ่านไบต์โค้ด Stack ทีละคำสั่ง:
```bash
wasm-decompile module.wasm -o module.dcmp
```

---

## 11.3 คู่มือการดีบัก WebAssembly ใน Chrome DevTools และ Safari Web Inspector

เบราว์เซอร์สมัยใหม่รองรับการดีบัก WebAssembly แบบ Native ระดับ Source-level:

```
+---------------------------------------------------------------------------------+
|                       Chrome DevTools WebAssembly Debugger                      |
+---------------------------------------------------------------------------------+
| Sources Tab:                                                                    |
|  wasm://wasm/3a5e8b2c/ (Decompiled on-the-fly)                                  |
|  ─────────────────────────────────────────────────────────────────────────────  |
|  1  (module                                                                     |
|  2    (func $add (param $p0 i32) (param $p1 i32) (result i32)                   |
|  3  ●   local.get $p0         ◄── [ Breakpoint หยุดที่นี่ ]                       |
|  4      local.get $p1                                                           |
|  5      i32.add                                                                 |
|  6      return)                                                                 |
|  ─────────────────────────────────────────────────────────────────────────────  |
|  Scope Panel:                   Call Stack:             Memory Inspector:       |
|    $p0: 15                        $add (line 3)           0x0000: 78 56 34 12   |
|    $p1: 27                        (anonymous)             0x0004: FE 00 00 00   |
+---------------------------------------------------------------------------------+
```

### 1. การตั้ง Breakpoints ใน Wasm Bytecode
1. เปิด **Chrome DevTools** (`F12` หรือ `Cmd + Option + I`)
2. ไปที่แท็บ **Sources**
3. ในแถบซ้ายมือ มองหาโดเมนที่รันอยู่ จะพบโฟลเดอร์สีเหลืองเขียนว่า **`wasm://`**
4. คลิกเปิดไฟล์ Wasm เอนจินจะทำการ Disassemble เป็น Text Format ให้อัตโนมัติ
5. คลิกที่หมายเลขบรรทัดเพื่อวาง **Breakpoint (จุดหยุด)**
6. เมื่อโค้ดทำงานถึงจุดนั้น เบราว์เซอร์จะหยุดพัก ให้คุณกด `F10` (Step over) หรือ `F11` (Step into) เพื่อดูการเปลี่ยนแปลงค่าใน Operand Stack และ Local Variables ได้ทันที!

### 2. การใช้งาน Memory Inspector Tab (ส่อง Linear Memory แบบ Live)
1. ในหน้าต่าง Scope ทางขวามือ มองหาตัวแปร **`memory`** หรือคลิกที่ตัวแปร TypedArray ในโค้ด JavaScript
2. จะปรากฏไอคอนรูป **แว่นขยายคู่กับตาราง (Inspect Memory)** ถัดจากชื่อตัวแปร
3. คลิกไอคอนดังกล่าว Chrome DevTools จะเปิดแถบ **Memory Inspector** ขึ้นมาที่ด้านล่าง:
   - แสดงตารางหน่วยความจำแบบ **Hex Dump** พร้อม ASCII Preview
   - รองรับการสลับมุมมองระหว่าง 8-bit, 16-bit, 32-bit (Signed/Unsigned/Float)
   - มีช่องค้นหาแอดเดรส ช่วยให้ติดตามการเปลี่ยนแปลงใน Wasm Heap ได้แบบ Real-time

### 3. การใช้งาน DWARF Debug Information จาก Clang (`-g`)
หากคอมไพล์ภาษา C/C++ ด้วย Clang โดยใส่ธง **`-g`** (และติดตั้งส่วนขยาย [C/C++ DevTools Support (DWARF)](https://chromewebstore.google.com/detail/cc++-devtools-support-dwa/pdcpmagijalflfakpmioilipagdnacbm) ใน Chrome):
- Chrome DevTools จะแสดง **ซอร์สโค้ดภาษา C ต้นฉบับ (`.c`)** แทนที่จะเป็นไบต์โค้ด Wasm
- สามารถตั้ง Breakpoint บนบรรทัดโค้ดภาษา C ได้โดยตรง และดูค่าตัวแปร C Struct ในแท็บ Scope ได้อย่างแม่นยำ

สามารถทดสอบรันการตรวจสอบความถูกต้องและชุดเครื่องมือ WABT ทั้งหมดได้ที่ [examples/validation-debug-test.js](examples/validation-debug-test.js)

---

[⬅ บทที่ 10: การสร้าง Sovereign WebAssembly Emitter ด้วยตนเอง](10-sovereign-emitter.md) | [สารบัญหลัก](README.md) | [บทที่ 12: Wasm ยุคใหม่และอนาคต ➡](12-modern-wasm.md)
