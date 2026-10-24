# ⚡ คู่มือวิศวกรรม WebAssembly ฉบับมาตรฐานสากล W3C & MDN
## (The Definitive WebAssembly Engineering & Sovereign Implementation Guide)

> **ผู้ประพันธ์:** วิโรจน์ ชูแก้ว ([`chin6700x`](https://github.com/chin6700x))  
> **คลังเอกสาร (Repository):** [`wasm-docs`](https://github.com/chin6700x/wasm-docs)  
> **สัญญาอนุญาต:** [Apache-2.0 / MIT](LICENSE) © 2026  
> **มาตรฐานอ้างอิง:** [W3C WebAssembly Core Specification](https://webassembly.github.io/spec/core/) • [MDN WebAssembly Guides](https://developer.mozilla.org/en-US/docs/WebAssembly)  
> **ภาษาที่รองรับ:** [ภาษาไทย](th.README.md) | [English](README.md)

---

## 🎯 วัตถุประสงค์และปรัชญา (Mission & Philosophy)

คู่มือวิศวกรรมชุดนี้จัดทำขึ้นเพื่อให้วิศวกรซอฟต์แวร์ ผู้พัฒนาระบบคอมไพเลอร์ และสถาปัตย์ระบบ เข้าใจกลไกภายในของ **WebAssembly (WASM)** อย่างถ่องแท้จากรากฐาน First Principles

แทนที่จะมอง WebAssembly เป็นเพียงผลลัพธ์คอมไพล์จาก Toolchain ยักษ์ใหญ่ที่หนักและซับซ้อน (เช่น Emscripten หรือ LLVM ชุดใหญ่) คู่มือเล่มนี้จะพาคุณเจาะลึก:
* **โครงสร้างไบนารีระดับไบต์ (Binary Bytecode Layer):** วิเคราะห์ Magic Number, Section ID, Payload Lengths และการเข้ารหัสตัวเลข LEB128
* **สถาปัตยกรรมเครื่องกลแบบสแตก (Stack Machine Architecture):** การเปลี่ยนสถานะของสแตก, การตรวจสอบประเภทข้อมูล (Validation Rules), และโครงสร้างควบคุมแบบ Structured Control Flow (`block`, `loop`, `if`, `br_table`)
* **หน่วยความจำเชิงเส้น (Linear Memory):** การขยาย Page แบบไดนามิก (64 KB), การจัดวางข้อมูล Little-Endian, การสร้าง Bump Allocator และการแชร์ข้อมูล Zero-Copy กับ JavaScript
* **การสร้าง Wasm Emitter ด้วยภาษา C ขึ้นมาเองจากศูนย์ (Clean-Room Implementation):** คอมไพล์ภาษา C ตรงสู่ Wasm Bytecode ได้ภายใน 20 มิลลิวินาที โดยไม่พึ่งพาเครื่องมือภายนอก
* **การพิสูจน์ผลลัพธ์ผ่านการทดสอบจริง:** ครอบคลุมชุดทดสอบ 80 เคสบน V8 Engine (Node.js), JavaScriptCore, และ WABT Toolchain

---

## 🗺️ แผนที่หลักสูตร (Curriculum Roadmap)

```
┌────────────────────────────────────────────────────────────────────────┐
│             คู่มือวิศวกรรมสถาปัตยกรรม WEBASSEMBLY (16 โมดูล)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[ ภาคที่ 1: รากฐานสถาปัตยกรรม ]   [ ภาคที่ 2: กลไกและคำสั่ง ]     [ ภาคที่ 3: หน่วยความจำและตาราง ]
• 00: ปรัชญาและรากฐาน Wasm       • 03: ระบบประเภทข้อมูลและ LEB128 • 06: แบบจำลองหน่วยความจำเชิงเส้น
• 01: เครื่องจักรแบบสแตก        • 04: ชุดคำสั่งและรหัส Opcode    • 07: ฟังก์ชันพอยน์เตอร์และ Tables
• 02: โครงสร้าง Binary Format   • 05: การควบคุมการไหลและบล็อก   
    │                               │                               │
    └───────────────────────────────┼───────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
[ ภาคที่ 4: การเชื่อมต่อและ Toolchain ]                 [ ภาคที่ 5: โครงการประยุกต์ใช้งานจริง ]
• 08: การทำงานร่วมกับ JavaScript                         • 12: Wasm ยุคใหม่ (SIMD / WASI / Threads)
• 09: Bare-Metal Clang (< 1 KB Wasm)                    • 13: Sieve of Eratosthenes (Pure WAT)
• 10: สร้าง Sovereign Wasm Emitter ในภาษา C             • 14: Mandelbrot Explorer (Canvas Zero-Copy)
• 11: การตรวจสอบความถูกต้องและการดีบัก WABT             • 15: Wasm Image Studio (ฟิลเตอร์/Double-Buffer)
```

---

## 📑 สารบัญครบทั้ง 16 บท (ฉบับสองภาษา)

| บทที่ | หัวข้อ | ฉบับภาษาไทย | English Guide | ตัวอย่างโค้ดและชุดทดสอบ |
| :---: | :--- | :--- | :--- | :--- |
| **00** | ปรัชญาและรากฐานของ WebAssembly | [00-introduction.md](th/00-introduction.md) | [00-introduction.md](en/00-introduction.md) | — |
| **01** | สถาปัตยกรรมแกนกลางและเครื่องกลสแตก | [01-core-architecture.md](th/01-core-architecture.md) | [01-core-architecture.md](en/01-core-architecture.md) | Stack state traces |
| **02** | โครงสร้าง Binary Format และ Sections | [02-binary-format.md](th/02-binary-format.md) | [02-binary-format.md](en/02-binary-format.md) | [`wasm-dump.js`](th/examples/wasm-dump.js) |
| **03** | ระบบประเภทข้อมูลและการเข้ารหัส LEB128 | [03-types-leb128.md](th/03-types-leb128.md) | [03-types-leb128.md](en/03-types-leb128.md) | [`leb128.c`](th/examples/leb128.c) |
| **04** | ชุดคำสั่งและการประมวลผล (Opcodes) | [04-instruction-set.md](th/04-instruction-set.md) | [04-instruction-set.md](en/04-instruction-set.md) | [`opcode-test.js`](th/examples/opcode-test.js) (80 tests) |
| **05** | การควบคุมการไหลและโครงสร้างบล็อก | [05-control-flow.md](th/05-control-flow.md) | [05-control-flow.md](en/05-control-flow.md) | [`control-flow-test.js`](th/examples/control-flow-test.js) |
| **06** | แบบจำลองหน่วยความจำเชิงเส้น (Pages) | [06-linear-memory.md](th/06-linear-memory.md) | [06-linear-memory.md](en/06-linear-memory.md) | [`memory-test.js`](th/examples/memory-test.js) |
| **07** | ฟังก์ชันพอยน์เตอร์และตารางทางอ้อม | [07-tables-indirect-call.md](th/07-tables-indirect-call.md) | [07-tables-indirect-call.md](en/07-tables-indirect-call.md) | [`table-test.js`](th/examples/table-test.js) |
| **08** | การทำงานร่วมกับ JavaScript และเบราว์เซอร์ | [08-js-integration.md](th/08-js-integration.md) | [08-js-integration.md](en/08-js-integration.md) | [`js-bridge-test.js`](th/examples/js-bridge-test.js) |
| **09** | คอมไพล์ C สู่ Wasm ด้วย Clang (ไม่ใช้ Emscripten) | [09-clang-bare-metal.md](th/09-clang-bare-metal.md) | [09-clang-bare-metal.md](en/09-clang-bare-metal.md) | [`bare-metal.c`](th/examples/bare-metal.c) (711 B) |
| **10** | การสร้าง Sovereign Wasm Emitter ด้วยตนเอง | [10-sovereign-emitter.md](th/10-sovereign-emitter.md) | [10-sovereign-emitter.md](en/10-sovereign-emitter.md) | [`sld-emitter-test.js`](th/examples/sld-emitter-test.js) |
| **11** | การตรวจสอบความถูกต้องและการดีบัก (WABT) | [11-validation-debugging.md](th/11-validation-debugging.md) | [11-validation-debugging.md](en/11-validation-debugging.md) | [`validation-debug-test.js`](th/examples/validation-debug-test.js) |
| **12** | Wasm ยุคใหม่ (SIMD, WASI, Threads) | [12-modern-wasm.md](th/12-modern-wasm.md) | [12-modern-wasm.md](en/12-modern-wasm.md) | [`modern-wasm-test.js`](th/examples/modern-wasm-test.js) |
| **13** | โปรแกรมตัวอย่าง 1: Sieve of Eratosthenes | [13-example-sieve.md](th/13-example-sieve.md) | [13-example-sieve.md](en/13-example-sieve.md) | [`sieve.wat`](th/examples/sieve.wat), [`sieve-test.js`](th/examples/sieve-test.js) |
| **14** | โปรแกรมตัวอย่าง 2: Mandelbrot Explorer | [14-example-mandelbrot.md](th/14-example-mandelbrot.md) | [14-example-mandelbrot.md](en/14-example-mandelbrot.md) | [`mandelbrot.c`](th/examples/mandelbrot.c), [`mandelbrot.html`](th/examples/mandelbrot.html) |
| **15** | โปรแกรมตัวอย่าง 3: Wasm Image Studio | [15-example-image-studio.md](th/15-example-image-studio.md) | [15-example-image-studio.md](en/15-example-image-studio.md) | [`imgproc.c`](th/examples/imgproc.c), [`imgproc.html`](th/examples/imgproc.html) |

---

## 🧪 การทดสอบและรันตัวอย่างโปรแกรม

ทุกบทเรียนมาพร้อมชุดทดสอบและตัวอย่างโปรแกรมจริงที่สามารถรันผ่าน Node.js (V8) และเว็บเบราว์เซอร์ได้ทันที:

```bash
# ทดสอบ Opcode ครบ 80 เคส
node th/examples/opcode-test.js

# ทดสอบพฤติกรรม Linear Memory และ Bump Allocator
node th/examples/memory-test.js

# ทดสอบ Structured Control Flow และ State-Machine Dispatcher
node th/examples/control-flow-test.js

# ทดสอบ Benchmark การเชื่อมต่อ JavaScript Bridge 1,000,000 ครั้ง
node th/examples/js-bridge-test.js

# ทดสอบคำนวณจำนวนเฉพาะ Sieve of Eratosthenes (Pure WAT)
node th/examples/sieve-test.js
```

---

## 📚 แหล่งข้อมูลอ้างอิงระดับทางการ

1. **W3C WebAssembly Core Specification (Version 2.0 Draft / 1.0 Final):**  
   [https://webassembly.github.io/spec/core/](https://webassembly.github.io/spec/core/)
2. **MDN WebAssembly Reference & Guides:**  
   [https://developer.mozilla.org/en-US/docs/WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)
3. **WebAssembly Official Site:**  
   [https://webassembly.org/](https://webassembly.org/)
4. **WABT (WebAssembly Binary Toolkit):**  
   [https://github.com/WebAssembly/wabt](https://github.com/WebAssembly/wabt)

---

## 📄 สัญญาอนุญาต (License)

สงวนลิขสิทธิ์ © 2026 โดย **วิโรจน์ ชูแก้ว ([`chin6700x`](https://github.com/chin6700x))**

โครงการนี้เผยแพร่ภายใต้สัญญาอนุญาตแบบคู่ (Dual License):
* **Apache License, Version 2.0** ([LICENSE](LICENSE) หรือ http://www.apache.org/licenses/LICENSE-2.0)
* **MIT License** ([LICENSE](LICENSE) หรือ http://opensource.org/licenses/MIT)

ตามแต่คุณจะเลือกใช้
