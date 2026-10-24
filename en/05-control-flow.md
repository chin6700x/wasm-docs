# Chapter 05: Structured Control Flow & Validation

> **Author:** Wirot Chookeaw ([`chin6700x`](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **Standards Reference:** [W3C Core Specification — Control Instructions](https://webassembly.github.io/spec/core/binary/instructions.html#control-instructions) • [MDN Control Flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)

[⬅ Chapter 04](04-instruction-set.md) | [Table of Contents](README.md) | [Chapter 06 ➡](06-linear-memory.md)

> [!NOTE]
> All binary instruction sequences and architectural patterns in this chapter are empirically validated against V8 in [examples/control-flow-test.js](examples/control-flow-test.js) (covering `block`, `loop`, `if-else`, `br_table`, and C `goto` state-machine dispatchers).

---

## 5.1 Why WebAssembly Omits Arbitrary Jumps (`goto`)

Conventional hardware instruction set architectures (such as ARM64 and x86_64) provide unconstrained jump primitives (`jmp`, `b`, `b.eq`) capable of branching to arbitrary memory addresses or program labels.

In contrast, the **W3C WebAssembly specification deliberately excludes arbitrary `goto` instructions**, enforcing strictly nested **Structured Control Flow** for four critical reasons:

1. **Fast, Linear Single-Pass Validation:**  
   Allowing unstructured jumps across arbitrary code boundaries would force the host runtime's validator to reconstruct complex Control Flow Graphs (CFGs) and perform iterative dataflow fixpoint analyses. By enforcing structured nesting, engines can verify type-state and operand stack depths in a single linear pass at wire speed.
2. **Deterministic Static Stack Heights:**  
   At any program counter position within a block, the exact number and types of values on the operand stack remain invariant, regardless of the dynamic execution path taken to arrive there.
3. **Prevention of ROP and Dangling Execution Vectors:**  
   Prevents Return-Oriented Programming exploits and avoids bypassing local variable initialization.
4. **Optimized Native JIT Compilation:**  
   Structured nesting mirrors structured higher-level language primitives, allowing JIT compilers to perform register allocation and emit optimized machine code directly.

---

## 5.2 Structured Block Constructs

WebAssembly provides three primary structured block constructs. Every block must be balanced and terminated by an **`end` (`0x0B`)** instruction:

| Opcode | Instruction | Immediate | Resulting Stack Transition | Operational Semantics |
| :---: | :--- | :--- | :--- | :--- |
| `0x02` | `block` | `blocktype` | `[t1*] -> [t2*]` | Creates an enclosing block boundary (forward branch target) |
| `0x03` | `loop` | `blocktype` | `[t1*] -> [t2*]` | Creates an iterative loop boundary (backward branch target) |
| `0x04` | `if` | `blocktype` | `[i32, t1*] -> [t2*]` | Conditional execution: pops `i32` condition from stack |
| `0x05` | `else` | None | Alternate branch | Separates the true-branch from the false-branch |
| `0x0B` | `end` | None | Terminates block | Final closing delimiter for `block`, `loop`, `if`, or `func` |

### Block Signatures (`blocktype`)

Like functions, structured blocks in WebAssembly can accept inputs from the stack and produce outputs upon termination:
- `0x40` = **void** (produces no return value).
- `0x7F` (`i32`), `0x7E` (`i64`), `0x7D` (`f32`), `0x7C` (`f64`) = produces exactly one value of that scalar type.
- Positive `s33` LEB128 = Type Index in Type Section for multi-value block signatures.

---

## 5.3 Branching via Label Depth (`br`, `br_if`, `br_table`)

Branching in WebAssembly references **relative nesting depth (Label Index)** rather than raw memory offsets. The immediately enclosing construct has a label depth of `0`, with each outer parent block incrementing by `1`:

| Opcode | Instruction | Immediate | Stack Transition | Branch Behavior |
| :---: | :--- | :--- | :--- | :--- |
| `0x0C` | `br` | `labelidx (u32)` | `[val*] -> ...` | Unconditional branch to target depth |
| `0x0D` | `br_if` | `labelidx (u32)` | `[val*, i32] -> [val*]` | Pops condition `i32`; branches if value $\neq 0$ |
| `0x0E` | `br_table` | `vec(labelidx) default_label` | `[val*, i32] -> ...` | Zero-overhead indexed jump table (`switch-case`) |
| `0x0F` | `return` | None | `[val*] -> ...` | Immediately returns from the active function |

### ⚠️ The Fundamental Rule: `block` vs `loop` Branch Semantics

This distinction is the single most common pitfall for compiler engineers targeting WebAssembly:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Inside a `block`: `br 0` is a BREAK    (branches forward to `end`)  │
│ 2. Inside a `loop`:  `br 0` is a CONTINUE (branches backward to start) │
└────────────────────────────────────────────────────────────────────────┘
```

```text
(block $B                        (loop $L
  ...                              ...
  br 0  ───┐                       br 0  ───┐ (repeats loop)
  ...      │                       ...      │
) <────────┘ (exits block)       ) <────────┘ (returns to loop header)
```

---

## 5.4 Verified Implementation Patterns

### 1. Breaking from a Block with a Return Value

If parameter `x == 0`, break out of the enclosing block carrying the value `42`; otherwise fall through and evaluate `100`:

```wat
(func (export "f") (param i32) (result i32)
  (block (result i32)
    local.get 0
    i32.eqz
    (if
      (then
        i32.const 42
        br 1             ;; Escapes if (depth 0) and block (depth 1) carrying value 42
      )
    )
    i32.const 100        ;; Fallthrough default
  )                      ;; End of block (yields i32)
)
```
- **Bytecode Sequence:** `02 7F 20 00 45 04 40 41 2A 0C 01 0B 41 E4 00 0B 0B`
- **Verified Execution:** `f(0) -> 42`, `f(5) -> 100`.

---

### 2. While-Loop Accumulator Pattern

Computes $\sum_{k=1}^n k$ via a structured backward loop:

```wat
(func (export "f") (param $n i32) (result i32)
  (local $sum i32)
  (loop
    local.get $n
    i32.eqz
    if
      local.get $sum
      return             ;; Terminate and return sum when n reaches 0
    end
    local.get $sum
    local.get $n
    i32.add
    local.set $sum       ;; sum += n
    local.get $n
    i32.const 1
    i32.sub
    local.set $n         ;; n -= 1
    br 0                 ;; br 0 inside a loop branches back to loop start
  )
  local.get $sum
)
```
- **Verified Execution:** `f(10) -> 55`.

---

### 3. Indexed Jump Tables via `br_table` (`switch-case`)

The `br_table` instruction consumes an `i32` index and dispatches to the corresponding relative label index, falling back to a default label if the index is out of bounds:

```text
br_table [label_0, label_1, ...] label_default
```

```wat
(func (export "f") (param i32) (result i32)
  (block $default
    (block $case1
      (block $case0
        local.get 0
        br_table 0 1 2   ;; Index 0 -> $case0, Index 1 -> $case1, else -> $default
      )
      i32.const 10
      return             ;; Case 0: returns 10
    )
    i32.const 20
    return               ;; Case 1: returns 20
  )
  i32.const 99           ;; Default: returns 99
)
```
- **Verified Execution:** `f(0) -> 10`, `f(1) -> 20`, `f(9) -> 99`.

---

## 5.5 Lowering Arbitrary C `goto` to Wasm: State-Machine Dispatch Loops

Because native C allows unrestricted `goto` branching across statements while WebAssembly forbids it, production clean-room compilers like `sld` employ a **State-Machine Dispatch Loop with a Virtual Program Counter (`$pc`)**:

### Target C Source:
```c
int state_calc(int x) {
    int acc = 0;
L1:
    acc += x;
    if (x > 10) goto L_END;
L2:
    x += 5;
    goto L1;
L_END:
    return acc;
}
```

### Compiler Lowering Architecture in `sld_wasm.c`:
1. Allocate a synthetic local register `$pc` (Program Counter) initialized to `0`.
2. Wrap all basic blocks within a single enclosing `loop $dispatch`.
3. Lower each C label into an `if ($pc == label_id)` conditional block.
4. Lower each `goto target_label` into:
   ```text
   i32.const target_label_id
   local.set $pc
   br 1  ;; Break out of current if-block and repeat loop $dispatch
   ```

```wat
(func (export "f") (param $x i32) (result i32)
  (local $acc i32)
  (local $pc i32)        ;; Virtual Program Counter register
  (loop $dispatch
    ;; Block L1 (pc == 0)
    local.get $pc
    i32.eqz
    (if
      local.get $acc
      local.get $x
      i32.add
      local.set $acc     ;; acc += x

      local.get $x
      i32.const 10
      i32.gt_s
      (if
        i32.const 2
        local.set $pc    ;; pc = 2 (L_END)
        br 2             ;; Branch to loop $dispatch
      )
      i32.const 1
      local.set $pc      ;; pc = 1 (fallthrough to L2)
      br 1               ;; Branch to loop $dispatch
    )

    ;; Block L2 (pc == 1)
    local.get $pc
    i32.const 1
    i32.eq
    (if
      local.get $x
      i32.const 5
      i32.add
      local.set $x       ;; x += 5
      i32.const 0
      local.set $pc      ;; pc = 0 (goto L1)
      br 1               ;; Branch to loop $dispatch
    )

    ;; Block L_END (pc == 2)
    local.get $pc
    i32.const 2
    i32.eq
    (if
      local.get $acc
      return             ;; Return accumulated result
    )
  )
  local.get $acc
)
```
- **Trace for $x = 2$:**  
  - Iteration 1 (L1): `acc = 2`, `x = 2 <= 10` $\rightarrow$ set `pc = 1` (L2).
  - Iteration 2 (L2): `x = 7` $\rightarrow$ set `pc = 0` (L1).
  - Iteration 3 (L1): `acc = 2 + 7 = 9`, `x = 7 <= 10` $\rightarrow$ set `pc = 1` (L2).
  - Iteration 4 (L2): `x = 12` $\rightarrow$ set `pc = 0` (L1).
  - Iteration 5 (L1): `acc = 9 + 12 = 21`, `x = 12 > 10` $\rightarrow$ set `pc = 2` (L_END).
  - Terminal Result: **21** (100% verified arithmetic parity).

---

## 5.6 Stack Polymorphism & The `unreachable` Invariant

When an instruction like `unreachable` (`0x00`), `return` (`0x0F`), or unconditional `br` (`0x0C`) executes, normal linear control flow ceases.

Under W3C validation semantics, the operand stack immediately enters a **Polymorphic State**:
- The validator allows subsequent dead-code instructions (up to the next matching `end` or `else`) to pop arbitrary types from the operand stack, treating the stack as universally satisfiable.
- Example:
  ```wat
  unreachable
  i32.add      ;; Passes validation! Although the stack lacks two i32 values,
               ;; unreachable marks the stack as polymorphic.
  ```

---

## Chapter 05 Summary

- WebAssembly enforces **Structured Control Flow** to guarantee linear validation, deterministic stack heights, and security sandboxing.
- Branch instructions reference relative label depths: **`br` inside `block` breaks forward; `br` inside `loop` branches backward to loop start**.
- Arbitrary C `goto` statements can be deterministically compiled to WebAssembly using a **State-Machine Dispatch Loop**.
- Blocks can consume operands and return values via `blocktype` signatures.
- Next Chapter: [Chapter 06: Linear Memory Model & Page Architecture](06-linear-memory.md).
