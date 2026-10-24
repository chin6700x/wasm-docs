# ⚡ The Definitive WebAssembly Engineering & Sovereign Implementation Guide
## W3C Core Specification, Binary Bytecode Internals, and Clean-Room C Compiler Emitter Construction

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x))  
> **Repository:** [`wasm-docs`](https://github.com/chin6700x/wasm-docs)  
> **License:** [Apache-2.0 / MIT](LICENSE) © 2026  
> **Standards Reference:** [W3C WebAssembly Core Specification](https://webassembly.github.io/spec/core/) • [MDN WebAssembly Guides](https://developer.mozilla.org/en-US/docs/WebAssembly)  
> **Available Languages:** [English](README.md) | [ภาษาไทย](th.README.md)

---

## 🎯 Mission & Philosophy

This engineering guide is designed for systems engineers, compiler creators, and performance-critical runtime developers who seek a foundational, first-principles understanding of **WebAssembly (WASM)**.

Rather than treating WebAssembly as a black-box compilation target of heavyweight toolchains (like Emscripten or bloated LLVM configurations), this guide illuminates:
* **The Raw Binary Bytecode Layer:** Byte-by-byte structure, Section IDs, payload lengths, and LEB128 variable-length integer encodings.
* **The Stack Machine Architecture:** Stack transitions, type checking, polymorphic stack frames, and structured control flow (`block`, `loop`, `if`, `br_table`).
* **Hardware-Adjacent Linear Memory:** Dynamic page growth (`64 KB`), Little-Endian scalar layouts, bump allocators, and zero-copy JavaScript TypedArray interop.
* **Sovereign Clean-Room Implementation:** Crafting a complete WebAssembly bytecode generator (Wasm Emitter) from scratch in pure C, compiling real-world source files to valid WASM modules in under 20 milliseconds.
* **Empirical Validation:** 100% verified test cases across modern browser engines (V8, JavaScriptCore, SpiderMonkey) and WABT toolchains.

---

## 🗺️ Curriculum Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│             THE DEFINITIVE WEBASSEMBLY ENGINEERING GUIDE (16 MODULES)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[ Part I: Foundations ]     [ Part II: Core Machine ]   [ Part III: Memory & Tables ]
• 00: Introduction & Philosophy • 03: Types & LEB128 Encoding   • 06: Linear Memory & Pages
• 01: Core Stack Architecture   • 04: Instruction Set & Opcodes • 07: Tables & Dynamic Dispatch
• 02: W3C Binary Format         • 05: Structured Control Flow   
    │                               │                               │
    └───────────────────────────────┼───────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
[ Part IV: Toolchains & Emitter ]                       [ Part V: Production Applications ]
• 08: JavaScript & Web API Bridge                       • 12: Modern Wasm (SIMD / WASI)
• 09: Bare-Metal Clang (Sub-1KB Wasm)                   • 13: Sieve of Eratosthenes (WAT)
• 10: Sovereign C Wasm Emitter (Clean-Room)             • 14: Mandelbrot Explorer (Canvas)
• 11: Validation, WABT & Debugging                      • 15: Wasm Image Studio (Filters/Double-Buf)
```

---

## 📑 Complete Bilingual Table of Contents

| Chapter | Topic | English Guide | Thai Guide | Verified Examples |
| :---: | :--- | :--- | :--- | :--- |
| **00** | Introduction & Philosophy | [00-introduction.md](en/00-introduction.md) | [00-introduction.md](th/00-introduction.md) | — |
| **01** | Core Architecture & Stack Machine | [01-core-architecture.md](en/01-core-architecture.md) | [01-core-architecture.md](th/01-core-architecture.md) | Stack state traces |
| **02** | W3C Binary Format & Sections | [02-binary-format.md](en/02-binary-format.md) | [02-binary-format.md](th/02-binary-format.md) | [`wasm-dump.js`](th/examples/wasm-dump.js) |
| **03** | Type System & LEB128 Encoding | [03-types-leb128.md](en/03-types-leb128.md) | [03-types-leb128.md](th/03-types-leb128.md) | [`leb128.c`](th/examples/leb128.c) |
| **04** | Instruction Set & Opcode Reference | [04-instruction-set.md](en/04-instruction-set.md) | [04-instruction-set.md](th/04-instruction-set.md) | [`opcode-test.js`](th/examples/opcode-test.js) (80 tests) |
| **05** | Structured Control Flow & CFG | [05-control-flow.md](en/05-control-flow.md) | [05-control-flow.md](th/05-control-flow.md) | [`control-flow-test.js`](th/examples/control-flow-test.js) |
| **06** | Linear Memory & Page Architecture | [06-linear-memory.md](en/06-linear-memory.md) | [06-linear-memory.md](th/06-linear-memory.md) | [`memory-test.js`](th/examples/memory-test.js) |
| **07** | Tables & Indirect Call Dispatch | [07-tables-indirect-call.md](en/07-tables-indirect-call.md) | [07-tables-indirect-call.md](th/07-tables-indirect-call.md) | [`table-test.js`](th/examples/table-test.js) |
| **08** | JavaScript & Web API Integration | [08-js-integration.md](en/08-js-integration.md) | [08-js-integration.md](th/08-js-integration.md) | [`js-bridge-test.js`](th/examples/js-bridge-test.js) |
| **09** | Bare-Metal Clang Without Emscripten | [09-clang-bare-metal.md](en/09-clang-bare-metal.md) | [09-clang-bare-metal.md](th/09-clang-bare-metal.md) | [`bare-metal.c`](th/examples/bare-metal.c) (711 B) |
| **10** | Sovereign C Wasm Emitter | [10-sovereign-emitter.md](en/10-sovereign-emitter.md) | [10-sovereign-emitter.md](th/10-sovereign-emitter.md) | [`sld-emitter-test.js`](th/examples/sld-emitter-test.js) |
| **11** | Validation, WABT & DevTools | [11-validation-debugging.md](en/11-validation-debugging.md) | [11-validation-debugging.md](th/11-validation-debugging.md) | [`validation-debug-test.js`](th/examples/validation-debug-test.js) |
| **12** | Modern Wasm: SIMD, WASI & Threads | [12-modern-wasm.md](en/12-modern-wasm.md) | [12-modern-wasm.md](th/12-modern-wasm.md) | [`modern-wasm-test.js`](th/examples/modern-wasm-test.js) |
| **13** | Practical App 1: Sieve of Eratosthenes | [13-example-sieve.md](en/13-example-sieve.md) | [13-example-sieve.md](th/13-example-sieve.md) | [`sieve.wat`](th/examples/sieve.wat), [`sieve-test.js`](th/examples/sieve-test.js) |
| **14** | Practical App 2: Mandelbrot Explorer | [14-example-mandelbrot.md](en/14-example-mandelbrot.md) | [14-example-mandelbrot.md](th/14-example-mandelbrot.md) | [`mandelbrot.c`](th/examples/mandelbrot.c), [`mandelbrot.html`](th/examples/mandelbrot.html) |
| **15** | Practical App 3: Wasm Image Studio | [15-example-image-studio.md](en/15-example-image-studio.md) | [15-example-image-studio.md](th/15-example-image-studio.md) | [`imgproc.c`](th/examples/imgproc.c), [`imgproc.html`](th/examples/imgproc.html) |

---

## 🧪 Interactive Test Suite

All chapters are accompanied by standalone test scripts and live browser implementations verified on V8 (Node.js) and WebKit/Blink browsers:

```bash
# Run opcode verification suite (80 unit tests)
node th/examples/opcode-test.js

# Run memory semantics and bump allocator suite
node th/examples/memory-test.js

# Run structured control flow suite
node th/examples/control-flow-test.js

# Run JS bridge benchmark (1,000,000 roundtrips)
node th/examples/js-bridge-test.js

# Run Sieve of Eratosthenes prime test
node th/examples/sieve-test.js
```

---

## 📚 Official Specifications & References

1. **W3C WebAssembly Core Specification (Version 2.0 Draft / 1.0 Final):**  
   [https://webassembly.github.io/spec/core/](https://webassembly.github.io/spec/core/)
2. **MDN WebAssembly Reference & Guides:**  
   [https://developer.mozilla.org/en-US/docs/WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)
3. **WebAssembly Official Site:**  
   [https://webassembly.org/](https://webassembly.org/)
4. **WABT (WebAssembly Binary Toolkit):**  
   [https://github.com/WebAssembly/wabt](https://github.com/WebAssembly/wabt)

---

## 📄 License & Attribution

Copyright © 2026 **Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x))**.  
All rights reserved.

This project is dual-licensed under either:
* **Apache License, Version 2.0** ([LICENSE](LICENSE) or http://www.apache.org/licenses/LICENSE-2.0)
* **MIT License** ([LICENSE](LICENSE) or http://opensource.org/licenses/MIT)

at your option.
