# ⚡ The Definitive WebAssembly Engineering & Sovereign Implementation Guide
## W3C Core Specification, Binary Bytecode Internals, and Clean-Room C Emitter Construction

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x))  
> **Documentation License:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)  
> **Source Code License:** [Apache-2.0 / MIT](../LICENSE) © 2026  
> **Standards Reference:** [W3C WebAssembly Core Specification](https://webassembly.github.io/spec/core/) • [MDN WebAssembly Documentation](https://developer.mozilla.org/en-US/docs/WebAssembly)  
> **Languages:** [English](README.md) | [ภาษาไทย](../th/README.md)

---

## 🎯 Purpose & Mission

This engineering guide is created to give software engineers, runtime architects, and compiler developers a profound, first-principles understanding of **WebAssembly (WASM)**.

Rather than viewing WebAssembly merely as an opaque compilation output of massive multi-gigabyte toolchains (such as Emscripten or bloated LLVM bundles), this curriculum deconstructs:
1. **Raw Binary Bytecode Architecture:** Magic numbers, Section IDs, payload lengths, and LEB128 variable-length integer encodings.
2. **Stack Machine Virtual Architecture:** Operand stack transitions, polymorphic frames, validation typing rules, and structured control flow (`block`, `loop`, `if`, `br_table`).
3. **Hardware-Adjacent Linear Memory:** Dynamic page allocation (64 KB pages), Little-Endian byte addressing, minimal bump allocators, and zero-copy TypedArray bridging.
4. **Clean-Room Sovereign C Implementation:** Building a complete standalone WebAssembly code generator (Wasm Emitter) in pure C from scratch, compiling real-world source files to valid WASM modules in under 20 milliseconds.
5. **Practical Production Projects:** Pure WAT Sieve of Eratosthenes, Zero-Copy Mandelbrot Canvas rendering, and double-buffered image processing studio.

---

## 📑 Detailed Curriculum & Table of Contents

### 📌 [Chapter 00: Philosophy and Foundations of WebAssembly](00-introduction.md)
* 0.1 Why WebAssembly? The limits and JIT warmup overhead of JavaScript in high-performance tasks.
* 0.2 The W3C Open Standard and the Four Tenets: Fast, Safe, Portable, Compact.
* 0.3 The Wasm Ecosystem: From client-side browsers to serverless micro-sandboxes and edge systems (WASI).

---

### 🏛️ [Chapter 01: Core Architecture & The Stack Machine](01-core-architecture.md)
* 1.1 Stack-based Virtual Machine architecture vs Register-based VM designs.
* 1.2 The Four Pillars of a Wasm Module:
  * 1.2.1 **Functions:** Computation and execution units.
  * 1.2.2 **Linear Memory:** Raw contiguous byte array addressable by scalar offsets.
  * 1.2.3 **Tables:** Safe reference tables for function pointers and dynamic dispatch.
  * 1.2.4 **Globals:** Module-scoped state variables (mutable and immutable).
* 1.3 The WebAssembly Lifecycle: Module Definition $\rightarrow$ Instantiation $\rightarrow$ Instance Execution.

---

### 💾 [Chapter 02: W3C Binary Format & Section Architecture](02-binary-format.md)
* 2.1 The Magic Header (`\0asm`) and Version Field (the foundational 8-byte preamble).
* 2.2 Section Structure: Section ID byte followed by ULEB128 Payload Size.
* 2.3 The Complete Taxonomy of W3C Sections (ID 0 to 12):
  * **Section 0 (Custom Section):** Debugging symbols, source maps, and name metadata (`name`, `sourceMappingURL`).
  * **Section 1 (Type Section):** Function signatures (parameter and return types) across the module.
  * **Section 2 (Import Section):** External functions, memories, tables, or globals required from host.
  * **Section 3 (Function Section):** Mapping between internal Function Indices and Type Indices.
  * **Section 4 (Table Section):** Table declarations for indirect call dispatch.
  * **Section 5 (Memory Section):** Linear memory limits and page size declarations.
  * **Section 6 (Global Section):** Global variable declarations and initialization expressions.
  * **Section 7 (Export Section):** Symbols exposed to JavaScript and host runtimes.
  * **Section 8 (Start Section):** Optional auto-executing initialization function.
  * **Section 9 (Element Section):** Initializers for table slots.
  * **Section 10 (Code Section):** Local variable definitions and bytecode instructions for each function.
  * **Section 11 (Data Section):** Static byte payloads (strings, lookup tables) loaded into linear memory.
  * **Section 12 (Data Count Section):** Total segment count for bulk memory operations.

---

### 🔢 [Chapter 03: Type System & LEB128 Variable-Length Encoding](03-types-leb128.md)
* 3.1 Primitive Value Types in Wasm Core:
  * `i32` (`0x7F`), `i64` (`0x7E`), `f32` (`0x7D`), `f64` (`0x7C`).
* 3.2 Reference Types: `funcref` (`0x70`), `externref` (`0x6F`).
* 3.3 Vector Type (128-bit SIMD): `v128` (`0x7B`).
* 3.4 Deep Dive into **LEB128 (Little Endian Base 128)**:
  * 3.4.1 **Unsigned LEB128 (ULEB128):** Used for indices and section lengths.
  * 3.4.2 **Signed LEB128 (SLEB128):** Used for signed immediate constants.
  * 3.4.3 Pure C implementation of ultra-fast ULEB128/SLEB128 encoder and decoder.

---

### ⚙️ [Chapter 04: Instruction Set & Opcode Reference](04-instruction-set.md)
* 4.1 Constant Instructions: `i32.const` (`0x41`), `i64.const` (`0x42`), `f32.const`, `f64.const`.
* 4.2 Local & Global Variable Instructions:
  * `local.get` (`0x20`), `local.set` (`0x21`), `local.tee` (`0x22`).
  * `global.get` (`0x23`), `global.set` (`0x24`).
* 4.3 Arithmetic and Bitwise Instructions:
  * Arithmetic: `add`, `sub`, `mul`, `div_s`, `div_u`, `rem_s`, `rem_u`.
  * Bitwise: `and`, `or`, `xor`, `shl`, `shr_s`, `shr_u`, `rotl`, `rotr`.
  * Comparisons: `eq`, `ne`, `lt_s`, `le_s`, `gt_s`, `ge_s`, `eqz`.
* 4.4 Type Conversions & Casting:
  * Wrapping, extending, truncating, and promoting across scalar widths.
* 4.5 Parametric Stack Operations: `drop` (`0x1A`), `select` (`0x1B`).

---

### 🔀 [Chapter 05: Structured Control Flow & Validation](05-control-flow.md)
* 5.1 Why WebAssembly forbids arbitrary jumps (`goto`): Deterministic formal verification.
* 5.2 Structured Control Flow Blocks:
  * `block` (`0x02`), `loop` (`0x03`), `if` (`0x04`), `else` (`0x05`), `end` (`0x0B`).
* 5.3 Relative Branching by Label Depth (`br` `0x0C`, `br_if` `0x0D`, `br_table` `0x0E`):
  * Branching out of a `block` (Exit) vs branching to a `loop` (Continue).
* 5.4 Reconstructing Arbitrary C Control Flow Graphs (CFGs):
  * State-machine dispatch loops with program counter (`pc`) registers.
* 5.5 Stack Polymorphism and Unreachable States:
  * Managing validation invariants after `unreachable` (`0x00`) and `return` (`0x0F`).

---

### 🧠 [Chapter 06: Linear Memory Model & Page Architecture](06-linear-memory.md)
* 6.1 Linear Memory Architecture: Unsegmented byte arrays.
* 6.2 The Memory Page Standard: 1 Page = 65,536 Bytes = 64 KB fixed size.
* 6.3 Memory Load & Store Instructions:
  * `i32.load`, `i64.load`, `f32.load`, `f64.load`.
  * `i32.store`, `i64.store`, `f32.store`, `f64.store`.
  * Sub-width operations: `load8_s`, `load8_u`, `load16_s`, `store8`, `store16`.
* 6.4 Memory Immediate Fields: Alignment exponent and dynamic base offset.
* 6.5 Dynamic Runtime Growth: `memory.size` (`0x3F`) and `memory.grow` (`0x40`).
* 6.6 Building a Minimal Heap Bump Allocator inside raw WebAssembly.

---

### 📇 [Chapter 07: Tables & Indirect Call Dispatch](07-tables-indirect-call.md)
* 7.1 Function pointers in a type-safe sandbox.
* 7.2 The Table Section and Element Section.
* 7.3 Executing function pointers via `call_indirect` (`0x11`).
* 7.4 Implementing Virtual Method Tables (VTABLEs), dynamic dispatch, and polymorphism in C on Wasm.

---

### 🌐 [Chapter 08: JavaScript & Web API Integration](08-js-integration.md)
* 8.1 The WebAssembly JavaScript API:
  * `WebAssembly.instantiate()` and `WebAssembly.instantiateStreaming()`.
  * `WebAssembly.Memory` buffer inspection via `Uint8Array` and `Int32Array`.
* 8.2 Data Marshaling between JavaScript $\leftrightarrow$ WebAssembly:
  * Passing scalars, allocating buffers in Wasm heap, copying UTF-8 strings.
  * Reading return strings via `TextDecoder`.
  * Building sovereign `ccall()` and `cwrap()` wrappers without Emscripten runtime.
* 8.3 Importing Host Functions into Wasm:
  * Binding `console.log`, `performance.now()`, and DOM manipulation callbacks.

---

### 🛠️ [Chapter 09: Bare-Metal Clang Without Emscripten](09-clang-bare-metal.md)
* 9.1 Contrasting `emcc` with `clang --target=wasm32`.
* 9.2 Direct compilation with LLVM `wasm-ld`:
  * Core flags: `-nostdlib`, `-Wl,--no-entry`, `-Wl,--export-all`, `-Wl,--allow-undefined`.
* 9.3 Navigating Libc-less environments and writing replacement runtime routines.
* 9.4 Walkthrough: Producing verified, self-contained WASM binaries smaller than 1 KB (711 bytes).

---

### 🚀 [Chapter 10: Sovereign C Wasm Emitter (Clean-Room Compiler)](10-sovereign-emitter.md)
* 10.1 Anatomy of [`sld_wasm.c`](https://github.com/chin6700x/sld-compiler):
  * Dynamic byte buffer management (`wasm_buf_t`).
  * Single-pass section generator pipeline.
* 10.2 Translating Compiler Micro-IR directly to Wasm byte streams.
* 10.3 Automatic Base64 Data URI packaging and Universal JS Bridge emission.
* 10.4 Case Study: Compiling a 13-file systems codebase into valid Wasm in 20 milliseconds.

---

### 🔍 [Chapter 11: Validation, WABT Toolchain & Debugging](11-validation-debugging.md)
* 11.1 Rejection criteria enforced by V8, SpiderMonkey, and JavaScriptCore.
* 11.2 Essential tools from the WebAssembly Binary Toolkit (WABT):
  * `wat2wasm`, `wasm2wat`, `wasm-validate`, `wasm-objdump`.
* 11.3 Interactive debugging in Chrome DevTools and Safari Web Inspector:
  * Breakpoints in Wasm bytecode and live linear memory inspection.

---

### 🔮 [Chapter 12: Modern Wasm: SIMD, WASI, Threads & Component Model](12-modern-wasm.md)
* 12.1 128-bit Fixed-Width SIMD (`v128`) for computational math and image processing.
* 12.2 Multi-threading via SharedArrayBuffer and atomic memory operations (`atomics`).
* 12.3 WASI (WebAssembly System Interface): Executing Wasm as native OS binaries.
* 12.4 Wasm GC (Garbage Collection Proposal) for managed language compilation.
* 12.5 The WebAssembly Component Model: The next era of cross-language composability.

---

### 🧪 [Chapter 13: Practical App 1 — Sieve of Eratosthenes (Pure WAT)](13-example-sieve.md)
* 13.1 Requirements and exported API (`sieve`, `is_prime`, `memory`).
* 13.2 Memory layout: 1 byte per candidate integer and boundary checking.
* 13.3 Implementation in WebAssembly Text Format (WAT): `memory.fill`, nested loops, and `br_if`.
* 13.4 Assembly with `wat2wasm` and validation (233-byte binary).
* 13.5 JavaScript integration and bitmap memory readout.

---

### 🎨 [Chapter 14: Practical App 2 — Mandelbrot Explorer (Canvas Zero-Copy)](14-example-mandelbrot.md)
* 14.1 Objective: Wasm computes complex pixels, JavaScript blits to `<canvas>` via zero-copy `ImageData`.
* 14.2 Complex iteration algorithm $z_{n+1} = z_n^2 + c$.
* 14.3 Bare-metal C implementation without libc and Little-Endian RGBA pixel packing.
* 14.4 Compilation to a 945-byte binary with `clang --target=wasm32`.
* 14.5 Interactive UI: Smooth click-to-zoom and iteration tuning.

---

### 🖼️ [Chapter 15: Practical App 3 — Wasm Image Studio (Filters & Double-Buffering)](15-example-image-studio.md)
* 15.1 Architectural overview: Rotation, flipping, cropping, resizing, and 3×3 convolution filters.
* 15.2 Double-buffered memory design and atomic `commit()` operations.
* 15.3 Mathematical algorithms: Inverse coordinate mapping, bilinear interpolation, and trigonometry without `libm`.
* 15.4 Bare-metal C compilation (8.5 KB binary).
* 15.5 Web UI integration: Drag-to-crop, undo buffer, and real-time filter previews.

---

## 📚 Official References

1. **W3C WebAssembly Core Specification:** https://webassembly.github.io/spec/core/
2. **MDN WebAssembly Reference:** https://developer.mozilla.org/en-US/docs/WebAssembly
3. **WebAssembly Official Site:** https://webassembly.org/
4. **WABT (WebAssembly Binary Toolkit):** https://github.com/WebAssembly/wabt
