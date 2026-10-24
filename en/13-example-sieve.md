# Chapter 13: Example Project 01 — Sieve of Eratosthenes in Pure WAT

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [MDN — Understanding WebAssembly text format](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format) • [W3C Core Spec — Text Format](https://webassembly.github.io/spec/core/text/index.html)

[⬅ Chapter 12](12-modern-wasm.md) | [Table of Contents](README.md) | [Chapter 14 ➡](14-example-mandelbrot.md)

> [!NOTE]
> This chapter synthesizes concepts from Chapters 03 through 08 to build a complete production application from scratch without relying on any high-level language compiler. The source code resides in [examples/sieve.wat](examples/sieve.wat) and the accompanying automated test harness in [examples/sieve-test.js](examples/sieve-test.js) (validated against the V8 engine and compared byte-for-byte with a JavaScript reference algorithm).

---

## 13.1 Specification & Problem Statement

Calculate all prime numbers up to integer `n` using the **Sieve of Eratosthenes** algorithm. WebAssembly handles compute and memory layout, while JavaScript reads the resulting bitmap directly from Linear Memory.

| Exported Symbol | Signature | Operational Responsibility |
| :--- | :--- | :--- |
| `sieve(n)` | `(i32) -> i32` | Returns total prime count $\le n$ (returns `-1` if $n \ge 65536$) |
| `is_prime(i)` | `(i32) -> i32` | Returns `1` (prime) or `0` (composite) after `sieve` execution |
| `memory` | Memory | Exposes Linear Memory allowing zero-copy JS buffer inspection |

---

## 13.2 Memory Layout & Bounds Guard

We allocate **1 byte per integer candidate** at linear address offset `i` (`1` = prime candidate, `0` = marked composite):

```
Address: 0  1  2  3  4  5  6  7  8  9 ...
Value:   0  0  1  1  0  1  0  1  0  0 ...   (after sieve(9))
```

A standard WebAssembly page comprises 65,536 bytes (64 KiB), accommodating $n$ up to 65,535. The algorithm verifies bounds prior to execution:

```wat
(if (i32.ge_u (local.get $n) (i32.const 65536))
  (then (return (i32.const -1))))
```

> [!IMPORTANT]
> Omitting bounds checks when indexing beyond allocated page space triggers an unrecoverable `RuntimeError: memory access out of bounds` (Chapter 06). Rejecting invalid sizes early and returning `-1` enables graceful error recovery in caller code.

---

## 13.3 Implementation Details (WAT Source)

Key algorithmic sections from [sieve.wat](examples/sieve.wat):

```wat
(module
  (memory (export "memory") 1)

  (func $sieve (export "sieve") (param $n i32) (result i32)
    (local $i i32) (local $j i32) (local $count i32)

    ;; 1) Initialize all slots [0..n] to 1 using bulk-memory instruction
    (memory.fill (i32.const 0) (i32.const 1) (i32.add (local.get $n) (i32.const 1)))
    (i32.store8 (i32.const 0) (i32.const 0))
    (if (i32.ge_u (local.get $n) (i32.const 1))
      (then (i32.store8 (i32.const 1) (i32.const 0))))

    ;; 2) Outer Loop: i = 2; i*i <= n; i++
    (local.set $i (i32.const 2))
    (block $outer_done
      (loop $outer
        (br_if $outer_done
          (i32.gt_u (i32.mul (local.get $i) (local.get $i)) (local.get $n)))

        (if (i32.load8_u (local.get $i))
          (then
            ;; Inner Loop: j = i*i; j <= n; j += i  -> mark multiples composite
            (local.set $j (i32.mul (local.get $i) (local.get $i)))
            (block $inner_done
              (loop $inner
                (br_if $inner_done (i32.gt_u (local.get $j) (local.get $n)))
                (i32.store8 (local.get $j) (i32.const 0))
                (local.set $j (i32.add (local.get $j) (local.get $i)))
                (br $inner)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))

    ;; 3) Count prime totals and return $count
    ...))
```

### Why Pair `block` with `loop`?

As detailed in Chapter 05, branching (`br`) targeting a `loop` jumps back to its head (re-executes loop), whereas branching targeting a `block` jumps forward to its exit point:

```
(block $done          ← br_if $done  = break loop
  (loop $again        ← br $again    = continue loop
    ...))
```

### Synthesis of Core Concepts Across Chapters:

| Implemented Primitive | Reference Chapter |
| :--- | :--- |
| `i32.load8_u` / `i32.store8` — single-byte memory access | 06 |
| `memory.fill` — bulk memory range fill in a single instruction | 04, 06 |
| `block` / `loop` / `br_if` — nested structured control flow | 05 |
| `i32.gt_u`, `i32.ge_u` — unsigned numerical comparisons | 04 |
| Exporting `memory` for zero-copy host introspection | 08 |

---

## 13.4 Assembly and Validation

```bash
wat2wasm sieve.wat -o sieve.wasm     # Produces a compact 233-byte binary
wasm-validate sieve.wasm             # Validates cleanly (exit code 0)
wasm-objdump -x sieve.wasm           # Inspects sections, imports, and exports
```

---

## 13.5 JavaScript Host Consumption

```javascript
import fs from 'node:fs';

const { instance } = await WebAssembly.instantiate(fs.readFileSync('sieve.wasm'));
const { sieve, is_prime, memory } = instance.exports;

console.log(sieve(100));      // 25
console.log(sieve(10000));    // 1229

// Direct zero-copy inspection of Linear Memory bitmap
sieve(100);
const bitmap = new Uint8Array(memory.buffer, 0, 101);
const primes = [...bitmap.keys()].filter(i => bitmap[i]);
console.log(primes.join(' '));   // 2 3 5 7 11 13 ... 97
```

---

## 13.6 Empirical Test Execution & Benchmarks

Running `node examples/sieve-test.js` produces:

```
π(10)    = 4
π(100)   = 25
π(1000)  = 168
π(10000) = 1229
π(65535) = 6542
sieve(65536) = -1   ← Gracefully rejected prior to out-of-bounds write
Wasm: 97.2 ms | JS: 113.3 ms   (n=65535, 2000 iterations)
```

The test harness cross-validates total counts and matches every individual byte of the linear memory bitmap against an identical JavaScript reference implementation at $n = 1, 2, 10, 100, 1000, 10000, 65535$.

---

## 13.7 Advanced Engineering Exercises

1. Refactor the allocation to **1 bit per number** using bitwise arithmetic (`i32.load8_u` + `i32.and` + `i32.shl`), supporting $n$ up to ~524,000 within a single 64 KiB memory page.
2. Integrate dynamic `memory.grow` to automatically scale capacity for larger bounds (remembering to handle potential TypedArray buffer detachment; see Chapter 06).
3. Implement an exported function `nth_prime(k)` that computes and returns the $k$-th prime number directly.

---

[⬅ Chapter 12: Modern WebAssembly & Future Horizons](12-modern-wasm.md) | [Main Table of Contents](README.md) | [Chapter 14: Example 02 — Mandelbrot Explorer ➡](14-example-mandelbrot.md)
