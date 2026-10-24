# Chapter 15: Example Project 03 — Wasm Image Studio (Rotate, Crop, Resize & Filters)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [MDN — ImageData](https://developer.mozilla.org/en-US/docs/Web/API/ImageData) • [MDN — CanvasRenderingContext2D.getImageData()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData)

[⬅ Chapter 14](14-example-mandelbrot.md) | [Table of Contents](README.md)

> [!NOTE]
> This chapter combines architectural principles from Chapter 08 (JS Integration), Chapter 09 (Bare-Metal Clang), and Chapter 14 (Canvas Framebuffers) into a production-ready image manipulation suite. Full project source files: [imgproc.c](examples/imgproc.c), [imgproc.html](examples/imgproc.html), and [imgproc-test.js](examples/imgproc-test.js).

---

## 15.1 Architectural Blueprint & Feature Matrix

The user uploads an image; the **WebAssembly module executes all pixel processing operations**, while JavaScript manages UI events, canvas interactions, and undo state history:

| Category | Exported Primitive | Functional Specification |
| :--- | :--- | :--- |
| **Orthogonal Rotation** | `rotate90(mode)` | `1` = 90° CW, `2` = 180°, `3` = 90° CCW (bit-exact index mapping, zero sampling) |
| **Arbitrary Rotation** | `rotate_any(deg, bg)` | Auto-expands bounding box + bilinear interpolation + fills background `bg` |
| **Flip Reflection** | `flip(mode)` | `1` = Horizontal mirror, `2` = Vertical flip |
| **Bounding Crop** | `crop(x,y,w,h)` | Clamps to source bounds with overflow protection |
| **Bilinear Resample** | `resize(w,h)` | Pixel-center aligned bilinear interpolation |
| **Color Processing** | `grayscale`, `invert`, `brightness_contrast(b, c)` | Gamma-neutral luminance mapping; `c = 100` leaves contrast unchanged |
| **Spatial Filtering** | `filter(1\|2\|3)` | `1` = Gaussian blur, `2` = Sharpen, `3` = Sobel edge detection ($3 \times 3$ kernels) |

---

## 15.2 Double-Buffer Architecture in Linear Memory

```
 JS: ImageData ──copy──▶ [ src ]  ── op ──▶ [ dst ] ──commit()──▶ [ src ]
                          ▲                    │
                          └──── get_src()      └── get_dst() ──▶ putImageData
```

- `src` and `dst` are static `u32` pixel arrays sized to `MAX_PIX` = 2,200,000 pixels (≈ 8.8 MB per buffer).
- Packed Little-Endian `0xAABBGGRR` words mirror the physical memory layout of browser **`ImageData`** views, allowing direct zero-copy transfers.
- Every transformation writes its output into `dst` and returns `0` (success) or `-1` (rejected invalid inputs), establishing `out_w()` and `out_h()`.
- The `commit()` primitive swaps or copies `dst → src` to chain sequential edits. It executes strictly when the prior operation succeeded (managed via an internal `ready` guard flag; the `bad()` helper resets readiness on rejected arguments).

> [!IMPORTANT]
> To operate without runtime heap managers (`malloc`), memory is statically reserved. Operations whose transformed dimensions exceed `MAX_PIX` or `MAX_DIM` (4096) are rejected cleanly with `-1`, preventing memory corruption.

**Linear Memory Footprint:** The module declares 270 initial pages (≈ 17 MB), accommodating both double-buffers. The web client clamps uploaded dimensions to $\le 1024\text{ px}$, ensuring arbitrary rotations remain safely within `MAX_PIX` ($1024 \times 1024$ rotated 45° yields $\approx 1448 \times 1448 \approx 2.1\text{M pixels}$).

---

## 15.3 Core Transformation Algorithms

### 1. Orthogonal Rotation & Reflection
Index mapping transforms are bit-exact. For instance, 90° CW maps source pixel `(x, y)` to destination `(h - 1 - y, x)` in an output bounding box of dimensions `h × w`. `crop` clamps target coordinates defensively to prevent integer wrap-around.

### 2. Arbitrary Rotation (Inverse Mapping)
1. Compute expanded bounding envelope: $W' = |w\cos\theta| + |h\sin\theta|$, $H' = |w\sin\theta| + |h\cos\theta|$.
2. For each destination pixel, project coordinates **backwards (inverse mapping)** into source space.
3. Sample using bilinear interpolation; assign background color `bg` if coordinates fall outside source boundaries.

Because `-nostdlib` decouples `libm`, trigonometry functions (`sin_deg`, `cos_deg`) are implemented via **Taylor series approximations** after range-reducing angles to $[ -45^\circ, +45^\circ ]$, achieving numerical precision within $4 \times 10^{-15}$ of `Math.sin/cos`. Non-finite numbers (`NaN`, $\pm\infty$) and $|deg| > 10^9$ are rejected upfront.

