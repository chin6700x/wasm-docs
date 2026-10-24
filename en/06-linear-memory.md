# Chapter 06: Linear Memory Model & Page Architecture

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **Standards Reference:** [W3C Core Specification — Memory Instructions](https://webassembly.github.io/spec/core/binary/instructions.html#memory-instructions) • [MDN WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory)

[⬅ Chapter 05](05-control-flow.md) | [Table of Contents](README.md) | [Chapter 07 ➡](07-tables-indirect-call.md)

> [!NOTE]
> All binary bytecodes, memory layouts, and bump allocation algorithms in this chapter are validated against the V8 engine in [examples/memory-test.js](examples/memory-test.js) (covering Little-Endian scalar layouts, sign-extension, bump allocation, the detached buffer pitfall, maximum memory ceilings, and out-of-bounds trap handling).

---

## 6.1 The Linear Memory Model: Unsegmented Raw Byte Arrays

In legacy computer architectures (such as x86 real-mode or protected mode), physical and virtual memory spaces were historically partitioned via **Segment Registers** (`CS`, `DS`, `SS`, `ES`) or multi-level page tables with per-page Read/Write/Execute permissions.

In contrast, **WebAssembly Linear Memory** is engineered for maximum simplicity, sandbox security, and near-native access speeds:

```text
+---------------------------------------------------------------------------------+
|                              Linear Memory (Wasm32)                             |
| Address 0                                                       Address N-1     |
| [ Byte 0 ] [ Byte 1 ] [ Byte 2 ] [ Byte 3 ] ... [ Byte 65,535 ] ... [ Byte N ]  |
+---------------------------------------------------------------------------------+
     ▲                                                 ▲
     │                                                 │
  Base address is an unsigned 32-bit integer        Grows dynamically in
  (0x00000000 to 0xFFFFFFFF)                        Page increments (64 KiB)
```

### Four Key Invariants of Linear Memory:

1. **Contiguous Byte Array:**  
   Modeled as a flat, unsegmented array of raw bytes beginning at index `0` and extending to the active memory boundary.
2. **Untyped Bytes:**  
   At the memory storage layer, there are no structural abstractions like structs, classes, or objects—only raw bytes. Accessing instructions (`i32.load`, `f64.load`, etc.) dictate how those bytes are deserialized.
3. **Little-Endian Byte Ordering:**  
   The W3C specification strictly mandates **Little-Endian byte order** (Least Significant Byte stored at lowest address). This matches native x86_64 and ARM64 hardware memory layouts, eliminating byte-swapping overhead.
4. **Sandboxed & Zero-Leak Isolation:**  
   Pointers inside WebAssembly are merely **integer offsets within its assigned linear memory buffer**. They are not host operating system virtual or physical memory addresses. Bytecode cannot dereference pointers outside its sandbox boundary.

---

## 6.2 The Memory Page Standard: 1 Page = 64 KiB

Linear memory allocation does not occur byte-by-byte; rather, allocation, limits, and growth operate strictly in units of **Pages**:

$$\mathbf{1\text{ Memory Page} = 65,536\text{ Bytes} = 64\text{ KiB}}$$

```text
+-----------------------------------------------------------------------+
| 1 Page  = 65,536 Bytes (64 KiB)                                       |
+-----------------------------------------------------------------------+
| 2 Pages = 131,072 Bytes (128 KiB)                                     |
+-----------------------------------------------------------------------+
| 16 Pages = 1,048,576 Bytes (1 MiB)                                    |
+-----------------------------------------------------------------------+
| 65,536 Pages = 4,294,967,296 Bytes (4 GiB - Theoretical Wasm32 Limit) |
+-----------------------------------------------------------------------+
```

### Declaring Memory Limits in Section 5

In the binary format, a module declares its memory requirements via a `limits` structure:

```text
+-------------+------------------+------------------+
| Flags (1 B) | Minimum (u32 LEB)| Maximum (u32 LEB)|
+-------------+------------------+------------------+
```
- `Flags = 0x00`: Specifies an initial `min` page count with an **unbounded maximum** (can grow until host system memory exhaustion).
- `Flags = 0x01`: Specifies both a mandatory `min` page count and an upper bound `max` page ceiling.

**Binary Examples:**
- `0x00 0x01` $\rightarrow$ Min 1 Page (64 KB), unbounded max.
- `0x01 0x01 0x04` $\rightarrow$ Min 1 Page (64 KB), capped at 4 Pages (256 KB).

---

## 6.3 Memory Load & Store Instructions

WebAssembly provides explicit instructions for loading values from linear memory onto the operand stack and storing values from the stack back into linear memory:

### 1. Full-Width Load and Store Instructions

| Opcode | Instruction | Immediate | Stack Transition | Operational Semantics |
| :---: | :--- | :--- | :--- | :--- |
| `0x28` | `i32.load` | `memarg` | `[i32] -> [i32]` | Read 32-bit scalar integer (4 bytes) |
| `0x29` | `i64.load` | `memarg` | `[i32] -> [i64]` | Read 64-bit scalar integer (8 bytes) |
| `0x2A` | `f32.load` | `memarg` | `[i32] -> [f32]` | Read IEEE-754 single-precision float |
| `0x2B` | `f64.load` | `memarg` | `[i32] -> [f64]` | Read IEEE-754 double-precision float |
| `0x36` | `i32.store` | `memarg` | `[i32, i32] -> []` | Store 32-bit scalar at address (`[addr, val]`) |
| `0x37` | `i64.store` | `memarg` | `[i32, i64] -> []` | Store 64-bit scalar at address |
| `0x38` | `f32.store` | `memarg` | `[i32, f32] -> []` | Store 32-bit float at address |
| `0x39` | `f64.store` | `memarg` | `[i32, f64] -> []` | Store 64-bit double at address |

---

### 2. Sub-Width Loads and Stores

Used to optimize memory density for sub-word C types like `char` (8-bit) and `short` (16-bit):

| Opcode | Instruction | Stack Transition | Conversion Behavior |
| :---: | :--- | :--- | :--- |
| `0x2C` | `i32.load8_s` | `[i32] -> [i32]` | Load 1 byte, **Sign-Extend** to 32 bits |
| `0x2D` | `i32.load8_u` | `[i32] -> [i32]` | Load 1 byte, **Zero-Extend** to 32 bits |
| `0x2E` | `i32.load16_s`| `[i32] -> [i32]` | Load 2 bytes, **Sign-Extend** to 32 bits |
| `0x2F` | `i32.load16_u`| `[i32] -> [i32]` | Load 2 bytes, **Zero-Extend** to 32 bits |
| `0x30` | `i64.load8_s` | `[i32] -> [i64]` | Load 1 byte, Sign-Extend to 64 bits |
| `0x31` | `i64.load8_u` | `[i32] -> [i64]` | Load 1 byte, Zero-Extend to 64 bits |
| `0x32` | `i64.load16_s`| `[i32] -> [i64]` | Load 2 bytes, Sign-Extend to 64 bits |
| `0x33` | `i64.load16_u`| `[i32] -> [i64]` | Load 2 bytes, Zero-Extend to 64 bits |
| `0x34` | `i64.load32_s`| `[i32] -> [i64]` | Load 4 bytes, Sign-Extend to 64 bits |
| `0x35` | `i64.load32_u`| `[i32] -> [i64]` | Load 4 bytes, Zero-Extend to 64 bits |
| `0x3A` | `i32.store8`  | `[i32, i32] -> []`| Truncate and write lower 8 bits |
| `0x3B` | `i32.store16` | `[i32, i32] -> []`| Truncate and write lower 16 bits |
| `0x3C` | `i64.store8`  | `[i32, i64] -> []`| Truncate and write lower 8 bits |
| `0x3D` | `i64.store16` | `[i32, i64] -> []`| Truncate and write lower 16 bits |
| `0x3E` | `i64.store32` | `[i32, i64] -> []`| Truncate and write lower 32 bits |

---

## 6.4 The `memarg` Structure: Alignment and Static Offsets

Every load and store opcode is followed by immediate arguments designated as **`memarg`**:

```text
[opcode] [align: u32 ULEB128] [offset: u32 ULEB128]
```

### 1. `align` (Alignment Exponent)
Encoded as a **base-2 power ($2^{\text{align}}$)**, not raw bytes:
- `align = 0` $\rightarrow 2^0 = 1$ byte alignment (unaligned access allowed).
- `align = 1` $\rightarrow 2^1 = 2$ byte alignment.
- `align = 2` $\rightarrow 2^2 = 4$ byte alignment (standard for `i32`, `f32`).
- `align = 3` $\rightarrow 2^3 = 8$ byte alignment (standard for `i64`, `f64`).

> [!NOTE]
> Per the W3C specification, `align` is an optimization hint for native JIT generation. Modern hardware handles unaligned memory accesses transparently. However, declaring $2^{\text{align}}$ larger than the natural data width of the instruction triggers an immediate **validation error**.

### 2. `offset` (Static Offset Addition)
A static constant folded directly into the effective address computation:

$$\text{Effective Address} = \text{Base Address (from stack)} + \text{offset (from memarg)}$$

This eliminates redundant `i32.add` instructions when compiling struct member lookups (e.g., `point->y`):

```wat
;; Instead of emitting:
local.get $ptr
i32.const 4
i32.add
i32.load 0 0

;; Compilers emit a single instruction:
local.get $ptr
i32.load 2 4   ;; align=2 (4-byte), static offset=4
```

---

## 6.5 Dynamic Memory Growth: `memory.size` & `memory.grow`

WebAssembly applications can query and expand their linear memory at runtime:

```text
[ memory.size ]  Opcode: 0x3F 0x00   | Stack: [] -> [i32]
Returns the current linear memory size measured in pages.

[ memory.grow ]  Opcode: 0x40 0x00   | Stack: [i32 delta] -> [i32 prev_pages]
Requests the host runtime to allocate `delta` additional pages:
  - If successful: Returns previous page count prior to expansion.
  - If allocation fails (or exceeds declared maximum): Returns -1 (0xFFFFFFFF).
```

> [!WARNING]
> **🚨 Critical Systems Warning: The Detached Buffer Gotcha**  
> When `memory.grow` executes, the host JavaScript runtime may allocate a completely new backing buffer and copy existing memory (via `mremap` or virtual allocation). As a consequence:  
> **Any pre-existing `ArrayBuffer` or `TypedArray` held by JavaScript becomes detached (byteLength drops to 0)!**  
> ```javascript
> const mem = instance.exports.memory;
> let view = new Uint8Array(mem.buffer);
> 
> instance.exports.mem_grow(1); // Allocates 1 additional page
> 
> console.log(view.byteLength); // 💥 Evaluates to 0!
> view[0] = 42;                 // 💥 TypeError: Cannot perform operation on a detached ArrayBuffer
> 
> // ✅ Correct Solution: Re-acquire mem.buffer after every memory.grow invocation:
> view = new Uint8Array(mem.buffer);
> ```

---

## 6.6 Building a Minimal Heap Bump Allocator in Pure Wasm

For bare-metal WebAssembly modules that bypass heavyweight C memory libraries like `dlmalloc`, we can implement a compact **Bump Allocator (Linear Allocator)** in pure WebAssembly:

```wat
(module
  (memory (export "memory") 1 4) ;; Initial 1 page (64 KB), max 4 pages (256 KB)
  
  ;; Global heap pointer initialized to offset 1024 (reserving lower memory for static state)
  (global $heap_ptr (mut i32) (i32.const 1024))

  (func $malloc (export "malloc") (param $size i32) (result i32)
    (local $old_ptr i32)
    (local $new_ptr i32)

    ;; 1. Preserve current allocation pointer
    global.get $heap_ptr
    local.set $old_ptr

    ;; 2. Compute 8-byte aligned target address: (old_ptr + size + 7) & -8
    local.get $old_ptr
    local.get $size
    i32.add
    i32.const 7
    i32.add
    i32.const -8     ;; In SLEB128, -8 is encoded as 0x78
    i32.and
    local.set $new_ptr

    ;; 3. Update global heap pointer
    local.get $new_ptr
    global.set $heap_ptr

    ;; 4. Return initial base pointer of allocated block
    local.get $old_ptr
  )
)
```

---

## 6.7 Zero-Copy Interoperability with JavaScript

JavaScript and WebAssembly share the exact same underlying `ArrayBuffer`, enabling true **Zero-Copy Data Transfer**:

```javascript
// Passing a UTF-8 string into WebAssembly memory:
function passStringToWasm(instance, text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  // Allocate memory block in Wasm linear memory
  const ptr = instance.exports.malloc(bytes.length + 1);

  // Write directly into Wasm linear memory buffer
  const mem = new Uint8Array(instance.exports.memory.buffer);
  mem.set(bytes, ptr);
  mem[ptr + bytes.length] = 0; // Null-terminator

  return ptr;
}

// Reading a null-terminated UTF-8 string from WebAssembly:
function readStringFromWasm(instance, ptr) {
  const mem = new Uint8Array(instance.exports.memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;

  const decoder = new TextDecoder("utf-8");
  return decoder.decode(mem.subarray(ptr, end));
}
```

---

## 6.8 Out-of-Bounds Memory Traps

If an instruction attempts to load or store outside the allocated linear memory bounds:

$$\text{Effective Address} + \text{Access Byte Size} > \text{Active Memory Size in Bytes}$$

The runtime immediately issues a hardware/software trap:
1. WebAssembly execution ceases instantly.
2. The runtime raises `WebAssembly.RuntimeError: memory access out of bounds` in JavaScript.
3. Host system stability is guaranteed; no out-of-bounds memory corruption can compromise the host process.

---

## Chapter 06 Summary

- WebAssembly Linear Memory is an unsegmented, Little-Endian contiguous byte array.
- Measured and allocated in fixed **64 KiB pages** ($65,536$ bytes).
- All memory instructions encode `align` hints and static `offset` values in a `memarg` structure.
- Calling `memory.grow` detaches existing JavaScript `ArrayBuffer` handles.
- Next Chapter: [Chapter 07: Tables & Indirect Call Dispatch](07-tables-indirect-call.md).
