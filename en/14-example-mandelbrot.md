# Chapter 14: Example Project 02 — Mandelbrot Explorer (C → Wasm with Clang + Canvas)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [MDN — Compiling C/C++ to WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/C_to_Wasm) • [MDN — CanvasRenderingContext2D.putImageData()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData)

[⬅ Chapter 13](13-example-sieve.md) | [Table of Contents](README.md) | [Chapter 15 ➡](15-example-image-studio.md)

> [!NOTE]
> This chapter builds directly upon Chapter 09 (Bare-Metal Clang) and Chapter 08 (JS Integration). The full project files include: [mandelbrot.c](examples/mandelbrot.c), [mandelbrot.html](examples/mandelbrot.html), and [mandelbrot-test.js](examples/mandelbrot-test.js).

---

## 14.1 Specification & Architectural Boundaries

Construct an interactive **Mandelbrot Explorer** featuring click-to-zoom navigation, cleanly separating computational concerns:

| Subsystem | Functional Scope |
| :--- | :--- |
| **C → Wasm Kernel** | Computes escape iterations per pixel and writes 32-bit RGBA color words to a linear framebuffer |
| **JavaScript Host** | Collects viewport parameters (center coordinates, scale), reads the framebuffer, and blits to `<canvas>` |

```
 Mouse Click ──► JS calculates (cx, cy, scale) ──► wasm.render(...)
                                                    │ Writes RGBA words into fb[] in Linear Memory
                                                    ▼
   <canvas>  ◄── putImageData ◄── Uint8ClampedArray(memory.buffer, get_fb(), W*H*4)
```

Core Principle: **Zero-Copy Memory Pipeline**. Pixel data is never serialized or copied across FFI boundaries during computation. JavaScript merely constructs an uncopied TypedArray view over Wasm's Linear Memory.

---

## 14.2 The Escape-Time Algorithm

A complex point $c = c_r + c_i\,i$ belongs to the Mandelbrot set if the sequence:

$$z_0 = 0,\qquad z_{n+1} = z_n^2 + c$$

remains bounded within radius 2 ($|z| \le 2$). Reaching `max_iter` designates the point as interior (rendered black). Early escape determines the color gradient based on iteration count.

Expanding into real and imaginary components avoids external complex math dependencies in C:

$$t = z_r^2 - z_i^2 + c_r,\quad z_i \leftarrow 2 z_r z_i + c_i,\quad z_r \leftarrow t$$

---

## 14.3 Bare-Metal C Implementation

Key algorithmic segments from [mandelbrot.c](examples/mandelbrot.c) — written with zero standard headers (`#include`):

```c
#define MAX_W 800
#define MAX_H 600

static unsigned int fb[MAX_W * MAX_H];          // Framebuffer located in Linear Memory

unsigned int *get_fb(void) { return fb; }       // Returns memory offset to JavaScript

int mandel_iter(double cr, double ci, int max_iter) {
    double zr = 0.0, zi = 0.0;
    int i = 0;
    while (i < max_iter && zr * zr + zi * zi <= 4.0) {
        double t = zr * zr - zi * zi + cr;
        zi = 2.0 * zr * zi + ci;
        zr = t;
        i++;
    }
    return i;
}

unsigned long render(int width, int height, int max_iter,
                     double cx, double cy, double scale) {
    double step = scale / (double)width;
    double x0 = cx - scale / 2.0;
    double y0 = cy - step * (double)height / 2.0;
    unsigned long total = 0;
    for (int py = 0; py < height; py++) {
        double ci = y0 + step * (double)py;
        for (int px = 0; px < width; px++) {
            int it = mandel_iter(x0 + step * (double)px, ci, max_iter);
            total += (unsigned long)it;
            fb[py * width + px] = colorize(it, max_iter);
        }
    }
    return total;
}
```

### Endianness & RGBA Pixel Layout:
Because WebAssembly enforces Little-Endian byte storage (Chapter 06), packing a 32-bit integer as `0xAABBGGRR` stores consecutive bytes in memory as `[R, G, B, A]`. This aligns with the HTML Canvas `ImageData` memory layout, eliminating byte-swapping overhead:

```c
return 0xFF000000u | (b << 16) | (g << 8) | r;
```

---

## 14.4 Compilation & Binary Analysis

```bash
wasm32-clang -O3 -nostdlib -Wl,--no-entry \
  -Wl,--export=mandel_iter -Wl,--export=render -Wl,--export=get_fb \
  -Wl,--strip-all -o mandelbrot.wasm mandelbrot.c
```

