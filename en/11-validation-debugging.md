# Chapter 11: Validation, Tools, and Debugging (Validation, Tools & Debugging)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [W3C WebAssembly Validation Spec](https://webassembly.github.io/spec/core/valid/index.html) • [WABT: WebAssembly Binary Toolkit](https://github.com/WebAssembly/wabt) • [Chrome DevTools WebAssembly Debugging](https://developer.chrome.com/docs/devtools/wasm)

[⬅ Chapter 10](10-sovereign-emitter.md) | [Table of Contents](README.md) | [Chapter 12 ➡](12-modern-wasm.md)

> [!NOTE]
> All validation failure assertions, WABT toolchain integrations (`wat2wasm`, `wasm2wat`, `wasm-validate`, `wasm-objdump`), and programmatic debugging techniques discussed in this chapter are runnable live in [examples/validation-debug-test.js](examples/validation-debug-test.js).

---

## 11.1 The Engine Rejection Algorithm (V8, SpiderMonkey, JavaScriptCore)

Before any browser or standalone runtime executes a WebAssembly binary, it subjects the stream to a **linear Single-Pass Validation Algorithm**. If even a single byte or stack invariant is violated, the engine aborts execution immediately, throwing a **`WebAssembly.CompileError`** to ensure sandbox isolation and hardware memory integrity.

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
|                        (Malformed Structure)          (Stack/Type Rule Invariant) |
+-----------------------------------------------------------------------------------+
```

### The 7 Most Common Engine Rejection Invariants:

#### 1. Magic Word & Binary Version Mismatch
The first 4 bytes must match `\0asm` (`0x00 0x61 0x73 0x6D`), and the following 4 bytes must be Version 1 (`0x01 0x00 0x00 0x00`).
- **V8 Diagnostic:** `CompileError: WebAssembly.Module(): expected magic word 00 61 73 6d, found ...`

#### 2. Section Ordering Violation
Standard known sections (IDs 1 to 12) **must strictly appear in ascending numerical order** (except Custom Section ID 0, which may appear anywhere). If present, DataCount Section (ID 12) must precede Code Section (ID 10).
- **V8 Diagnostic:** `CompileError: WebAssembly.Module(): unexpected section <id> @+offset`

#### 3. Invalid Local Index
Occurs when an emitter references `local.get $idx` or `local.set $idx` where `$idx \ge (\text{param\_count} + \text{declared\_locals})`.
- **V8 Diagnostic:** `CompileError: Compiling function #0 failed: invalid local index: 25 @+offset`
- **WABT Diagnostic:** `error: local variable out of range (max N)`

#### 4. Stack Underflow
Occurs when an opcode expects operands on the stack (e.g., `i32.add` requires 2 items), but the current operand stack height contains fewer values.
- **V8 Diagnostic:** `CompileError: Compiling function #0 failed: not enough arguments on the stack for i32.add (need 2, got 0)`

#### 5. Type Consistency Violation
Occurs when the operand type on the stack fails to match the expected type signature (e.g., function returns `i32`, but operand stack holds `f32` upon reaching `end`).
- **V8 Diagnostic:** `CompileError: type mismatch in function result, expected i32, got f32`

#### 6. Branch Stack Height & Polymorphism Mismatch
Branching with `br` or `br_if` to a label expecting result operands when the stack does not contain matching types or sufficient elements.
- **V8 Diagnostic:** `CompileError: expected 1 elements on the stack for branch, found 0`

#### 7. Memory Alignment Exponent Overflow ($2^{\text{align}} > \text{natural width}$)
The immediate `align` parameter on memory load/store instructions is encoded as an exponent of 2. Exceeding the natural width of the data type (e.g., `i32.load` has a natural width of 4 bytes ($2^2$), but encoding `align = 3` ($2^3 = 8$ bytes)) triggers immediate validation failure.
- **V8 Diagnostic:** `CompileError: invalid alignment; expected maximum alignment is 2, actual alignment is 3`

---

## 11.2 Essential Tooling: WebAssembly Binary Toolkit (WABT)

**WABT (pronounced "wabt-tee")** is the official reference suite from the W3C WebAssembly Community Group for inspecting, converting, and validating Wasm binaries:

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
|                     (100% Spec Conformance)                  (Header & Hex) (C-like Decompile)
+---------------------------------------------------------------------------------+
```

### 1. `wat2wasm` — Assembling Text to Binary
Compiles `.wat` files into `.wasm` binaries with validation options:
```bash
# Standard compilation
wat2wasm module.wat -o module.wasm

# Preserve function and variable names for debugging (Custom Name Section)
wat2wasm module.wat --debug-names -o module.wasm

