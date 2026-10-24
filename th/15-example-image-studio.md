# บทที่ 15: โปรแกรมตัวอย่างที่ 3 — Wasm Image Studio (หมุน ตัด ย่อ/ขยาย และฟิลเตอร์ภาพ)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026  
> อ้างอิง: [MDN — ImageData](https://developer.mozilla.org/en-US/docs/Web/API/ImageData) • [MDN — CanvasRenderingContext2D.getImageData()](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData)

[⬅ บทที่ 14](14-example-mandelbrot.md) | [สารบัญ](README.md)

> [!NOTE]
> บทนี้รวมความรู้บทที่ 8 (JS Integration), 9 (Bare-Metal Clang) และ 14 (Canvas) เป็นระบบแก้ไขภาพจริง ไฟล์ทั้งหมด: [imgproc.c](examples/imgproc.c), [imgproc.html](examples/imgproc.html), [imgproc-test.js](examples/imgproc-test.js)

---

## 15.1 โจทย์และฟีเจอร์

ให้ผู้ใช้อัปโหลดภาพ แล้วให้ **Wasm ประมวลผลพิกเซลทั้งหมด** ส่วน JS ทำหน้าที่แค่ UI และวาดลง `<canvas>`

| กลุ่ม | ฟังก์ชันที่ export | รายละเอียด |
| :--- | :--- | :--- |
| หมุน | `rotate90(mode)` | 1 = 90° CW, 2 = 180°, 3 = 90° CCW (ตรงเป๊ะ ไม่มีการสุ่มค่า) |
| หมุนมุมใดก็ได้ | `rotate_any(deg, bg)` | ขยายแคนวาสให้พอดี + bilinear + สีพื้นหลัง `bg` |
| พลิก | `flip(mode)` | 1 = แนวนอน, 2 = แนวตั้ง |
| ตัด | `crop(x,y,w,h)` | บีบให้อยู่ในภาพ ป้องกัน integer overflow |
| ปรับขนาด | `resize(w,h)` | bilinear แบบจัดแนวกึ่งกลางพิกเซล |
| สี | `grayscale`, `invert`, `brightness_contrast(b, c)` | `c` = 100 คือไม่เปลี่ยน |
| ฟิลเตอร์ | `filter(1\|2\|3)` | 1 = blur, 2 = sharpen, 3 = edge detect (kernel 3×3) |

---

## 15.2 สถาปัตยกรรม: Double Buffer ใน Linear Memory

```
 JS: ImageData ──copy──▶ [ src ]  ── op ──▶ [ dst ] ──commit()──▶ [ src ]
                          ▲                    │
                          └──── get_src()      └── get_dst() ──▶ putImageData
```

- `src` และ `dst` เป็นอาร์เรย์ `u32` แบบ static ขนาด `MAX_PIX` = 2,200,000 พิกเซล (≈ 8.8 MB ต่อบัฟเฟอร์)
- พิกเซลเก็บเป็น `0xAABBGGRR` แบบ Little-Endian ซึ่ง **ตรงกับเลย์เอาต์ของ `ImageData`** จึงคัดลอกทั้งก้อนได้เลยไม่ต้องแปลง
- ทุกการดำเนินการเขียนผลลง `dst` แล้วคืน `0` (สำเร็จ) หรือ `-1` (ถูกปฏิเสธ) พร้อมตั้ง `out_w()`/`out_h()`
- `commit()` คัดลอก `dst → src` เพื่อต่อโซ่การแก้ไข และ **ใช้ได้เฉพาะเมื่อ op ล่าสุดสำเร็จ** (ธง `ready`; ฟังก์ชันช่วย `bad()` จะล้างธงเมื่อพารามิเตอร์ถูกปฏิเสธ) กันการ commit ข้อมูลค้างเก่า

> [!IMPORTANT]
> Wasm ไม่มี `malloc` ในบทนี้ จึงจองบัฟเฟอร์แบบ static ตามขนาดสูงสุด ผลลัพธ์ที่ใหญ่เกิน `MAX_PIX` หรือ `MAX_DIM` (4096) จะถูกปฏิเสธด้วย `-1` ไม่เขียนเกินขอบเขตหน่วยความจำ

**ขนาดหน่วยความจำ:** ไบนารีประกาศเริ่มต้น 270 หน้า (≈ 17 MB) พอสำหรับสองบัฟเฟอร์ ฝั่งเว็บจึงย่อภาพให้ไม่เกิน 1024 px ตอนโหลด เพื่อให้หมุนที่มุมใดก็ยังไม่เกิน `MAX_PIX` (1024×1024 หมุน 45° ได้ราว 1448×1448 ≈ 2.1 ล้านพิกเซล)

---

## 15.3 อัลกอริทึมหลัก

### หมุน 90° / พลิก / ตัด
เป็นการแมปดัชนีล้วนๆ เช่น 90° CW: พิกเซล `(x, y)` ของต้นฉบับไปอยู่ที่ `(h-1-y, x)` ในภาพขนาด `h × w` ทำให้ผลตรงทุกบิต `crop` บีบสี่เหลี่ยมให้อยู่ในภาพก่อนคำนวณ และตรวจด้วยเลขที่ไม่ overflow

### หมุนมุมใดก็ได้ (Inverse Mapping)
1. คำนวณกรอบใหม่: $W' = |w\cos\theta| + |h\sin\theta|$, $H' = |w\sin\theta| + |h\cos\theta|$
2. สำหรับทุกพิกเซลปลายทาง หมุน **ย้อนกลับ** ไปหาพิกัดในต้นฉบับ
3. สุ่มค่าด้วย bilinear ถ้าตกนอกภาพใช้สีพื้นหลัง

เพราะ `-nostdlib` ไม่มี `libm` จึงเขียน `sin_deg`/`cos_deg` เองด้วย **Taylor series** หลังลดช่วงมุมเป็น [−45°, 45°] — ทดสอบแล้วคลาดเคลื่อนสูงสุดราว 4×10⁻¹⁵ เทียบกับ `Math.sin/cos` นอกจากนี้ปฏิเสธ `NaN` และ `|deg| > 1e9`

### ปรับขนาด (Bilinear)
แมปพิกัดแบบกึ่งกลางพิกเซล: $s = (d + 0.5)\cdot\frac{S}{D} - 0.5$ แล้วเฉลี่ย 4 พิกเซลข้างเคียง (บีบที่ขอบ)

### สีและฟิลเตอร์
- Grayscale: $Y = (77R + 150G + 29B) \gg 8$
- Brightness/Contrast: $v' = \text{clamp}\big((v-128)\cdot c/100 + 128 + b\big)$
- Blur: kernel $\frac{1}{16}\begin{bmatrix}1&2&1\\2&4&2\\1&2&1\end{bmatrix}$ ; Sharpen / Edge ใช้ kernel 3×3 แบบ clamp-to-edge
- ทุกฟังก์ชันคงช่อง Alpha ไว้

---

## 15.4 คอมไพล์

```bash
wasm32-clang -O3 -nostdlib -mbulk-memory \
  -Wl,--no-entry -Wl,--strip-all \
  -o imgproc.wasm imgproc.c
# ได้ imgproc.wasm = 8,549 ไบต์
```

---

## 15.5 เชื่อมต่อจาก JavaScript

```js
const { instance } = await WebAssembly.instantiateStreaming(fetch('imgproc.wasm'));
const w = instance.exports;

// 1) ส่งภาพเข้า Wasm
function load(imageData) {
  w.set_size(imageData.width, imageData.height);
  new Uint8ClampedArray(w.memory.buffer, w.get_src(), imageData.data.length)
    .set(imageData.data);
}

// 2) รัน op แล้ววาดผล
function show(ctx, canvas) {
  const W = w.out_w(), H = w.out_h();
  canvas.width = W; canvas.height = H;
  // สร้าง view ใหม่ทุกครั้ง (กัน Detached Buffer หลัง memory.grow)
  const px = new Uint8ClampedArray(w.memory.buffer, w.get_dst(), W * H * 4);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
}

if (w.rotate90(1) === 0) { w.commit(); show(ctx, canvas); }
```

ฝั่ง UI ใน `imgproc.html` เก็บ **ประวัติ Undo** (สูงสุด 25 ขั้น) โดย snapshot ภาพก่อนทุกการแก้ไข มีปุ่ม Reset, ดาวน์โหลด PNG, ลากเลือกพื้นที่เพื่อ crop, ปุ่ม crop อัตราส่วน 1:1 / 4:3 / 16:9 และ resize แบบล็อกสัดส่วน

---

## 15.6 วิธีรัน

```bash
cd wasm-docs/th/examples
python3 -m http.server 8091
# เปิด http://localhost:8091/imgproc.html
```

> [!WARNING]
> ต้องเปิดผ่าน HTTP เท่านั้น — `fetch` ไฟล์ `.wasm` จาก `file://` จะไม่ทำงาน

---

## 15.7 ผลทดสอบ

```bash
node imgproc-test.js
```

ชุดทดสอบเทียบกับ reference ที่เขียนใน JS แยกอิสระ และผ่านทุกข้อ:

- `sin_deg`/`cos_deg` แม่นยำเทียบ `Math`
- `rotate90`, `flip`, `crop` ตรง reference รวมกรณีขอบ
- `rotate_any` ที่ 90/180/270/−90 **ตรงกับ `rotate90` ทุกพิกเซล**, 0°/360° คงเดิม, 45° ของ 101×101 → 143×143 (พื้นที่ภาพคงอยู่ 97.5%)
- ผลที่ใหญ่เกินบัฟเฟอร์ถูกปฏิเสธ (`-1`)
- `resize`, `grayscale`, `invert`, `brightness_contrast`, `blur`, `sharpen`, `edge` ตรงทุกพิกเซล
- โซ่ crop → rotate → flip → resize → blur ด้วย `commit`

ภาพ 1024×1024 (เครื่องผู้เขียน Apple Silicon): rotate90 ≈ 3 ms, rotate_any(30°) ≈ 10 ms, resize→512 ≈ 3 ms, blur ≈ 10–15 ms, grayscale ≈ 2 ms

> [!NOTE]
> ตัวเลขเวลาขึ้นกับเครื่อง ส่วนหน้า UI ผู้เขียนตรวจด้วย Headless Chrome ผ่าน CDP (หมุน, undo, พลิก, หมุน 30°, ลากครอป, ขยาย 200%, ฟิลเตอร์, ปฏิเสธขนาดเกิน, reset — ไม่มี JS error)

---

## 15.8 แบบฝึกหัด

1. ใช้ SIMD (`v128`, บทที่ 12) ทำ grayscale / invert ครั้งละ 4 พิกเซล แล้วเทียบเวลา
2. อ่านค่า EXIF Orientation ใน JS แล้วเรียก `rotate90` ให้อัตโนมัติ
3. เพิ่ม perspective crop (homography 3×3)
4. ย้ายการประมวลผลไป Web Worker พร้อม `SharedArrayBuffer` เพื่อไม่ให้ UI ค้าง
5. เพิ่ม Gaussian blur รัศมีปรับได้ (แยกแนวนอน/แนวตั้ง)

---

[⬅ บทที่ 14: โปรแกรมตัวอย่างที่ 2 — Mandelbrot](14-example-mandelbrot.md) | [สารบัญหลัก](README.md)
