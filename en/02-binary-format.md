# Chapter 02: W3C Binary Format & Section Architecture

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **Standards Reference:** [Core Specification — Binary Format](https://webassembly.github.io/spec/core/binary/index.html)

[⬅ Chapter 01](01-core-architecture.md) | [Table of Contents](README.md) | [Chapter 03 ➡](03-types-leb128.md)

---

## 2.1 Magic Number and Version

Every valid `.wasm` binary file begins with an immutable 8-byte preamble:

| Byte Offset | Hex Bytes | Semantic Definition |
| :---: | :--- | :--- |
| 0–3 | `00 61 73 6D` | Magic Number = ASCII `"\0asm"` |
| 4–7 | `01 00 00 00` | Version = 1 (Little-Endian `uint32_t`) |

- If the magic word does not match, host runtimes immediately reject the file (`WebAssembly.CompileError: expected magic word 00 61 73 6d`).
- The version field remains `1` in current specifications; new W3C features and capabilities expand the instruction set without bumping the binary version number.

---

## 2.2 Section Structure

Following the 8-byte preamble, a `.wasm` file consists of an ordered sequence of **Sections**. Every section shares an identical three-field structure:

```text
+-------------------+-----------------------+-----------------------------+
| Section ID (uint8)| Payload Size (ULEB128)| Section Payload (Size Bytes)|
+-------------------+-----------------------+-----------------------------+
```

- `size` measures strictly the **payload bytes** (excluding the 1-byte section ID and the size field itself).
- Runtimes and decoders can safely skip unrecognized or custom sections by reading `size` and seeking forward.
- If the bytes consumed while parsing a section do not exactly equal `size`, the module is rejected as malformed (`CompileError: section was shorter/longer than expected size`).

### Section Ordering Rules

All known sections must appear **in strict ascending order of their Section IDs**, with exactly one critical architectural exception: **DataCount Section (ID 12) must appear immediately before the Code Section (ID 10)**.

```text
Type(1) → Import(2) → Function(3) → Table(4) → Memory(5) → Global(6)
→ Export(7) → Start(8) → Element(9) → DataCount(12) → Code(10) → Data(11)
```

> [!IMPORTANT]
> **DataCount (ID 12) must precede Code (ID 10)** to allow single-pass validators to verify bulk memory instructions (e.g., `memory.init`) before the Data Section is decoded. Custom Sections (ID 0) may appear at any position, before or after any other section.

---

## 2.3 Comprehensive Section Breakdown

### Overview Table

| ID | Section Name | Payload Description | Mandatory? |
| :---: | :--- | :--- | :---: |
| **0** | **Custom** | Debug metadata, symbol names (`name`), tooling telemetry | No |
| **1** | **Type** | Function signature definitions across module | If functions exist |
| **2** | **Import** | Host imports (functions, memories, tables, globals) | No |
| **3** | **Function** | Mapping from internal function index to Type Index | If functions exist |
| **4** | **Table** | Declarations of indirect call reference tables | No |
| **5** | **Memory** | Declarations of linear memory limits | No |
| **6** | **Global** | Global variables, types, and initializer expressions | No |
| **7** | **Export** | Symbols exposed to host / JavaScript environment | No |
| **8** | **Start** | Optional auto-executing initialization function | No |
| **9** | **Element** | Initializer data for table slots | No |
| **12** | **DataCount** | Total segment count for bulk memory instructions | If bulk ops used |
| **10** | **Code** | Function bodies (locals + bytecode instructions) | If functions exist |
| **11** | **Data** | Static memory payloads initialized into linear memory | No |

Every section that encodes a list of items is prefixed with a **vector length** (a variable-length `uint32_t` encoded via ULEB128), followed by that exact number of item payloads.

### Section 1 — Type Section

```text
vec(functype)     functype = 0x60 vec(valtype) vec(valtype)
                                  parameters    results
```
Example: `(i32, i32) -> i32` is encoded as `60 02 7F 7F 01 7F`.

### Section 2 — Import Section

```text
vec(import)   import = module:name  field:name  desc
desc = 0x00 typeidx          ; Function import
     | 0x01 tabletype        ; Table import
     | 0x02 limits           ; Memory import
     | 0x03 valtype mut      ; Global import
```
Functions imported via Section 2 are assigned function indices **before** functions defined internally in the module.

### Section 3 — Function Section

A simple vector of Type Indices. The $i$-th entry assigns the type signature `typeidx[i]` to internal function $i$. The bytecode body itself is placed in Section 10 at the matching relative index.

### Section 4 — Table Section

```text
tabletype = reftype(0x70|0x6F) limits
limits    = 0x00 min | 0x01 min max
```

### Section 5 — Memory Section

```text
limits: 0x00 min          ; Unbounded maximum
        0x01 min max      ; Measured in 64 KiB pages
```
Example: `05 03 01 00 01` declares 1 memory with a minimum size of 1 page (64 KiB).

### Section 6 — Global Section

```text
vec(global)   global = valtype mut(0=const, 1=var) init_expr(... 0x0B)
```

### Section 7 — Export Section

```text
vec(export)   export = name kind(0=func, 1=table, 2=memory, 3=global) index
```

### Section 8 — Start Section

A single ULEB128 index referencing a nullary function (`() -> ()`) that executes automatically upon module instantiation.

### Section 9 — Element Section

Populates table entries (such as storing function pointers into table indices 0..$N$). Explored in detail in Chapter 07.

### Section 10 — Code Section

```text
vec(code)   code = size(u32)  func
func = vec(locals)  expr
locals = count(u32) valtype        ; Encoded in compressed groups
expr = instr* 0x0B
```

> [!WARNING]
> `locals` are encoded in **groups (count, type)**. Any local variable accessed via `local.get N` must have an index strictly less than $(\text{parameter\_count} + \text{total\_locals})$. Exceeding this boundary triggers `CompileError: invalid local index`.

### Section 11 — Data Section

```text
vec(data)   data = flag expr? vec(byte)
flag 0: Active, writes to memory 0 at offset expression
flag 1: Passive, accessed explicitly via memory.init
flag 2: Active, specifies target memory index
```

---

## 2.4 Diagnostic Tool: Hand-Rolled Section Inspector (`wasm-dump.js`)

The standalone test script [examples/wasm-dump.js](examples/wasm-dump.js) parses complete WebAssembly binaries without any third-party libraries:

```javascript
let pos = 8;                         // Skip 8-byte preamble
while (pos < bytes.length) {
  const id   = bytes[pos++];
  const size = readU32(bytes, st);   // Decode ULEB128 payload size
  const end  = st.pos + size;
  // ... Process section payload according to id ...
  st.pos = end;                      // Advance to next section boundary
}
```

### Diagnostic Output 1: Native Clean-Room Binary from `sld`

```text
$ sld --target=wasm32 t.c -o t.wasm && node wasm-dump.js t.wasm
magic  : 00 61 73 6d ("\0asm")
version: 1
size   : 109 bytes

@0x0008  id= 1 Type      size=    12  2 types: (i32,i32)->(i32) (i32)->(i32)
@0x0016  id= 3 Function  size=     3  2 functions
@0x001b  id= 5 Memory    size=     3  1 memory: min=1 page(s) (64 KiB)
@0x0020  id= 7 Export    size=    21  3 exports: memory(memory#0), add(func#0), sq(func#1)
@0x0037  id=10 Code      size=    52  2 function bodies
```
The clean-room emitter produces a compact 109-byte binary containing only the 5 essential sections.

### Diagnostic Output 2: Binary Emitted by Emscripten (`syn.wasm`, 65,598 bytes)

```text
@0x0008  id= 1 Type      size=   206  30 types
@0x00d9  id= 2 Import    size=    31  5 imports: a.a:func, a.b:func, ...
@0x00fa  id= 3 Function  size=    93  92 functions
@0x0159  id= 4 Table     size=     5  1 tables
@0x0160  id= 5 Memory    size=     7  1 memory: min=258 page(s) (16512 KiB), max=32768
@0x0169  id= 6 Global    size=     8  1 globals
@0x0173  id= 7 Export    size=    57  14 exports
@0x01ae  id= 9 Element   size=    17  1 element segments
@0x01c1  id=12 DataCount size=     1  dataCount=27
@0x01c4  id=10 Code      size= 60587  92 function bodies
@0xee73  id=11 Data      size=  4552  27 data segments
```

Key observations:
- DataCount (ID 12) strictly precedes Code (ID 10).
- The Code Section occupies 60,587 bytes (over 92% of the binary), largely consisting of embedded C runtime routines (`malloc`, `sprintf`).
- Initial memory requests 258 pages (~16 MiB) with an upper bound of 32,768 pages (2 GiB).

---

## 2.5 Building a Complete Module Section by Section

Below is a JavaScript snippet synthesizing a complete module exporting `sq(x) = x * x`:

```javascript
const sec = (id, payload) => [id, payload.length, ...payload]; // Helper valid for payloads < 128 bytes

const bytes = new Uint8Array([
  0x00,0x61,0x73,0x6D, 0x01,0x00,0x00,0x00,               // 8-byte Preamble
  ...sec(1, [1, 0x60, 1, 0x7F, 1, 0x7F]),                 // Type: (i32) -> i32
  ...sec(3, [1, 0]),                                      // Function: 1 function of Type Index 0
  ...sec(7, [1, 2, 0x73, 0x71, 0x00, 0]),                 // Export: "sq" -> func #0
  ...sec(10, [1, 7, 0, 0x20, 0, 0x20, 0, 0x6C, 0x0B])     // Code: local.get 0; local.get 0; i32.mul; end
]);

const { instance } = await WebAssembly.instantiate(bytes);
console.log(instance.exports.sq(12)); // 144
```

---

## 2.6 Common Binary-Level Invalidation Errors

| Error Signature | Underlying Cause |
| :--- | :--- |
| `expected magic word 00 61 73 6d` | File header corrupted or HTTP server returned an HTML 404 page |
| `section out of order` | Sections placed out of strictly ascending ID sequence |
| `section was shorter than expected size` | Payload size field mismatch with actual section bytes |
| `function and code section have inconsistent lengths` | Mismatch between function declarations (Sec 3) and bodies (Sec 10) |
| `invalid local index: N` | Bytecode accesses a local index exceeding declared parameter + local count |

---

## Chapter 02 Summary

- A `.wasm` file consists of an 8-byte preamble followed by a sequence of `[ID | Size | Payload]` sections.
- Sections follow a strict monotonic ordering (with DataCount Section 12 preceding Code Section 10).
- All vector counts and integers use LEB128 variable-length encoding.
- Next Chapter: [Chapter 03: Type System & LEB128 Encoding](03-types-leb128.md).
