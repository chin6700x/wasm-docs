# บทที่ 14: โปรแกรมตัวอย่างที่ 2 — Mandelbrot Explorer (C → Wasm ด้วย Clang + Canvas)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026  
> อ้างอิง: [MDN — Compiling C/C++ to WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/C_to_Wasm) • [MDN — CanvasRenderingContext2D.putImageData()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData)

[⬅ บทที่ 13](13-example-sieve.md) | [สารบัญ](README.md) | [บทที่ 15 ➡](15-example-image-studio.md)

> [!NOTE]
> บทนี้ต่อยอดจากบทที่ 9 (Bare-Metal Clang) และบทที่ 8 (JS Integration) ไฟล์ทั้งหมด: [mandelbrot.c](examples/mandelbrot.c), [mandelbrot.html](examples/mandelbrot.html), [mandelbrot-test.js](examples/mandelbrot-test.js)

---

## 14.1 โจทย์

สร้าง **Mandelbrot Explorer** ที่ซูมได้ด้วยการคลิก โดยแยกหน้าที่ชัดเจน:

| ส่วน | ทำอะไร |
| :--- | :--- |
| **C → Wasm** | คำนวณจำนวนรอบ (iteration) ของทุกพิกเซล และเขียนสี RGBA ลง framebuffer ใน Linear Memory |
| **JavaScript** | ส่งพารามิเตอร์ (จุดศูนย์กลาง, ระดับซูม), อ่าน framebuffer, วาดลง `<canvas>` |

```
 คลิกเมาส์ ──► JS คำนวณ (cx, cy, scale) ──► wasm.render(...)
                                                │ เขียน RGBA ลง fb[] ใน Linear Memory
                                                ▼
 <canvas> ◄── putImageData ◄── Uint8ClampedArray(memory.buffer, get_fb(), W*H*4)
```

หลักการ: **ข้อมูลพิกเซลไม่ถูกคัดลอกข้ามขอบเขตระหว่างคำนวณ** JS สร้าง view ครอบหน่วยความจำของ Wasm เท่านั้น

---

## 14.2 อัลกอริทึม

จุด $c = c_r + c_i\,i$ อยู่ในเซต Mandelbrot ถ้าลำดับ

$$z_0 = 0,\qquad z_{n+1} = z_n^2 + c$$

ไม่หนีออกนอกวงรัศมี 2 เมื่อนับรอบจนครบ `max_iter` ถือว่าอยู่ในเซต (สีดำ) ถ้าหนีก่อน ใช้จำนวนรอบกำหนดสี

แยกเป็นส่วนจริง/จินตภาพ จะได้ไม่ต้องมีเลขเชิงซ้อนในภาษา C:

$$t = z_r^2 - z_i^2 + c_r,\quad z_i \leftarrow 2 z_r z_i + c_i,\quad z_r \leftarrow t$$

---

## 14.3 โค้ด C (Bare-Metal)

ส่วนสำคัญของ [mandelbrot.c](examples/mandelbrot.c) — ไม่มี `#include` เลย:

```c
#define MAX_W 800
#define MAX_H 600

static unsigned int fb[MAX_W * MAX_H];          // framebuffer อยู่ใน Linear Memory

unsigned int *get_fb(void) { return fb; }       // คืน offset ให้ JS

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

### รูปแบบสี RGBA

Wasm เป็น Little-Endian (บทที่ 6) ดังนั้นค่า `0xAABBGGRR` แบบ 32-บิต จะเรียงในหน่วยความจำเป็นไบต์ `R, G, B, A` พอดี ซึ่งตรงกับ `ImageData` ของ Canvas จึงไม่ต้องสลับไบต์:

```c
return 0xFF000000u | (b << 16) | (g << 8) | r;
```

---

## 14.4 คอมไพล์

```bash
wasm32-clang -O3 -nostdlib -Wl,--no-entry \
  -Wl,--export=mandel_iter -Wl,--export=render -Wl,--export=get_fb \
  -Wl,--strip-all -o mandelbrot.wasm mandelbrot.c
```

ผลลัพธ์ **945 ไบต์** ตรวจด้วย `wasm-objdump -x`:

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

สิ่งที่เห็นได้จากผลนี้:

- **`initial=31` หน้า** (≈ 2 MB) — `wasm-ld` จัดหน่วยความจำให้พอกับ `fb` (800×600×4 = 1.92 MB) เองโดยอัตโนมัติ
- ค่า `double` ถูกส่งผ่านเป็น `f64` ตรงๆ ไม่ต้องแปลง
- `unsigned long` บน `wasm32` ยาว **32 บิต** (ผลคืนเป็น `i32`) ผลรวมรอบที่เกิน $2^{32}$ จะวนกลับ ในตัวอย่างนี้ค่ายังน้อยกว่ามาก (≈ 47 ล้าน) จึงปลอดภัย

---

## 14.5 หน้าเว็บ

[mandelbrot.html](examples/mandelbrot.html) เรียกใช้ดังนี้ (ส่วนหลัก):

```javascript
const bytes = await (await fetch('mandelbrot.wasm')).arrayBuffer();
const wasm  = (await WebAssembly.instantiate(bytes)).instance.exports;

