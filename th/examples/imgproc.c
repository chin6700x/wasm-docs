/*
 * imgproc.c — ระบบประมวลผลภาพ (หมุน ตัด พลิก ย่อ/ขยาย ฟิลเตอร์) สำหรับ WebAssembly
 * Bare-Metal: ไม่ใช้ libc / libm / Emscripten
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * คอมไพล์:
 *   wasm32-clang -O3 -nostdlib -mbulk-memory -Wl,--no-entry -Wl,--strip-all \
 *     -o imgproc.wasm imgproc.c
 *
 * โมเดลการทำงาน (Double Buffer):
 *   JS เขียนพิกเซลลง src  ->  เรียกคำสั่ง (src -> dst)  ->  commit() คัดลอก dst กลับเป็น src
 *   พิกเซลเป็น RGBA 32-bit แบบ Little-Endian (0xAABBGGRR) ตรงกับ ImageData ของ Canvas
 *   ทุกคำสั่งคืน 0 เมื่อสำเร็จ และ -1 เมื่อพารามิเตอร์ไม่ถูกต้อง/ผลลัพธ์ใหญ่เกินบัฟเฟอร์
 */

#define WASM_EXPORT(n) __attribute__((export_name(n)))

#define MAX_DIM 4096
#define MAX_PIX 2200000u /* ~ 8.8 MB ต่อบัฟเฟอร์ รองรับภาพ 1024x1024 หมุนที่ 45 องศา */

typedef unsigned int u32;

static u32 src[MAX_PIX];
static u32 dst[MAX_PIX];
static int cur_w, cur_h; /* ขนาดภาพใน src */
static int out_w, out_h; /* ขนาดผลลัพธ์ใน dst */
static int ready;        /* 1 = คำสั่งล่าสุดสำเร็จ และ dst พร้อม commit */

/* ---------- ฟังก์ชันช่วย (ไม่พึ่ง libm) ---------- */

static int fits(int w, int h) {
    return w > 0 && h > 0 && w <= MAX_DIM && h <= MAX_DIM &&
           (unsigned long)w * (unsigned long)h <= MAX_PIX;
}

static int begin_out(int w, int h) {
    ready = 0;
    if (!fits(w, h)) return -1;
    out_w = w;
    out_h = h;
    ready = 1;
    return 0;
}

/* คืน -1 พร้อมยกเลิกสถานะ ready (ใช้กับการปฏิเสธพารามิเตอร์ก่อนเริ่มงาน) */
static int bad(void) {
    ready = 0;
    return -1;
}

static double my_fabs(double v) { return v < 0.0 ? -v : v; }

static double my_floor(double v) {
    long i = (long)v;
    return (double)((double)i > v ? i - 1 : i);
}

static int clamp255(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

#define PI 3.14159265358979323846

static double sin_taylor(double x) { /* |x| <= pi/2 */
    double x2 = x * x, t = x, s = x;
    for (int i = 1; i <= 9; i++) {
        t *= -x2 / (double)((2 * i) * (2 * i + 1));
        s += t;
    }
    return s;
}

static double cos_taylor(double x) { /* |x| <= pi/2 */
    double x2 = x * x, t = 1.0, s = 1.0;
    for (int i = 1; i <= 9; i++) {
        t *= -x2 / (double)((2 * i - 1) * (2 * i));
        s += t;
    }
    return s;
}

static double reduce_deg(double d) { /* -> [-180, 180] */
    return d - 360.0 * my_floor(d / 360.0 + 0.5);
}

WASM_EXPORT("sin_deg") double sin_deg(double d) {
    d = reduce_deg(d);
    if (d > 90.0) d = 180.0 - d;
    else if (d < -90.0) d = -180.0 - d;
    return sin_taylor(d * PI / 180.0);
}

WASM_EXPORT("cos_deg") double cos_deg(double d) {
    double sign = 1.0;
    d = reduce_deg(d);
    if (d > 90.0) { d = 180.0 - d; sign = -1.0; }
    else if (d < -90.0) { d = -180.0 - d; sign = -1.0; }
    return sign * cos_taylor(d * PI / 180.0);
}

/* ---------- เข้าถึงบัฟเฟอร์และสถานะ ---------- */

WASM_EXPORT("get_src") u32 *get_src(void) { return src; }
WASM_EXPORT("get_dst") u32 *get_dst(void) { return dst; }
WASM_EXPORT("cur_w") int get_cur_w(void) { return cur_w; }
WASM_EXPORT("cur_h") int get_cur_h(void) { return cur_h; }
WASM_EXPORT("out_w") int get_out_w(void) { return out_w; }
WASM_EXPORT("out_h") int get_out_h(void) { return out_h; }
WASM_EXPORT("max_pixels") u32 get_max_pixels(void) { return MAX_PIX; }

/* กำหนดขนาดภาพใน src (JS เขียนพิกเซลเอง) */
WASM_EXPORT("set_size") int set_size(int w, int h) {
    if (!fits(w, h)) return -1;
    cur_w = out_w = w;
    cur_h = out_h = h;
    return 0;
}

/* คัดลอก dst -> src แล้วใช้ขนาดผลลัพธ์เป็นขนาดปัจจุบัน */
WASM_EXPORT("commit") int commit(void) {
    if (!ready || !fits(out_w, out_h)) return -1;
    __builtin_memcpy(src, dst, (unsigned long)out_w * (unsigned long)out_h * 4u);
    cur_w = out_w;
    cur_h = out_h;
    ready = 0;
    return 0;
}

/* ---------- หมุน 90/180/270 ---------- */
/* mode: 1 = 90 ตามเข็ม, 2 = 180, 3 = 90 ทวนเข็ม */
WASM_EXPORT("rotate90") int rotate90(int mode) {
    int w = cur_w, h = cur_h;
    if (mode == 1 || mode == 3) { if (begin_out(h, w)) return -1; }
    else if (mode == 2)         { if (begin_out(w, h)) return -1; }
    else return bad();

    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            u32 p = src[y * w + x];
            if (mode == 1)      dst[x * out_w + (h - 1 - y)] = p;
            else if (mode == 2) dst[(h - 1 - y) * w + (w - 1 - x)] = p;
            else                dst[(w - 1 - x) * out_w + y] = p;
        }
    }
    return 0;
}

