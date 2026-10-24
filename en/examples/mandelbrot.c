/*
 * mandelbrot.c — Bare-metal WebAssembly Mandelbrot renderer (No libc, No Emscripten)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * Compilation:
 *   wasm32-clang -O3 -nostdlib -Wl,--no-entry \
 *     -Wl,--export=mandel_iter -Wl,--export=render -Wl,--export=get_fb \
 *     -Wl,--strip-all -o mandelbrot.wasm mandelbrot.c
 *
 * Framebuffer is 32-bit RGBA (little-endian: 0xAABBGGRR), matching HTML Canvas ImageData
 */

#define MAX_W 800
#define MAX_H 600

static unsigned int fb[MAX_W * MAX_H];

/* Returns pointer (byte offset in Linear Memory) of the framebuffer */
unsigned int *get_fb(void) { return fb; }

/* Iteration count before escaping radius 2 (or max_iter if within set) */
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

/* Procedural color palette without external math library dependencies */
static unsigned int colorize(int iter, int max_iter) {
    if (iter >= max_iter) return 0xFF000000u; /* In set = black */
    unsigned int t = (unsigned int)(iter * 255 / max_iter);
    unsigned int r = (t * 9u) & 0xFFu;
    unsigned int g = (t * 5u + 40u) & 0xFFu;
    unsigned int b = 80u + (t * 7u) / 2u;
    if (b > 255u) b = 255u;
    return 0xFF000000u | (b << 16) | (g << 8) | r;
}

/* Renders frame of size width x height into framebuffer
 * (cx, cy) = center coordinates in complex plane, scale = complex plane viewport width
 * Returns cumulative iteration total across all pixels (for verification / benchmarks) */
unsigned long render(int width, int height, int max_iter,
                     double cx, double cy, double scale) {
    if (width > MAX_W) width = MAX_W;
    if (height > MAX_H) height = MAX_H;
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