# Enable modern proposal flags (SIMD, Threads, Multi-memory)
wat2wasm module.wat --enable-all -o module.wasm
```

### 2. `wasm2wat` — Disassembling Binary to Clean Text
Decompiles `.wasm` binaries back into human-readable WAT format:
```bash
# Decompile binary to standard WAT
wasm2wat module.wasm -o module.wat

# Fold expressions into idiomatic nested S-expressions
wasm2wat module.wasm --fold-exprs -o readable.wat
```

### 3. `wasm-validate` — Strict 100% W3C Spec Validation
The ultimate arbiter for compiler developers. If a binary passes `wasm-validate`, it conforms to the formal W3C specification and will execute across all compliant runtimes:
```bash
wasm-validate module.wasm
```
*If compliant: exits silently with return code 0.*  
*If non-compliant: provides exact byte offset and comprehensive error description:*
```
module.wasm:000001a: error: local variable out of range (max 0)
```

### 4. `wasm-objdump` — Inspecting Headers, Sections, and Disassembly
Analogous to `objdump` on Unix/Linux systems:
```bash
# Summarize section headers (type, offset, payload size, count)
wasm-objdump -h module.wasm

# Dump all section headers and detailed metadata entries
wasm-objdump -x module.wasm

# Disassemble bytecode interleaved with raw hexadecimal bytes
wasm-objdump -d module.wasm
```

### 5. `wasm-decompile` — High-Level C-like Decompilation
Transforms low-level stack bytecode into pseudo-C statements to rapidly comprehend algorithmic flow:
```bash
wasm-decompile module.wasm -o module.dcmp
```

---

## 11.3 WebAssembly Debugging in Chrome DevTools & Safari Web Inspector

Modern browsers feature native, first-class source-level WebAssembly debugging capabilities:

```
+---------------------------------------------------------------------------------+
|                       Chrome DevTools WebAssembly Debugger                      |
+---------------------------------------------------------------------------------+
| Sources Tab:                                                                    |
|  wasm://wasm/3a5e8b2c/ (Decompiled on-the-fly)                                  |
|  ─────────────────────────────────────────────────────────────────────────────  |
|  1  (module                                                                     |
|  2    (func $add (param $p0 i32) (param $p1 i32) (result i32)                   |
|  3  ●   local.get $p0         ◄── [ Live Breakpoint Paused Here ]                |
|  4      local.get $p1                                                           |
|  5      i32.add                                                                 |
|  6      return)                                                                 |
|  ─────────────────────────────────────────────────────────────────────────────  |
|  Scope Panel:                   Call Stack:             Memory Inspector:       |
|    $p0: 15                        $add (line 3)           0x0000: 78 56 34 12   |
|    $p1: 27                        (anonymous)             0x0004: FE 00 00 00   |
+---------------------------------------------------------------------------------+
```

### 1. Setting Breakpoints in Bytecode
1. Open **Chrome DevTools** (`F12` or `Cmd + Option + I`).
2. Navigate to the **Sources** tab.
3. Locate the yellow **`wasm://`** origin directory in the navigation pane.
4. Open the module; DevTools automatically disassembles raw bytecode into WAT text on the fly.
5. Click line numbers to set **Breakpoints**.
6. Execution halts at breakpoints, enabling step-debugging (`F10` step-over, `F11` step-into) while observing live changes to operand stack states and local variables.

### 2. Live Inspection via Memory Inspector Tab
1. In the right-hand **Scope** pane, locate the **`memory`** export or associated `TypedArray` buffer.
2. Click the **Inspect Memory icon** (magnifying glass with table grid) adjacent to the variable.
3. Chrome opens the dedicated **Memory Inspector**:
   - Displays live interactive **Hex Dumps** alongside ASCII previews.
   - Allows toggling interpretations between 8-bit, 16-bit, 32-bit (Signed/Unsigned/Float).
   - Features address search and jump controls to track heap mutations in real-time.

### 3. Source-Level Debugging via DWARF (`-g`)
When compiling C/C++ with Clang using the **`-g`** flag (accompanied by Chrome's [C/C++ DevTools Support (DWARF) Extension](https://chromewebstore.google.com/detail/cc++-devtools-support-dwa/pdcpmagijalflfakpmioilipagdnacbm)):
- Chrome DevTools maps bytecode directly back to **original C source files (`.c`)**.
- Set breakpoints directly on C lines, evaluate native C structs, and inspect local variables directly within their native lexical scope.

To verify live validation assertions and run the automated test suite, inspect [examples/validation-debug-test.js](examples/validation-debug-test.js).

---

[⬅ Chapter 10: Building a Sovereign WebAssembly Emitter](10-sovereign-emitter.md) | [Main Table of Contents](README.md) | [Chapter 12: Modern WebAssembly & Future Horizons ➡](12-modern-wasm.md)
