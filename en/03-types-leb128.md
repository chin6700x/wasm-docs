# Chapter 03: Type System & LEB128 Variable-Length Encoding

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **Standards Reference:** [Core Specification — Types](https://webassembly.github.io/spec/core/syntax/types.html) • [Binary Format — Values](https://webassembly.github.io/spec/core/binary/values.html)

[⬅ Chapter 02](02-binary-format.md) | [Table of Contents](README.md) | [Chapter 04 ➡](04-instruction-set.md)

---

## 3.1 Value Types

| Type Sigil | Byte Opcode | Bit Width | Architectural Semantics |
| :--- | :---: | :--- | :--- |
| `i32` | `0x7F` | 32-bit | Integer: signedness is instruction-dependent (`_s` vs `_u`) |
| `i64` | `0x7E` | 64-bit | Same sign-neutral semantics as `i32` |
| `f32` | `0x7D` | 32-bit | IEEE 754 single-precision floating point |
| `f64` | `0x7C` | 64-bit | IEEE 754 double-precision floating point |
| `v128` | `0x7B` | 128-bit | SIMD vector payload (Chapter 12) |
| `funcref` | `0x70` | Opaque | Type-safe reference to a function (stored in tables) |
| `externref` | `0x6F` | Opaque | Opaque host object reference (e.g., JavaScript DOM nodes or objects) |

> [!IMPORTANT]
> WebAssembly has **no native types for boolean, char, or pointer** at the core bytecode level:
> - **Boolean** values are represented as `i32` (0 = false, non-zero = true).
> - **Pointers** in `wasm32` are represented as `i32` scalar **offsets within Linear Memory**.
> - Sub-word integers (`int8`, `uint8`, `int16`, `uint16`) are stored in `i32` registers and truncated or extended during memory load/store operations (Chapter 06).

### Reference Types and Sandbox Constraints

- Reference types (`funcref`, `externref`) **cannot be stored into Linear Memory**. They reside strictly within local variables, global variables, and table slots.
- JavaScript can pass arbitrary host objects into Wasm via `externref` without marshaling them into integer handle tables.

### Function Signatures (`functype`)

```text
functype = 0x60  vec(valtype)  vec(valtype)
                  parameters     results
```
Example: `(i32, f64) -> i32` is encoded as `60 02 7F 7C 01 7F`.

### Block Types (Used in `block`, `loop`, `if`)

| Byte Value | Semantic Meaning |
| :---: | :--- |
| `0x40` | Empty block signature: produces 0 values (void) |
| `0x7F`, `0x7E`, etc. | Returns exactly 1 value of the specified value type |
| Positive `s33` LEB128 | Index referencing a function type in Type Section (multi-value return) |

---

## 3.2 Why LEB128 Variable-Length Encoding?

WebAssembly encodes all integer constants, indices, section sizes, and memory offsets using **LEB128 (Little Endian Base 128)**.

Key engineering advantages:
- Values between 0 and 127 consume **exactly 1 byte**, even if typed as 32-bit or 64-bit integers.
- Decouples binary encoding from host CPU machine word widths.
- Facilitates linear streaming decoding.

```text
Each Byte: [c][d d d d d d d]
            │  └── 7 bits of data payload (least significant chunk first)
            └───── Continuation bit: 1 = more bytes follow, 0 = final byte
```

### Maximum Byte Length Boundaries

| Scalar Width | Max LEB128 Bytes Allowed |
| :--- | :---: |
| `uint32_t` / `int32_t` | 5 bytes |
| `uint64_t` / `int64_t` | 10 bytes |
| `s33` (Block Type index) | 5 bytes |

Unnecessary leading zero padding bytes are valid per specification as long as the total byte count does not exceed the maximum allowed length.

---

## 3.3 ULEB128 (Unsigned Encoding)

Used for: Type indices, function indices, section sizes, vector lengths, and memory offsets.

### Encoding Algorithm

```text
do:
   byte = v & 0x7F
   v >>= 7
   if v != 0: byte |= 0x80
   emit(byte)
while v != 0
```

### Walkthrough: Encoding `624485`

```text
624485 in binary: 0b 0010_0110_0001_1100_1110_0101
Split into 7-bit chunks (LSB to MSB):   0100110   0001110   1100101
Set continuation bits on non-final chunks: 0x26      0x8E      0xE5
Output byte sequence:                     0xE5      0x8E      0x26
```

---

## 3.4 SLEB128 (Signed Encoding)

Used for: `i32.const`, `i64.const`, and signed arithmetic immediates. Utilizes two's complement sign extension.

### Encoding Algorithm

```text
loop:
   byte = v & 0x7F
   v >>= 7                        // Arithmetic right-shift (preserves sign)
   if (v == 0  and (byte & 0x40) == 0) -> terminate
   if (v == -1 and (byte & 0x40) != 0) -> terminate
   byte |= 0x80
   emit(byte)
```

The critical rule: **Bit `0x40` (the 7th bit) of the final byte acts as the sign bit**. If this bit contradicts the true sign of the integer, an additional padding byte must be emitted.

### Empirical Boundary Reference Table

| Value | SLEB128 Encoding | Architectural Notes |
| :--- | :--- | :--- |
| `0` | `00` | Zero |
| `1` | `01` | Positive 1 |
| `-1` | `7F` | Single byte (bit `0x40` is 1, sign-extending to -1) |
| `63` | `3F` | Highest positive integer fitting in 1 byte |
| `64` | `C0 00` | Requires 2 bytes (single `0x40` would decode as -64) |
| `-64` | `40` | Lowest negative integer fitting in 1 byte |
| `-65` | `BF 7F` | Requires 2 bytes |
| `624485` | `E5 8E 26` | 3 bytes |
| `-123456` | `C0 BB 78` | 3 bytes |
| `INT32_MAX` (2,147,483,647) | `FF FF FF FF 07` | 5 bytes |
| `INT32_MIN` (-2,147,483,648)| `80 80 80 80 78` | 5 bytes |

> [!WARNING]
> The range of a 1-byte SLEB128 is **-64 to +63**, NOT -128 to +127! The most common bug in custom compiler emitters is treating signed immediate constants as unsigned ULEB128, causing `i32.const -1` to corrupt the instruction stream.

---

## 3.5 Production C Implementation: Encode & Decode

The self-contained C test harness [examples/leb128.c](examples/leb128.c) passes strict `-Wall -Wextra -pedantic` compliance under both Clang and the native `sld` compiler:

```c
#include <stdint.h>
#include <stddef.h>

static size_t uleb_encode(uint64_t v, uint8_t *out) {
    size_t n = 0;
    do {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;
        if (v != 0) byte |= 0x80;
        out[n++] = byte;
    } while (v != 0);
    return n;
}

static size_t sleb_encode(int64_t v, uint8_t *out) {
    size_t n = 0;
    int more = 1;
    while (more) {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;                                   /* Arithmetic right shift */
        int sign_bit_clear = (byte & 0x40) == 0;
        if ((v == 0 && sign_bit_clear) || (v == -1 && !sign_bit_clear))
            more = 0;
        else
            byte |= 0x80;
        out[n++] = byte;
    }
    return n;
}

static size_t sleb_decode(const uint8_t *in, int64_t *out) {
    int64_t result = 0;
    unsigned shift = 0;
    size_t n = 0;
    uint8_t byte;
    do {
        if (n >= 10) return 0;                     /* Malformed input safeguard */
        byte = in[n++];
        result |= (int64_t)(byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    if (shift < 64 && (byte & 0x40))
        result |= -((int64_t)1 << shift);          /* Arithmetic sign-extension */
    *out = result;
    return n;
}
```

---

## 3.6 Compiler Emitter Design Invariants

1. **Strictly isolate SLEB vs ULEB:** Always use SLEB128 for `i32.const` / `i64.const`, and ULEB128 for all indices, section sizes, and type vector lengths.
2. **Pre-compute Payload Lengths:** Section lengths must be written *before* the section body. Either buffer the payload in memory or pre-allocate 5 bytes of padded ULEB128 space and patch the size once completed.
3. **Guard Against Decode Overruns:** Always enforce a 5-byte read ceiling for 32-bit types and a 10-byte ceiling for 64-bit types when reading untrusted Wasm streams.

---

## Chapter 03 Summary

- The core type system features four numerical primitives (`i32`, `i64`, `f32`, `f64`), 128-bit vector (`v128`), and two reference types (`funcref`, `externref`).
- Integers are encoded using LEB128: **ULEB128** for indices and sizes; **SLEB128** for signed constants.
- The 1-byte boundary for signed integers is -64 to +63.
- Next Chapter: [Chapter 04: Instruction Set & Opcode Reference](04-instruction-set.md).
