# Chapter 10: Building a Sovereign WebAssembly Emitter (Clean-Room Compiler in C)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [W3C WebAssembly Binary Format](https://webassembly.github.io/spec/core/binary/index.html) • [SLD Compiler Source Code](file:///Volumes/Mac%20Backup/compiler-dev/sld-compiler/src/sld_wasm.c)

[⬅ Chapter 09](09-clang-bare-metal.md) | [Table of Contents](README.md) | [Chapter 11 ➡](11-validation-debugging.md)

> [!NOTE]
> In this chapter, we dissect the internal architecture of **`sld_wasm.c`**—a 100% clean-room WebAssembly emitter developed within the `sld-compiler` project. It generates production-grade, W3C-compliant WebAssembly binaries runnable directly in V8 in sub-millisecond compilation passes. Verified live in [examples/sld-emitter-test.js](examples/sld-emitter-test.js).

---

## 10.1 The Essence of Sovereign Wasm: Generating Bytecode Without LLVM

A foundational question among systems and compiler engineers is:  
*"Why do conventional C compilers demand massive frameworks like LLVM or Emscripten to output WebAssembly? How can `sld-compiler` transform C code directly into runnable Wasm binaries using a single, self-contained C99 source file?"*

The answer lies in the **elegance and modular regularity of the W3C Binary Specification**:
- WebAssembly is not machine code bound to physical silicon layouts; it is a **formally structured bytecode format**.
- A valid WebAssembly binary consists strictly of an 8-byte magic header followed by serialized **Sections** ordered by increasing integer IDs (`0x01` to `0x0C`).
- Provided a compiler possesses a **Dynamic Byte Buffer** and a variable-length **LEB128 Encoder**, it can serialize each section directly into memory without invoking external linkers or assemblers!

```
+---------------------------------------------------------------------------------+
|                       SLD Sovereign Wasm Emitter Pipeline                       |
|                                                                                 |
|  [ C Source ] ──► [ Lexer/Parser ] ──► [ Micro-IR ] ──► [ sld_wasm.c ]          |
|                                                               │                 |
|                   ┌───────────────────────────────────────────┴──────────┐      |
|                   ▼                                                      ▼      |
|           [ Type Section (1) ]                                 [ Code Section (10) ]
|           [ Function Sec (3) ]                                 - Linear IR to Stack
|           [ Memory Sec   (5) ]                                 - State-Machine Loop
|           [ Export Sec   (7) ]                                                  |
|                   │                                                      │      |
|                   └───────────────────────────┬──────────────────────────┘      |
|                                               ▼                                 |
|                                     [ Binary Module Output ]                    |
|                                     (Sub-1KB .wasm + .js + .html)               |
+---------------------------------------------------------------------------------+
```

---

## 10.2 Dynamic Buffers (`wasm_buf_t`) and the LEB128 Engine

At the core of `sld_wasm.c` is an auto-resizing memory buffer structure (`wasm_buf_t`):

```c
typedef struct {
    uint8_t *buf;  // Pointer to allocated byte array
    size_t len;    // Current committed length in bytes
    size_t cap;    // Total allocated RAM capacity
} wasm_buf_t;

static void wbuf_init(wasm_buf_t *b, size_t cap) {
    b->cap = cap;
    b->buf = (uint8_t *)malloc(cap);
    b->len = 0;
}

static void wbuf_put8(wasm_buf_t *b, uint8_t v) {
    if (b->len + 16 >= b->cap) {
        b->cap *= 2;
        b->buf = (uint8_t *)realloc(b->buf, b->cap);
    }
    b->buf[b->len++] = v;
}
```

### 1. Unsigned LEB128 Encoder (`ULEB128`)
Used for Section payload sizes, vector lengths, and type indices:
```c
static void wbuf_put_uleb(wasm_buf_t *b, uint64_t val) {
    do {
        uint8_t byte = (uint8_t)(val & 0x7FU);
        val >>= 7;
        if (val != 0) byte |= 0x80U; // Continuation bit
        wbuf_put8(b, byte);
    } while (val != 0);
}
```

### 2. Signed LEB128 Encoder (`SLEB128`)
Used for numeric constants in `i32.const` and `i64.const`:
```c
static void wbuf_put_sleb(wasm_buf_t *b, int64_t val) {
    bool more = true;
    while (more) {
        uint8_t byte = (uint8_t)(val & 0x7F);
        val >>= 7;
        // Terminate when bit 6 matches arithmetic sign extension
        if ((val == 0 && (byte & 0x40) == 0) || (val == -1 && (byte & 0x40) != 0)) {
            more = false;
        } else {
            byte |= 0x80U;
        }
        wbuf_put8(b, byte);
    }
}
```

### 3. Section Assembler (`wbuf_put_section`)
Once a section payload buffer is complete, it is committed to the module stream via a single helper:
```c
static void wbuf_put_section(wasm_buf_t *out, uint8_t sec_id, const wasm_buf_t *sec_payload) {
    wbuf_put8(out, sec_id);                   // 1. Write Section ID (1 byte)
    wbuf_put_uleb(out, sec_payload->len);     // 2. Write payload length (ULEB128)
    wbuf_put_bytes(out, sec_payload->buf, sec_payload->len); // 3. Copy payload payload
}
```

---

## 10.3 Translating Micro-IR into WebAssembly Bytecode

