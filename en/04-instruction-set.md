# Chapter 04: Instruction Set & Opcode Reference

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **Standards Reference:** [Core Specification — Instructions](https://webassembly.github.io/spec/core/binary/instructions.html)

[⬅ Chapter 03](03-types-leb128.md) | [Table of Contents](README.md) | [Chapter 05 ➡](05-control-flow.md)

> [!NOTE]
> Every opcode documented in this chapter is verified against V8 via the automated test harness [examples/opcode-test.js](examples/opcode-test.js) — **80 out of 80 test cases pass** across boundary values, signed/unsigned overflows, conversions, and trap conditions.

---

## 4.1 Instruction Format & Encoding

A WebAssembly instruction consists of a **1-byte opcode** optionally followed by static immediates (e.g., `i32.const 5` is encoded as `0x41 0x05`). Extended opcode spaces utilize multi-byte prefixes:
- `0xFC`: Non-trapping saturating float-to-int conversions and bulk memory operations.
- `0xFD`: 128-bit SIMD vector instructions (Chapter 12).
- `0xFE`: Thread synchronization and atomic memory operations.

**Stack Type Signature Invariant:** Every instruction possesses a strictly validated input/output stack transition, e.g., `i32.add : [i32, i32] -> [i32]`. If the operand stack does not match the instruction's expected type signature, the module is rejected during pre-execution validation.

---

## 4.2 Numeric Constants

| Opcode | Instruction | Immediate Encoding | Hex Example | Evaluated Value |
| :---: | :--- | :--- | :--- | :--- |
| `0x41` | `i32.const` | SLEB128 (`s32`) | `41 7F` | `-1` |
| `0x42` | `i64.const` | SLEB128 (`s64`) | `42 C0 00` | `64` |
| `0x43` | `f32.const` | 4 raw bytes (IEEE 754 Little-Endian) | `43 00 00 C0 3F` | `1.5f` |
| `0x44` | `f64.const` | 8 raw bytes (IEEE 754 Little-Endian) | `44 00 00 00 00 00 00 F8 3F` | `1.5` |

Floating-point constants are stored as raw literal IEEE 754 binary bytes, **never encoded via LEB128**.

---

## 4.3 Variable Access: Locals & Globals

| Opcode | Instruction | Immediate | Stack Transition | Operational Semantics |
| :---: | :--- | :--- | :--- | :--- |
| `0x20` | `local.get` | ULEB128 local index | `[] -> [t]` | Push value of local variable onto stack |
| `0x21` | `local.set` | ULEB128 local index | `[t] -> []` | Pop value and store into local variable |
| `0x22` | `local.tee` | ULEB128 local index | `[t] -> [t]` | Store value into local variable **while retaining it on the stack** |
| `0x23` | `global.get` | ULEB128 global index| `[] -> [t]` | Push value of global variable onto stack |
| `0x24` | `global.set` | ULEB128 global index| `[t] -> []` | Pop value and update mutable global variable |

- **Local Index Ordering:** Parameters occupy the lowest indices `0..P-1`, followed sequentially by local variables declared inside the Code section.
- **Automatic Zero-Initialization:** All declared local variables are initialized to zero (`0`, `0.0`) by default upon function entry.

```text
;; Compute f(x) = (x * 2) + (x * 2) using local.tee to cache (x * 2) in local 1:
local.get 0
i32.const 2
i32.mul
local.tee 1          ; Store into local 1, leaves copy on stack
local.get 1
i32.add              ; Result for x=5 -> 20
```

---

## 4.4 Integer Arithmetic Operations

In WebAssembly, integer storage types (`i32`, `i64`) are sign-neutral. **Signedness is dictated entirely by the instruction opcode** (`_s` for signed operations, `_u` for unsigned operations).

### 32-bit Integer (`i32`) Instruction Map (`0x67`–`0x78`)

| Opcode | Instruction | Verified Behavior Example |
| :---: | :--- | :--- |
| `0x67` | `i32.clz` | Count leading zeros: `clz(1) = 31` |
| `0x68` | `i32.ctz` | Count trailing zeros: `ctz(8) = 3` |
| `0x69` | `i32.popcnt` | Population count (number of 1-bits): `popcnt(255) = 8` |
| `0x6A` | `i32.add` | Two's complement addition: wraps on overflow, never traps |
| `0x6B` | `i32.sub` | Two's complement subtraction |
| `0x6C` | `i32.mul` | Two's complement multiplication: wraps on overflow |
| `0x6D` | `i32.div_s` | Signed division: truncates toward zero (`-7 / 2 = -3`) |
| `0x6E` | `i32.div_u` | Unsigned division (`-7` interpreted as `4294967289`, `/ 2 = 2147483644`) |
| `0x6F` | `i32.rem_s` | Signed remainder: sign matches dividend (`-7 % 2 = -1`) |
| `0x70` | `i32.rem_u` | Unsigned remainder (`-7 % 2 = 1`) |
| `0x71` | `i32.and` | Bitwise AND: `12 & 10 = 8` |
| `0x72` | `i32.or` | Bitwise OR: `12 | 10 = 14` |
| `0x73` | `i32.xor` | Bitwise XOR: `12 ^ 10 = 6` |
| `0x74` | `i32.shl` | Logical shift left |
| `0x75` | `i32.shr_s` | Arithmetic shift right: preserves sign bit (`-8 >> 1 = -4`) |
| `0x76` | `i32.shr_u` | Logical shift right: zero-fills MSB (`-8 >>> 1 = 2147483644`) |
| `0x77` | `i32.rotl` | Bitwise rotate left: `rotl(0x80000001, 1) = 3` |
| `0x78` | `i32.rotr` | Bitwise rotate right |

> [!IMPORTANT]
> **Shift Count Masking:** In WebAssembly, shift counts are **implicitly masked by the bit-width** modulo (32 for `i32`, 64 for `i64`). For instance, `1 << 33` in `i32` evaluates deterministically to `1 << 1 = 2`. Unlike C (where shifts $\ge$ bit-width constitute Undefined Behavior), WebAssembly behavior is strictly well-defined.

### Integer Arithmetic Traps vs Wrapping

| Arithmetic Scenario | Runtime Behavior |
| :--- | :--- |
| `div_s`, `div_u`, `rem_s`, `rem_u` with divisor `0` | **Trap:** `RuntimeError: integer divide by zero` |
| `i32.div_s` executing `INT32_MIN / -1` | **Trap:** `RuntimeError: integer overflow` |
| `i32.rem_s` executing `INT32_MIN % -1` | **No Trap:** Evaluates deterministically to `0` |
| `add`, `sub`, `mul` overflowing integer bounds | **No Trap:** Wraps modularly using standard two's complement |

---

## 4.5 Comparison Operators

All comparison instructions push an `i32` result: `1` for true, `0` for false.

| `i32` Opcode | `i64` Opcode | Instruction | Semantic Meaning |
| :---: | :---: | :--- | :--- |
| `0x45` | `0x50` | `eqz` | Test if value equals zero (`unary: [t] -> [i32]`) |
| `0x46` | `0x51` | `eq` | Equality test |
| `0x47` | `0x52` | `ne` | Inequality test |
| `0x48` | `0x53` | `lt_s` | Less-than (signed) |
| `0x49` | `0x54` | `lt_u` | Less-than (unsigned) |
| `0x4A` | `0x55` | `gt_s` | Greater-than (signed) |
| `0x4B` | `0x56` | `gt_u` | Greater-than (unsigned) |
| `0x4C` | `0x57` | `le_s` | Less-than or equal (signed) |
| `0x4D` | `0x58` | `le_u` | Less-than or equal (unsigned) |
| `0x4E` | `0x59` | `ge_s` | Greater-than or equal (signed) |
| `0x4F` | `0x5A` | `ge_u` | Greater-than or equal (unsigned) |

Example: `lt_s(-1, 1)` yields `1` (true), whereas `lt_u(-1, 1)` yields `0` (false, because `-1` unsigned is `0xFFFFFFFF`).

---

## 4.6 Floating-Point Arithmetic (`f32`, `f64`)

| `f32` Opcode | `f64` Opcode | Instruction | Mathematical Semantics |
| :---: | :---: | :--- | :--- |
| `0x8B` | `0x99` | `abs` | Absolute value |
| `0x8C` | `0x9A` | `neg` | Numerical negation (`neg(5.0) = -5.0`) |
| `0x8D` | `0x9B` | `ceil` | Round upward to next integer |
| `0x8E` | `0x9C` | `floor` | Round downward to next integer |
| `0x8F` | `0x9D` | `trunc` | Round toward zero |
| `0x90` | `0x9E` | `nearest` | IEEE 754 round to nearest integer, **ties to even** |
| `0x91` | `0x9F` | `sqrt` | Square root |
| `0x92` | `0xA0` | `add` | Addition |
| `0x93` | `0xA1` | `sub` | Subtraction |
| `0x94` | `0xA2` | `mul` | Multiplication |
| `0x95` | `0xA3` | `div` | Division: division by zero produces `±Inf` or `NaN`, **never traps** |
| `0x96` | `0xA4` | `min` | Floating-point minimum (`min(-0.0, +0.0) = -0.0`) |
| `0x97` | `0xA5` | `max` | Floating-point maximum |
| `0x98` | `0xA6` | `copysign` | Magnitude of first argument with sign of second argument |

---

## 4.7 Conversions & Type Casting

| Opcode | Instruction | Operational Semantics |
| :---: | :--- | :--- |
| `0xA7` | `i32.wrap_i64` | Truncate 64-bit integer to lower 32 bits |
| `0xA8` / `0xA9` | `i32.trunc_f32_s/u` | Float to integer: **traps if NaN or outside target range** |
| `0xAA` / `0xAB` | `i32.trunc_f64_s/u` | Double to integer: `trunc_f64_s(-3.9) = -3` |
| `0xAC` | `i64.extend_i32_s` | Sign-extend 32-bit integer to 64-bit (`-1 -> -1n`) |
| `0xAD` | `i64.extend_i32_u` | Zero-extend 32-bit integer to 64-bit (`-1 -> 4294967295n`) |
| `0xB2` / `0xB3` | `f32.convert_i32_s/u` | Integer to single-precision float |
| `0xB7` / `0xB8` | `f64.convert_i32_s/u` | Integer to double-precision float |
| `0xBB` | `f64.promote_f32` | Promote single-precision float to double |
| `0xB6` | `f32.demote_f64` | Demote double-precision float to single |
| `0xBC` | `i32.reinterpret_f32` | **Bitwise reinterpretation** (preserves raw binary bits without conversion) |
| `0xBD` | `i64.reinterpret_f64` | Bitwise reinterpretation: `f64 -> i64` |

### Non-Trapping Saturating Conversions (`0xFC` Prefix)

Standard `trunc` instructions trap if the source float is `NaN` or overflows the integer width. Saturating conversions clamp the result gracefully:

| Hex Prefix | Opcode | Clamping Behavior |
| :---: | :--- | :--- |
| `FC 00` / `FC 01` | `i32.trunc_sat_f32_s/u` | `NaN -> 0`, positive overflow $\rightarrow$ `INT32_MAX`, negative overflow $\rightarrow$ `INT32_MIN` |
| `FC 02` / `FC 03` | `i32.trunc_sat_f64_s/u` | Clamps double-precision inputs without trapping |

---

## 4.8 Parametric & Control Primitives

| Opcode | Instruction | Stack Transition | Description |
| :---: | :--- | :--- | :--- |
| `0x00` | `unreachable` | `[] -> ...` | Immediate runtime trap |
| `0x01` | `nop` | `[] -> []` | No operation |
| `0x1A` | `drop` | `[t] -> []` | Discard top operand from stack |
| `0x1B` | `select` | `[t, t, i32] -> [t]` | If condition $\neq 0$, yields first operand; else second operand |

> [!NOTE]
> Unlike an `if-else` construct, `select` **evaluates both branch operands prior to execution** (no short-circuiting). It is intended for side-effect-free scalar selection.

---

## Chapter 04 Summary

- WebAssembly uses 1-byte opcodes with optional ULEB/SLEB immediates.
- Signed vs unsigned behavior is encoded in the instruction suffix (`_s` vs `_u`), not in the data type.
- Shift amounts are implicitly masked by modulo bit-width.
- Integer division by zero traps; floating-point division by zero evaluates to `±Inf`/`NaN` without trapping.
- Next Chapter: [Chapter 05: Structured Control Flow & Validation](05-control-flow.md).
