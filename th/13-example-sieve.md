# บทที่ 13: โปรแกรมตัวอย่างที่ 1 — Sieve of Eratosthenes ด้วย WAT ล้วน

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026  
> อ้างอิง: [MDN — Understanding WebAssembly text format](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format) • [W3C Core Spec — Text Format](https://webassembly.github.io/spec/core/text/index.html)

[⬅ บทที่ 12](12-modern-wasm.md) | [สารบัญ](README.md) | [บทที่ 14 ➡](14-example-mandelbrot.md)

> [!NOTE]
> บทนี้รวมความรู้จากบทที่ 3–8 มาสร้างโปรแกรมจริงหนึ่งโปรแกรมตั้งแต่ต้นจนจบ ไม่พึ่งคอมไพเลอร์ภาษาใดเลย โค้ดอยู่ที่ [examples/sieve.wat](examples/sieve.wat) และชุดทดสอบอยู่ที่ [examples/sieve-test.js](examples/sieve-test.js) (รันผ่านจริงบน V8 พร้อมตรวจกับ JS reference)

---

## 13.1 โจทย์

หาจำนวนเฉพาะทั้งหมดที่ไม่เกิน `n` ด้วยอัลกอริทึม **Sieve of Eratosthenes** โดยให้ Wasm เป็นผู้คำนวณ และให้ JavaScript อ่านผลลัพธ์จาก Linear Memory

| ฟังก์ชัน Export | ลายเซ็น | หน้าที่ |
| :--- | :--- | :--- |
| `sieve(n)` | `(i32) -> i32` | คืนจำนวนจำนวนเฉพาะที่ $\le n$ (คืน `-1` ถ้า $n \ge 65536$) |
| `is_prime(i)` | `(i32) -> i32` | คืน `1` หรือ `0` (ใช้ได้หลังเรียก `sieve`) |
| `memory` | Memory | ให้ JS อ่าน bitmap ได้โดยตรง |

---

## 13.2 การออกแบบหน่วยความจำ

ใช้ **1 ไบต์ต่อ 1 ตัวเลข** ที่แอดเดรส `i` (`1` = อาจเป็นจำนวนเฉพาะ, `0` = ไม่ใช่)

```
แอดเดรส:  0  1  2  3  4  5  6  7  8  9 ...
ค่า:      0  0  1  1  0  1  0  1  0  0 ...   (หลัง sieve(9))
```

หน่วยความจำ 1 หน้ามี 65,536 ไบต์ จึงรองรับ $n$ ได้สูงสุด 65,535 โปรแกรมจึงตรวจก่อนเสมอ:

```wat
(if (i32.ge_u (local.get $n) (i32.const 65536))
  (then (return (i32.const -1))))
```

> [!IMPORTANT]
> ถ้าไม่ตรวจขอบเขต การเขียนเกินหน่วยความจำจะเกิด `RuntimeError: memory access out of bounds` (บทที่ 6) เราเลือกปฏิเสธล่วงหน้าและคืน `-1` เพื่อให้ผู้เรียกจัดการได้

---

## 13.3 ตัวโปรแกรม (WAT)

ส่วนสำคัญของ [sieve.wat](examples/sieve.wat):

```wat
(module
  (memory (export "memory") 1)

  (func $sieve (export "sieve") (param $n i32) (result i32)
    (local $i i32) (local $j i32) (local $count i32)

    ;; 1) ตั้งต้นทุกช่อง [0..n] เป็น 1 ด้วย bulk-memory
    (memory.fill (i32.const 0) (i32.const 1) (i32.add (local.get $n) (i32.const 1)))
    (i32.store8 (i32.const 0) (i32.const 0))
    (if (i32.ge_u (local.get $n) (i32.const 1))
      (then (i32.store8 (i32.const 1) (i32.const 0))))

    ;; 2) วงนอก: i = 2; i*i <= n; i++
    (local.set $i (i32.const 2))
    (block $outer_done
      (loop $outer
        (br_if $outer_done
          (i32.gt_u (i32.mul (local.get $i) (local.get $i)) (local.get $n)))

        (if (i32.load8_u (local.get $i))
          (then
            ;; วงใน: j = i*i; j <= n; j += i  -> ขีดฆ่าตัวคูณ
            (local.set $j (i32.mul (local.get $i) (local.get $i)))
            (block $inner_done
              (loop $inner
                (br_if $inner_done (i32.gt_u (local.get $j) (local.get $n)))
                (i32.store8 (local.get $j) (i32.const 0))
                (local.set $j (i32.add (local.get $j) (local.get $i)))
                (br $inner)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))

    ;; 3) นับจำนวนเฉพาะ (ลูปธรรมดาแบบเดียวกัน) แล้วคืน $count
    ...))
```

### ทำไมโครงสร้างจึงเป็น `block` + `loop`?

ตามบทที่ 5 `br` ใน `loop` คือการวนกลับ ส่วน `br` ใน `block` คือการออกไปข้างหน้า จึงต้องซ้อนกันเป็นคู่ทุกครั้ง:

```
(block $done          ← br_if $done  = ออกจากลูป
  (loop $again        ← br $again    = วนซ้ำ
    ...))
```

### จุดที่ใช้ความรู้จากบทก่อนหน้า

| เทคนิคในโค้ด | บท |
| :--- | :--- |
| `i32.load8_u` / `i32.store8` — อ่านเขียน 1 ไบต์ | 6 |
| `memory.fill` — bulk memory เติมช่วงด้วยค่าเดียวใน 1 คำสั่ง | 4, 6 |
| `block` / `loop` / `br_if` — ลูปซ้อน | 5 |
| `i32.gt_u`, `i32.ge_u` — เทียบแบบ unsigned | 4 |
| export `memory` เพื่อให้ JS อ่านผลได้ | 8 |

---

## 13.4 คอมไพล์และตรวจสอบ

```bash
wat2wasm sieve.wat -o sieve.wasm     # ได้ไบนารี 233 ไบต์
wasm-validate sieve.wasm             # ผ่านเมื่อไม่มี error
wasm-objdump -x sieve.wasm           # ดู type / function / export
```

---

## 13.5 เรียกใช้จาก JavaScript

```javascript
import fs from 'node:fs';

const { instance } = await WebAssembly.instantiate(fs.readFileSync('sieve.wasm'));
const { sieve, is_prime, memory } = instance.exports;

console.log(sieve(100));      // 25
console.log(sieve(10000));    // 1229

// อ่าน bitmap จาก Linear Memory ได้โดยตรง (Zero-copy)
sieve(100);
const bitmap = new Uint8Array(memory.buffer, 0, 101);
const primes = [...bitmap.keys()].filter(i => bitmap[i]);
console.log(primes.join(' '));   // 2 3 5 7 11 13 ... 97
```

---

## 13.6 ผลการทดสอบจริง

รัน `node examples/sieve-test.js` ได้ผล:

```
π(10)    = 4
π(100)   = 25
π(1000)  = 168
π(10000) = 1229
π(65535) = 6542
sieve(65536) = -1   ← ถูกปฏิเสธก่อนเขียนเกินหน่วยความจำ
Wasm: 97.2 ms | JS: 113.3 ms   (n=65535, 2000 รอบ)
```

ชุดทดสอบเทียบทั้งค่านับและ **bitmap ทุกไบต์** กับ JS reference ที่ n = 1, 2, 10, 100, 1000, 10000, 65535

> [!NOTE]
> ตัวเลข benchmark ข้างบนเป็นผลบนเครื่องผู้เขียน (Apple Silicon, Node v24) เท่านั้น งานแบบนี้ V8 JIT ฝั่ง JS ก็เร็วมากอยู่แล้ว จึงไม่ได้ต่างกันมาก Wasm ได้เปรียบชัดเจนเมื่อโค้ดซับซ้อนขึ้นหรือต้องการผลที่คาดเดาได้แน่นอน (ดูบทที่ 14)

---

## 13.7 แบบฝึกหัด

1. เปลี่ยน bitmap เป็น **1 บิตต่อ 1 ตัวเลข** (ใช้ `i32.load8_u` + `i32.and` + `i32.shl`) เพื่อรองรับ $n$ ได้ถึงประมาณ 524,000 ในหน่วยความจำหน้าเดียว
2. เพิ่ม `memory.grow` เพื่อรองรับ $n$ ที่ใหญ่ขึ้นโดยอัตโนมัติ (อย่าลืม Detached Buffer — บทที่ 6)
3. เพิ่มฟังก์ชัน `nth_prime(k)` ที่คืนจำนวนเฉพาะลำดับที่ $k$

---

[⬅ บทที่ 12: Wasm ยุคใหม่และอนาคต](12-modern-wasm.md) | [สารบัญหลัก](README.md) | [บทที่ 14: โปรแกรมตัวอย่างที่ 2 — Mandelbrot ➡](14-example-mandelbrot.md)