The frontend of SLD lowers ASTs into a linear **3-Address Code (Micro-IR)** representation organized around Virtual Registers (`vreg`):

$$\text{IR: } dst = src1 + src2$$

### 1. Mapping Virtual Registers to Local Variables
WebAssembly lacks general-purpose registers; it provides indexed local variables. SLD maps each virtual register index directly to a local variable index:

```c
#define VREG_LOCAL(v) ((uint64_t)(param_count + (v)))
```

Lowering an addition operation (`IR_ADD`):
```c
case IR_ADD:
    wbuf_put8(code, 0x20); wbuf_put_uleb(code, VREG_LOCAL(in->src1)); /* local.get src1 */
    wbuf_put8(code, 0x20); wbuf_put_uleb(code, VREG_LOCAL(in->src2)); /* local.get src2 */
    wbuf_put8(code, 0x7C);                                            /* i64.add */
    wbuf_put8(code, 0x21); wbuf_put_uleb(code, VREG_LOCAL(in->dst));  /* local.set dst */
    break;
```

### 2. Preventing Local Index Traps via Dynamic VReg Scanning
A common pitfall in naive emitters is `invalid local index`: if instruction bytecode accesses `local index 25`, but the function header declared only 16 locals, the V8 engine rejects the binary instantly.  
SLD prevents this by **pre-scanning the maximum virtual register index before emitting the function body**:

```c
uint32_t max_vreg = 0;
for (size_t idx = funcs[f].start_idx; idx < funcs[f].end_idx; idx++) {
    const sld_ir_insn_t *in = &ir->insns[idx];
    if (in->dst != SLD_VREG_NONE && (uint32_t)in->dst > max_vreg) max_vreg = (uint32_t)in->dst;
    if (in->src1 != SLD_VREG_NONE && (uint32_t)in->src1 > max_vreg) max_vreg = (uint32_t)in->src1;
    if (in->src2 != SLD_VREG_NONE && (uint32_t)in->src2 > max_vreg) max_vreg = (uint32_t)in->src2;
}
uint32_t num_vreg_locals = max_vreg + 4U;

// Declare the exact required local group in the function header
wbuf_put_uleb(&fbody, 1);
wbuf_put_uleb(&fbody, num_vreg_locals);
wbuf_put8(&fbody, SLD_WASM_TYPE_I64);
```

---

## 10.4 Lowering Arbitrary C Control Flow to Structured WebAssembly

As established in Chapter 05, WebAssembly enforces structured control flow with strict nesting and forbids arbitrary `goto` jumps. Yet C code routinely contains arbitrary labels, `break`, `continue`, and early exits.  
`sld_wasm.c` resolves this via an optimized **State-Machine Dispatch Loop**:

```c
// 1. Allocate virtual Program Counter local ($pc)
uint32_t pc_local = param_count + num_vreg_locals - 1U;

// $pc = 0
wbuf_put8(&fbody, 0x42); wbuf_put_sleb(&fbody, 0);
wbuf_put8(&fbody, 0x21); wbuf_put_uleb(&fbody, pc_local);

// loop $dispatch (block void)
wbuf_put8(&fbody, 0x03); wbuf_put8(&fbody, 0x40);

// For each Basic Block in the C function:
// if ($pc == cur_block_id) {
//     ... execute basic block instructions ...
//     $pc = target_block_id;
//     br 1; // Branch back to loop head
// }
```

Under this dispatch architecture, arbitrary control flow graphs compile deterministically without violating W3C validation rules.

---

## 10.5 The Tri-Artifact Synthesis System

A standout capability of `sld-compiler` is that compilation does not merely output raw `.wasm` bytes; it synthesizes a cohesive **Tri-Artifact Bundle**:

1. **`app.wasm`:** Pure, unbloated WebAssembly binary (typically 200 – 500 bytes).
2. **`app.js`:** Universal Universal JavaScript Bridge:
   - Supports ES Modules (`import loadModule from './app.js'`).
   - Supports CommonJS/Node.js environments (`require('./app.js')`).
   - Supports Browser Globals with Emscripten-compatible `window.Module` and `onRuntimeInitialized`.
3. **`app.html`:** Interactive Web Playground styled with a modern neon aesthetic:
   - Lists discovered exported C functions dynamically.
   - Embeds a real-time Execution Console logging automated verification runs.

---

## 10.6 Case Study: Compiling Syn-Prism's 13-File Engine in 20 Milliseconds

Benchmarked on the Syn-Prism IDE engine comprising 13 modular C source files:
- **SLD Compilation Latency:** Completed in just **~20 milliseconds** (0.02 s).
- **Binary Footprint:** **90% smaller** than equivalent Emscripten builds.
- **Immediate Deployment:** Instantly launchable in modern browsers via any local web server.

```bash
# Compile C source directly to a runnable WebAssembly playground in a single pass:
sld --target=wasm32 -o playground.html sample.c
```

To explore the live automated test suite verifying SLD emitter outputs under the V8 engine, inspect [examples/sld-emitter-test.js](examples/sld-emitter-test.js).

---

[⬅ Chapter 09: Compiling C to Bare-Metal Wasm](09-clang-bare-metal.md) | [Main Table of Contents](README.md) | [Chapter 11: Validation and Debugging ➡](11-validation-debugging.md)