/* ---------- พลิก ---------- */
/* mode: 1 = แนวนอน (ซ้าย<->ขวา), 2 = แนวตั้ง (บน<->ล่าง) */
WASM_EXPORT("flip") int flip(int mode) {
    int w = cur_w, h = cur_h;
    if (mode != 1 && mode != 2) return bad();
    if (begin_out(w, h)) return -1;
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            dst[mode == 1 ? y * w + (w - 1 - x) : (h - 1 - y) * w + x] = src[y * w + x];
    return 0;
}

/* ---------- ตัด (clamp ให้อยู่ในภาพอัตโนมัติ) ---------- */
WASM_EXPORT("crop") int crop(int x, int y, int w, int h) {
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x >= cur_w || y >= cur_h || w <= 0 || h <= 0) return bad();
    if (w > cur_w - x) w = cur_w - x;
    if (h > cur_h - y) h = cur_h - y;
    if (begin_out(w, h)) return -1;
    for (int row = 0; row < h; row++)
        __builtin_memcpy(&dst[row * w], &src[(y + row) * cur_w + x], (unsigned long)w * 4u);
    return 0;
}

/* ---------- Bilinear sampling ---------- */
static u32 sample(const u32 *img, int w, int h, double sx, double sy) {
    if (sx < 0.0) sx = 0.0;
    if (sy < 0.0) sy = 0.0;
    if (sx > (double)(w - 1)) sx = (double)(w - 1);
    if (sy > (double)(h - 1)) sy = (double)(h - 1);
    int x0 = (int)sx, y0 = (int)sy;
    int x1 = x0 + 1 < w ? x0 + 1 : x0;
    int y1 = y0 + 1 < h ? y0 + 1 : y0;
    double fx = sx - (double)x0, fy = sy - (double)y0;
    double w00 = (1.0 - fx) * (1.0 - fy), w10 = fx * (1.0 - fy);
    double w01 = (1.0 - fx) * fy,         w11 = fx * fy;
    u32 p00 = img[y0 * w + x0], p10 = img[y0 * w + x1];
    u32 p01 = img[y1 * w + x0], p11 = img[y1 * w + x1];
    u32 out = 0;
    for (int c = 0; c < 4; c++) {
        int sh = c * 8;
        double v = (double)((p00 >> sh) & 255u) * w00 + (double)((p10 >> sh) & 255u) * w10 +
                   (double)((p01 >> sh) & 255u) * w01 + (double)((p11 >> sh) & 255u) * w11;
        out |= (u32)clamp255((int)(v + 0.5)) << sh;
    }
    return out;
}

/* ---------- หมุนมุมใดก็ได้ (องศา บวก = ตามเข็ม) ---------- */
WASM_EXPORT("rotate_any") int rotate_any(double deg, u32 bg) {
    if (deg != deg || deg > 1e9 || deg < -1e9) return bad(); /* NaN / มุมใหญ่เกินไป */
    double c = cos_deg(deg), s = sin_deg(deg);
    double fw = (double)cur_w, fh = (double)cur_h;
    double bw = my_fabs(fw * c) + my_fabs(fh * s) - 1e-6;
    double bh = my_fabs(fw * s) + my_fabs(fh * c) - 1e-6;
    int nw = (int)bw + (bw > (double)(int)bw ? 1 : 0);
    int nh = (int)bh + (bh > (double)(int)bh ? 1 : 0);
    if (begin_out(nw, nh)) return -1;

    double dcx = (double)(nw - 1) / 2.0, dcy = (double)(nh - 1) / 2.0;
    double scx = (fw - 1.0) / 2.0, scy = (fh - 1.0) / 2.0;
    double eps = 1e-3;
    for (int y = 0; y < nh; y++) {
        double dy = (double)y - dcy;
        for (int x = 0; x < nw; x++) {
            double dx = (double)x - dcx;
            double sx = dx * c + dy * s + scx;
            double sy = -dx * s + dy * c + scy;
            if (sx < -eps || sy < -eps || sx > fw - 1.0 + eps || sy > fh - 1.0 + eps)
                dst[y * nw + x] = bg;
            else
                dst[y * nw + x] = sample(src, cur_w, cur_h, sx, sy);
        }
    }
    return 0;
}