### 3. Bilinear Resampling
Uses center-pixel coordinate projection: $s = (d + 0.5) \cdot \frac{S}{D} - 0.5$, sampling weighted contributions from 4 neighboring pixels with boundary edge clamping.

### 4. Color Grading & Spatial Convolutions
- **Grayscale:** $Y = (77R + 150G + 29B) \gg 8$
- **Brightness & Contrast:** $v' = \text{clamp}\big((v - 128) \cdot c / 100 + 128 + b\big)$
- **Blur:** Kernel $\frac{1}{16}\begin{bmatrix}1&2&1\\2&4&2\\1&2&1\end{bmatrix}$; Sharpen & Edge Detection apply clamp-to-edge boundary conditions.
- Preserves the Alpha channel across all transforms.

---

## 15.4 Bare-Metal Clang Compilation

```bash
wasm32-clang -O3 -nostdlib -mbulk-memory \
  -Wl,--no-entry -Wl,--strip-all \
  -o imgproc.wasm imgproc.c
# Generates production binary imgproc.wasm = 8,549 bytes
```

---

## 15.5 JavaScript Integration & Host Control

```javascript
const { instance } = await WebAssembly.instantiateStreaming(fetch('imgproc.wasm'));
const w = instance.exports;

// 1) Push frame into Wasm Linear Memory
function load(imageData) {
  w.set_size(imageData.width, imageData.height);
  new Uint8ClampedArray(w.memory.buffer, w.get_src(), imageData.data.length)
    .set(imageData.data);
}

// 2) Execute operation and blit destination back to Canvas
function show(ctx, canvas) {
  const W = w.out_w(), H = w.out_h();
  canvas.width = W; canvas.height = H;
  // Re-acquire memory view on each paint to guard against Detached Buffers
  const px = new Uint8ClampedArray(w.memory.buffer, w.get_dst(), W * H * 4);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
}

if (w.rotate90(1) === 0) {
  w.commit();
  show(ctx, canvas);
}
```

The accompanying [imgproc.html](examples/imgproc.html) frontend maintains an **Undo Stack** (retaining 25 history frames), PNG download facilities, interactive drag-to-crop controls, aspect ratio presets (1:1, 4:3, 16:9), and proportional resampling sliders.

---

## 15.6 Launching the Studio

```bash
cd wasm-docs/en/examples
python3 -m http.server 8091
# Open http://localhost:8091/imgproc.html
```

> [!WARNING]
> WebAssembly streaming instantiation requires valid HTTP headers. Serving via `file://` will trigger CORS security blocks in modern browsers.

---

## 15.7 Automated Verification Harness

Run the verification test suite:
```bash
node examples/imgproc-test.js
```

Validation assertions compared against an independent JavaScript reference:
- Trigonometric approximations (`sin_deg`/`cos_deg`) match hardware double precision.
- `rotate90`, `flip`, and `crop` match reference bitmaps across boundary conditions.
- `rotate_any` at 90°, 180°, 270°, and −90° produces **pixel-exact outputs identical to `rotate90`**; 0° and 360° preserve identical bitstreams; 45° rotation of a $101 \times 101$ frame yields $143 \times 143$ pixels (97.5% area conservation).
- Frame dimensions exceeding maximum capacity fail safely (`-1`).
- `resize`, `grayscale`, `invert`, `brightness_contrast`, `blur`, `sharpen`, and `edge` achieve 100% bit-exact equivalence.
- Pipeline chaining (`crop` → `rotate` → `flip` → `resize` → `blur`) via `commit()` executes deterministically.

Benchmark figures for a $1024 \times 1024$ image (Apple Silicon): `rotate90` ≈ 3 ms, `rotate_any(30°)` ≈ 10 ms, `resize` to 512px ≈ 3 ms, `blur` ≈ 12 ms, `grayscale` ≈ 2 ms.

---

## 15.8 Advanced Engineering Exercises

1. Accelerate `grayscale` and `invert` with 128-bit SIMD (`v128`; Chapter 12), processing 4 pixels per instruction.
2. Parse EXIF orientation tags in JavaScript to trigger automatic `rotate90` alignment.
3. Implement perspective homography warping via $3 \times 3$ matrix transforms.
4. Offload heavy convolution kernels to background Web Workers utilizing `SharedArrayBuffer` to eliminate UI stutter.
5. Implement variable-radius 2D separable Gaussian blur passes.

---

[⬅ Chapter 14: Example 02 — Mandelbrot Explorer](14-example-mandelbrot.md) | [Main Table of Contents](README.md)