function draw() {
  wasm.render(W, H, maxIter, view.cx, view.cy, view.scale);

  // สร้าง view ใหม่ทุกครั้ง — กัน Detached Buffer (บทที่ 6)
  const pixels = new Uint8ClampedArray(wasm.memory.buffer, wasm.get_fb(), W * H * 4);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
}
```

> [!IMPORTANT]
> `fetch()` โหลดไฟล์ `.wasm` จาก `file://` ไม่ได้ ต้องเสิร์ฟผ่าน HTTP:
> ```bash
> cd wasm-docs/th/examples
> python3 -m http.server 8000
> # เปิด http://localhost:8000/mandelbrot.html
> ```

การโต้ตอบ: คลิกซ้าย = ซูมเข้า ณ จุดนั้น (`scale /= 2`), คลิกขวา = ซูมออก, สไลเดอร์ปรับ `max_iter`

---

## 14.6 การทดสอบ

รัน `node examples/mandelbrot-test.js` ชุดทดสอบทำสิ่งต่อไปนี้:

1. คอมไพล์ด้วย Clang
2. เทียบ `mandel_iter` กับ JS reference ที่ **750 จุด** — ต้องตรงกันทุกจุด (ทั้งสองฝั่งใช้ IEEE-754 double จึงให้ผลเหมือนกันทุกบิต)
3. `render` ขนาด 320×240 แล้วตรวจว่าทุกพิกเซลมี alpha = 255 และ **ผลรวมรอบตรงกับ JS** (3,849,664)
4. พิมพ์ภาพ ASCII จากผลจริง
5. วัดเวลา 640×480, `max_iter` = 300

ผลที่ได้บนเครื่องผู้เขียน:

```
mandel_iter ตรงกับ JS ทั้ง 750 จุด
ผลรวมรอบ 320x240 = 3849664 (ตรงกับ JS)
640x480, max_iter=300 → ~92 ms (รอบรวม 47,350,203)
```

> [!NOTE]
> ค่าเวลาเป็นผลจากเครื่องผู้เขียนเท่านั้น และงานนี้ V8 JIT ฝั่ง JS เองก็ทำได้ใกล้เคียง ข้อดีที่ชัดเจนของแนวทางนี้คือ **ผลลัพธ์ตรงกันทุกบิต**, ไบนารีเล็ก (945 ไบต์) และไม่มี glue code ใดๆ

---

## 14.7 แบบฝึกหัด

1. ทำสี smooth แทนสีเป็นขั้น (ต้องใช้ $\log$ — เขียนประมาณค่าเอง เพราะ `-nostdlib` ไม่มี `libm`)
2. เปลี่ยนเป็น **Julia set** โดยให้ $c$ คงที่ และ $z_0$ เป็นพิกัดพิกเซล
3. ใช้ SIMD (`f64x2` — บทที่ 12) คำนวณ 2 พิกเซลพร้อมกัน แล้วเทียบเวลา
4. ใช้ Web Workers + Shared Memory (บทที่ 12) แบ่งภาพเป็นแถบให้หลายเธรดช่วยกันคำนวณ

---

## 14.8 สรุปส่งท้ายชุดตัวอย่าง

| โปรแกรม | ภาษา | เครื่องมือ | ขนาด | จุดเรียนรู้หลัก |
| :--- | :--- | :--- | :---: | :--- |
| Sieve (บท 13) | WAT | `wat2wasm` | 233 B | หน่วยความจำ, ลูป `block`/`loop`, ตรวจขอบเขต |
| Mandelbrot (บท 14) | C | `wasm32-clang` | 945 B | Framebuffer ใน Linear Memory, `f64`, Canvas, Zero-copy |
| Image Studio (บท 15) | C | `wasm32-clang` | 8.5 KB | Double buffer, หมุน/ตัด/ย่อขยาย/ฟิลเตอร์, Undo |

---

[⬅ บทที่ 13: โปรแกรมตัวอย่างที่ 1 — Sieve](13-example-sieve.md) | [สารบัญหลัก](README.md) | [บทที่ 15 ➡](15-example-image-studio.md)