/* ---------- ย่อ/ขยาย (Bilinear, จัดกึ่งกลางพิกเซล) ---------- */
WASM_EXPORT("resize") int resize(int nw, int nh) {
    if (begin_out(nw, nh)) return -1;
    double rx = (double)cur_w / (double)nw, ry = (double)cur_h / (double)nh;
    for (int y = 0; y < nh; y++) {
        double sy = ((double)y + 0.5) * ry - 0.5;
        for (int x = 0; x < nw; x++) {
            double sx = ((double)x + 0.5) * rx - 0.5;
            dst[y * nw + x] = sample(src, cur_w, cur_h, sx, sy);
        }
    }
    return 0;
}

/* ---------- ปรับสี (ทีละพิกเซล) ---------- */
WASM_EXPORT("grayscale") int grayscale(void) {
    if (begin_out(cur_w, cur_h)) return -1;
    unsigned long n = (unsigned long)cur_w * (unsigned long)cur_h;
    for (unsigned long i = 0; i < n; i++) {
        u32 p = src[i];
        u32 r = p & 255u, g = (p >> 8) & 255u, b = (p >> 16) & 255u;
        u32 y = (r * 77u + g * 150u + b * 29u) >> 8; /* 77+150+29 = 256 */
        dst[i] = (p & 0xFF000000u) | (y << 16) | (y << 8) | y;
    }
    return 0;
}

/* v' = (v-128)*contrast_pct/100 + 128 + brightness   (contrast_pct 100 = ไม่เปลี่ยน) */
WASM_EXPORT("brightness_contrast") int brightness_contrast(int brightness, int contrast_pct) {
    if (begin_out(cur_w, cur_h)) return -1;
    unsigned long n = (unsigned long)cur_w * (unsigned long)cur_h;
    for (unsigned long i = 0; i < n; i++) {
        u32 p = src[i], out = p & 0xFF000000u;
        for (int c = 0; c < 3; c++) {
            int v = (int)((p >> (c * 8)) & 255u);
            v = ((v - 128) * contrast_pct) / 100 + 128 + brightness;
            out |= (u32)clamp255(v) << (c * 8);
        }
        dst[i] = out;
    }
    return 0;
}

WASM_EXPORT("invert") int invert(void) {
    if (begin_out(cur_w, cur_h)) return -1;
    unsigned long n = (unsigned long)cur_w * (unsigned long)cur_h;
    for (unsigned long i = 0; i < n; i++) {
        u32 p = src[i];
        dst[i] = (p & 0xFF000000u) | (~p & 0x00FFFFFFu);
    }
    return 0;
}

/* ---------- Convolution 3x3 (ขอบภาพใช้ clamp) ---------- */
/* kind: 1 = blur (Gaussian), 2 = sharpen, 3 = edge detect */
WASM_EXPORT("filter") int filter(int kind) {
    static const int K_BLUR[9]    = { 1, 2, 1, 2, 4, 2, 1, 2, 1 };
    static const int K_SHARPEN[9] = { 0, -1, 0, -1, 5, -1, 0, -1, 0 };
    static const int K_EDGE[9]    = { -1, -1, -1, -1, 8, -1, -1, -1, -1 };
    const int *k;
    int div;
    if (kind == 1)      { k = K_BLUR;    div = 16; }
    else if (kind == 2) { k = K_SHARPEN; div = 1; }
    else if (kind == 3) { k = K_EDGE;    div = 1; }
    else return bad();

    int w = cur_w, h = cur_h;
    if (begin_out(w, h)) return -1;
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            int acc[3] = { 0, 0, 0 };
            for (int j = -1; j <= 1; j++) {
                int yy = y + j;
                yy = yy < 0 ? 0 : (yy >= h ? h - 1 : yy);
                for (int i = -1; i <= 1; i++) {
                    int xx = x + i;
                    xx = xx < 0 ? 0 : (xx >= w ? w - 1 : xx);
                    u32 p = src[yy * w + xx];
                    int wt = k[(j + 1) * 3 + (i + 1)];
                    acc[0] += wt * (int)(p & 255u);
                    acc[1] += wt * (int)((p >> 8) & 255u);
                    acc[2] += wt * (int)((p >> 16) & 255u);
                }
            }
            u32 out = src[y * w + x] & 0xFF000000u;
            for (int c = 0; c < 3; c++) {
                int v = acc[c];
                if (div > 1) v = (v + div / 2) / div;
                out |= (u32)clamp255(v) << (c * 8);
            }
            dst[y * w + x] = out;
        }
    }
    return 0;
}
