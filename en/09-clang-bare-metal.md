# Chapter 09: Compiling C/C++ to Bare-Metal WebAssembly with Clang (No Emscripten)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [LLVM WebAssembly Documentation](https://llvm.org/docs/WebAssembly.html) • [LLD WebAssembly Port (wasm-ld)](https://lld.llvm.org/WebAssembly.html)

[⬅ Chapter 08](08-js-integration.md) | [Table of Contents](README.md) | [Chapter 10 ➡](10-sovereign-emitter.md)

> [!NOTE]
> The complete C source code and compilation pipeline generating a 711-byte (< 1 KB) production binary featured in this chapter can be inspected and verified immediately in [examples/bare-metal.c](examples/bare-metal.c) and [examples/bare-metal-test.js](examples/bare-metal-test.js).

---

## 9.1 Architectural Contrast: `emcc` vs. `clang --target=wasm32`

When compiling C or C++ to WebAssembly, developers frequently start with **Emscripten (`emcc`)**. While Emscripten is a powerhouse for legacy desktop application ports, fundamental architectural differences emerge when building sovereign micro-modules, cryptographic kernels, or embedded runtimes:

```
+------------------------------------+------------------------------------+
|          Emscripten (emcc)         |     Bare-Metal (clang -target)     |
+------------------------------------+------------------------------------+
| • Emulates POSIX OS atop browser   | • Emits pure, unadulterated Wasm   |
| • Virtual File System (MEMFS)      | • Zero filesystem, zero syscalls   |
| • Generates 50KB - 2MB JS glue code| • Tiny binary footprint: 200B - 2KB|
| • Best for porting C++/SDL/OpenGL  | • Best for crypto, parsers, codecs |
+------------------------------------+------------------------------------+
```

| Engineering Dimension | Emscripten (`emcc`) | Bare-Metal Clang (`wasm32-clang`) |
| :--- | :--- | :--- |
| **Minimum Binary Size** | Typically 15 KB – 100+ KB (bundled JS) | **200 Bytes – 1 KB** (Pure `.wasm`) |
| **JavaScript Dependency** | Mandatory bloated JS runtime glue | **Zero Glue Code**; transparent standard instantiation |
| **Compilation Speed** | Sub-optimal (multi-phase code synthesis) | **Sub-millisecond (< 50 ms)** |
| **Memory Allocation** | Hardcoded `dlmalloc` / `emmalloc` | **100% Developer-Controlled** |
| **Optimal Use Cases** | 3D WebGL games, legacy desktop ports | **Crypto, Parsers, Math engines, Sovereign compilers** |

---

## 9.2 The LLVM WebAssembly Architecture and `wasm-ld`

Since version 8, LLVM includes the native WebAssembly target backend (`wasm32` and `wasm64`) out of the box without third-party plugins.  
Compiling C into WebAssembly decomposes into two distinct phases:
1. **Frontend (`clang`):** Compiles C/C++ source code into LLVM intermediate representation (Bitcode) and WebAssembly object files (`.o`).
2. **Linker (`wasm-ld`):** Resolves symbols across object files, lays out memory segments (Static Data, Stack, Heap), and synthesizes standard W3C WebAssembly binary sections.

```
+---------------+      +-------------------+      +-------------+      +-----------------+
|  Source Code  | ───► |       Clang       | ───► |   wasm-ld   | ───► | Sub-1KB .wasm   |
| (bare-metal.c)|      | (--target=wasm32) |      |   Linker    |      | (Pure Hardware) |
+---------------+      +-------------------+      +-------------+      +-----------------+
```

### Essential Compiler and Linker Flags:

```bash
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=add -Wl,--export=fib \
  -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
  -Wl,--strip-all \
  -o app.wasm bare-metal.c
```