The resulting binary measures **945 bytes**. Inspection via `wasm-objdump -x`:

```
Type[3]:
 - type[0] () -> i32
 - type[1] (f64, f64, i32) -> i32
 - type[2] (i32, i32, i32, f64, f64, f64) -> i32
Memory[1]:
 - memory[0] pages: initial=31
Export[4]: memory, get_fb, mandel_iter, render
Code[3]:  get_fb=8 B, mandel_iter=114 B, render=728 B
```

Key Insights:
- **`initial=31` pages** (≈ 2 MB) — `wasm-ld` automatically sizes initial memory to allocate `fb` static array storage ($800 \times 600 \times 4 = 1.92\text{ MB}$).
- IEEE-754 `double` values map directly to `f64` primitives with zero marshaling conversions.
- `unsigned long` on `wasm32` is a 32-bit unsigned integer (returns `i32`).

---

## 14.5 Interactive Web Front-End

Core browser integration from [mandelbrot.html](examples/mandelbrot.html):

```javascript
const bytes = await (await fetch('mandelbrot.wasm')).arrayBuffer();
const wasm  = (await WebAssembly.instantiate(bytes)).instance.exports;

function draw() {
  wasm.render(W, H, maxIter, view.cx, view.cy, view.scale);

  // Construct fresh view on every render to guard against Detached Buffers (Chapter 06)
  const pixels = new Uint8ClampedArray(wasm.memory.buffer, wasm.get_fb(), W * H * 4);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
}
```

> [!IMPORTANT]
> The browser security model restricts `fetch()` requests on the `file://` scheme. Serve the application over local HTTP:
> ```bash
> cd wasm-docs/en/examples
> python3 -m http.server 8000
> # Open http://localhost:8000/mandelbrot.html
> ```

Interaction Scheme: Left-click centers and zooms in (`scale /= 2`), right-click zooms out, slider controls `max_iter`.

---

## 14.6 Empirical Verification Suite

Executing `node examples/mandelbrot-test.js` runs:

1. Clang compilation pipeline validation.
2. Cross-checks `mandel_iter` against a JavaScript reference across **750 test points** — achieving 100% bit-exact equivalence under IEEE-754 double-precision arithmetic.
3. Renders a $320 \times 240$ frame and verifies all pixels have alpha = 255 and cumulative iteration counts match JS reference exactly (3,849,664).
4. Generates an ASCII render preview.
5. Benchmarks execution for a $640 \times 480$ frame at `max_iter = 300`.

Empirical Benchmark Output:

```
mandel_iter matches JS reference across all 750 sample points
Total iterations for 320x240 frame = 3,849,664 (exact match)
640x480, max_iter=300 → ~92 ms (47,350,203 cumulative iterations)
```

Advantages: **Bit-for-bit mathematical determinism**, sub-1KB binary footprint (945 bytes), and zero runtime glue dependencies.

---

## 14.7 Advanced Engineering Exercises

1. Implement continuous smooth fractional coloring instead of stepped iteration banding (requires estimating $\log$ without `libm` in `-nostdlib`).
2. Adapt the algorithm to render the **Julia Set** by fixing $c$ and mapping initial coordinates to $z_0$.
3. Accelerate inner loops with SIMD vectorization (`f64x2`; see Chapter 12), computing 2 complex points per instruction.
4. Distribute frame row bands across multiple Web Workers using SharedArrayBuffer concurrency (Chapter 12).

---

## 14.8 Practical Example Suite Matrix

| Project | Source Language | Toolchain | Size | Key Architectural Takeaways |
| :--- | :--- | :--- | :---: | :--- |
| **Sieve** (Ch 13) | WAT | `wat2wasm` | 233 B | Stack machine, `block`/`loop` control, memory bounds |
| **Mandelbrot** (Ch 14) | C | `wasm32-clang` | 945 B | Linear Memory framebuffer, `f64`, Canvas zero-copy |
| **Image Studio** (Ch 15) | C | `wasm32-clang` | 8.5 KB | Double-buffering, 3x3 convolution kernels, inverse transforms, Undo stack |

---

[⬅ Chapter 13: Example 01 — Sieve of Eratosthenes](13-example-sieve.md) | [Main Table of Contents](README.md) | [Chapter 15: Example 03 — Image Processing Studio ➡](15-example-image-studio.md)