| Flag | Technical Role |
| :--- | :--- |
| **`--target=wasm32`** | Targets the 32-bit WebAssembly instruction set architecture |
| **`-O3`** | Aggressive compiler optimization: dead-code elimination, loop unrolling, and inlining |
| **`-nostdlib`** | Decouples the standard C library (prevents linking `libc.a` and `crt0.o`) |
| **`-Wl,--no-entry`** | Instructs `wasm-ld` to omit the `main()` entrypoint check (library mode) |
| **`-Wl,--export=symbol`** | Explicitly surfaces a C symbol into the WebAssembly Export Section |
| **`-Wl,--export-all`** | Surfaces all internal functions and global variables (testing/debug) |
| **`-Wl,--allow-undefined`** | Permits unresolved external symbols, automatically routing them to the Import Section |
| **`-Wl,--strip-all`** | Strips symbol debug tables (`name` custom section) to achieve minimum binary footprint |

---

## 9.3 Navigating the Libc-less Environment

Compiling with `-nostdlib` removes runtime dependencies on standard functions like `malloc()`, `free()`, `memcpy()`, and `printf()`. We construct clean, sovereign alternatives:

### 1. The Magic Symbol: `extern unsigned char __heap_base;`
When `wasm-ld` structures the module's linear memory layout, it places the static data section and call stack at the base, and exposes a synthetic linker symbol designated as **`__heap_base`** denoting the first safe offset of unallocated memory:

```
+----------------------+--------------------+---------------------------------------+
|  Static Data Segment | Stack (Grows Down) | Dynamic Heap Space (__heap_base)      |
|  (Constants/Strings) |                    | Safe allocation space begins here     |
+----------------------+--------------------+---------------------------------------+
0                                           ▲
                                            │
                                  extern unsigned char __heap_base;
```

### 2. A 10-Line Sovereign Bump Allocator in C:
```c
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

void* my_malloc(unsigned long size) {
    if (heap_top == 0) {
        heap_top = (unsigned long)&__heap_base;
    }
    unsigned long old = heap_top;
    // Align allocations to 8-byte boundaries: (old + size + 7) & ~7
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}
```

### 3. Basic Memory and String Utilities:
```c
void* my_memcpy(void* dest, const void* src, unsigned long n) {
    char* d = (char*)dest;
    const char* s = (const char*)src;
    while (n--) *d++ = *s++;
    return dest;
}

unsigned long my_strlen(const char* s) {
    const char* p = s;
    while (*p) p++;
    return (unsigned long)(p - s);
}
```

---

## 9.4 Case Study: A 711-Byte Production Sub-1KB Wasm Binary

Examining [bare-metal.c](examples/bare-metal.c), which implements:
- Core arithmetic algorithms (`add`, `fib`)
- High-efficiency bump allocator (`my_malloc`)
- In-place string reversal in linear memory (`reverse_c`)
- Vector dot product computation (`dot_product`)

```c
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

void* my_malloc(unsigned long size) {
    if (heap_top == 0) heap_top = (unsigned long)&__heap_base;
    unsigned long old = heap_top;
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}

int add(int a, int b) { return a + b; }

int fib(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b; a = b; b = c;
    }
    return b;
}

char* reverse_c(char* str, int len) {
    int i = 0, j = len - 1;
    while (i < j) {
        char temp = str[i]; str[i] = str[j]; str[j] = temp;
        i++; j--;
    }
    return str;
}

float dot_product(const float* a, const float* b, int n) {
    float sum = 0.0f;
    for (int i = 0; i < n; i++) sum += a[i] * b[i];
    return sum;
}
```

### Verification & Binary Footprint:
When compiled with the production flags:
```bash
wasm32-clang -O3 -nostdlib -Wl,--no-entry \
  -Wl,--export=add -Wl,--export=fib \
  -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
  -Wl,--export=reverse_c -Wl,--export=dot_product \
  -Wl,--strip-all -o bare-metal.wasm bare-metal.c
```

The resulting binary measures exactly **711 bytes** (< 1 KB)!  
It can be instantiated and executed inside any modern web browser or Node.js runtime with zero external runtime libraries or initialization glue code.

To verify live compilation and runtime execution assertions, inspect [examples/bare-metal-test.js](examples/bare-metal-test.js).

---

[⬅ Chapter 08: JavaScript Integration & Browser APIs](08-js-integration.md) | [Main Table of Contents](README.md) | [Chapter 10: Building a Sovereign WebAssembly Emitter ➡](10-sovereign-emitter.md)
