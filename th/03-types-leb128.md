# บทที่ 3: ระบบประเภทข้อมูลและการเข้ารหัส LEB128

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026
> อ้างอิง: [Core Spec — Types](https://webassembly.github.io/spec/core/syntax/types.html) • [Binary — Values](https://webassembly.github.io/spec/core/binary/values.html)

[⬅ บทที่ 2](02-binary-format.md) | [สารบัญ](README.md) | [บทที่ 4 ➡](04-instruction-set.md)

---

## 3.1 Value Types

| ชนิด | รหัสไบต์ | ขนาด | หมายเหตุ |
| :--- | :---: | :--- | :--- |
| `i32` | `0x7F` | 32 บิต | จำนวนเต็ม — ไม่มีเครื่องหมายในตัวชนิด เครื่องหมายขึ้นกับคำสั่ง (`_s` / `_u`) |
| `i64` | `0x7E` | 64 บิต | เช่นเดียวกับ `i32` |
| `f32` | `0x7D` | 32 บิต | IEEE 754 single |
| `f64` | `0x7C` | 64 บิต | IEEE 754 double |
| `v128` | `0x7B` | 128 บิต | SIMD vector (บทที่ 12) |
| `funcref` | `0x70` | opaque | reference ไปยังฟังก์ชัน (เก็บใน table) |
| `externref` | `0x6F` | opaque | reference ไปยังค่าของโฮสต์ (เช่น object ของ JS) |

> [!IMPORTANT]
> Wasm **ไม่มีชนิด boolean, char, หรือ pointer** ในระดับแกนกลาง:
> - boolean = `i32` (0 = เท็จ, ไม่ใช่ 0 = จริง)
> - pointer ใน wasm32 = `i32` ที่เป็น **offset ใน Linear Memory**
> - `int8/int16` ถูกเก็บใน `i32` และย่อ/ขยายตอน load/store (บทที่ 6)

### ชนิดของ Reference และข้อจำกัด

- `funcref`/`externref` เก็บลง Linear Memory **ไม่ได้** อยู่ได้เฉพาะ local, global, table
- JS ส่ง object เข้า Wasm ได้ผ่าน `externref` โดยไม่ต้องเข้ารหัสเป็นเลข

### Function Type

```text
functype = 0x60  vec(valtype)  vec(valtype)
                  พารามิเตอร์     ผลลัพธ์
```

ตัวอย่าง: `(i32, f64) -> i32` เข้ารหัสเป็น `60 02 7F 7C 01 7F`

### Block Type (ใช้กับ `block`/`loop`/`if`)

| ไบต์ | ความหมาย |
| :---: | :--- |
| `0x40` | ไม่คืนค่า (void) |
| `0x7F` ฯลฯ | คืนค่า 1 ค่าตามชนิดนั้น |
| s33 LEB128 (บวก) | อ้างถึง type index (multi-value) |

### Limits และ Mutability

| ชนิด | รูปแบบ |
| :--- | :--- |
| Limits | `0x00 min` หรือ `0x01 min max` |
| Mutability | `0x00` = const, `0x01` = var |

---

## 3.2 ทำไมต้อง LEB128

Wasm ใช้ **LEB128** (Little Endian Base 128) เข้ารหัสจำนวนเต็มทุกตัวที่เป็น index, ขนาด, และค่าคงที่ ข้อดี:

- ค่าน้อยใช้ไบต์น้อย (0–127 ใช้ **1 ไบต์** แม้เป็นค่า u32/u64)
- ไม่ผูกกับขนาด word ของเครื่อง
- decode แบบ streaming ได้

```text
แต่ละไบต์: [c][d d d d d d d]
            │  └── 7 บิตของข้อมูล (ฝั่งน้อยก่อน — little endian)
            └───── continuation bit: 1 = มีไบต์ต่อ, 0 = ไบต์สุดท้าย
```

### ขีดจำกัดความยาว

| ชนิด | ไบต์สูงสุด |
| :--- | :---: |
| u32 / s32 | 5 |
| u64 / s64 | 10 |
| s33 (block type) | 5 |

ไบต์ส่วนเกินที่ไม่จำเป็น (padding) ยังถูกต้องตามสเปกตราบไม่เกินขีดจำกัดความยาว และบิตส่วนเกินในไบต์สุดท้ายต้องเป็นศูนย์ (หรือเป็นการ sign-extend ที่ถูกต้องสำหรับ signed)

---

## 3.3 ULEB128 (Unsigned)

ใช้กับ: index, ความยาว, จำนวนรายการ, `size` ของ section, memory offset/alignment

### อัลกอริทึม Encode

```text
do:
   byte = v & 0x7F
   v >>= 7
   ถ้า v ≠ 0: byte |= 0x80
   เขียน byte
while v ≠ 0
```

### ตัวอย่าง `624485`

```text
624485 = 0b 0010_0110_0001_1100_1110_0101
แบ่งทีละ 7 บิตจากขวา:   0100110   0001110   1100101
ใส่ continuation:        0x26      0x8E      0xE5   (สองตัวแรกตั้งบิต 0x80)
เรียงน้อยก่อน:           E5 8E 26
```

---

## 3.4 SLEB128 (Signed)

ใช้กับ: `i32.const`, `i64.const`, ค่า immediate ที่มีเครื่องหมาย ใช้ two's complement และ **sign-extend**

### อัลกอริทึม Encode

```text
loop:
   byte = v & 0x7F
   v >>= 7                 ; arithmetic shift (คงเครื่องหมาย)
   ถ้า (v == 0  และ บิต 0x40 ของ byte = 0)  → จบ
   ถ้า (v == -1 และ บิต 0x40 ของ byte = 1)  → จบ
   ไม่งั้น byte |= 0x80 แล้ววนต่อ
```

กุญแจคือ **บิต 0x40 ของไบต์สุดท้ายคือบิตเครื่องหมาย** ถ้าบิตนี้ขัดกับเครื่องหมายจริง ต้องเพิ่มอีกไบต์

### ค่าขอบเขตที่ควรจำ (ตรวจสอบแล้ว)

| ค่า | SLEB128 | ข้อสังเกต |
| :--- | :--- | :--- |
| `0` | `00` | |
| `1` | `01` | |
| `-1` | `7F` | ไบต์เดียว (เครื่องหมายอยู่บิต 0x40) |
| `63` | `3F` | ค่าบวกสูงสุดที่ใช้ 1 ไบต์ |
| `64` | `C0 00` | ต้อง 2 ไบต์ เพราะ `0x40` จะถูกอ่านเป็นลบ |
| `-64` | `40` | ค่าลบต่ำสุดที่ใช้ 1 ไบต์ |
| `-65` | `BF 7F` | ต้อง 2 ไบต์ |
| `624485` | `E5 8E 26` | |
| `-123456` | `C0 BB 78` | |
| `INT32_MAX` (2147483647) | `FF FF FF FF 07` | 5 ไบต์ |
| `INT32_MIN` (-2147483648) | `80 80 80 80 78` | 5 ไบต์ |

> [!WARNING]
> ช่วงของ SLEB128 1 ไบต์คือ **-64 … 63** ไม่ใช่ -128 … 127 ความผิดพลาดที่พบบ่อยที่สุดในการเขียน emitter คือใช้ ULEB128 กับค่าคงที่ที่มีเครื่องหมาย ทำให้ `i32.const -1` ถูกอ่านผิด

### ULEB128 ของค่าขอบเขต

| ค่า | ULEB128 |
| :--- | :--- |
| `0`, `63`, `64`, `127` | `00`, `3F`, `40`, `7F` |
| `128` | `80 01` |
| `624485` | `E5 8E 26` |
| `0xFFFFFFFF` | `FF FF FF FF 0F` |

---

## 3.5 โค้ด C: Encode / Decode (ทดสอบแล้ว)

ไฟล์เต็ม: [examples/leb128.c](examples/leb128.c) — คอมไพล์ผ่านด้วย `clang -std=c99 -Wall -Wextra -pedantic` และผ่านด้วย `sld` (คอมไพล์เนทีฟ) ด้วย

```c
static size_t uleb_encode(uint64_t v, uint8_t *out) {
    size_t n = 0;
    do {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;
        if (v != 0) byte |= 0x80;
        out[n++] = byte;
    } while (v != 0);
    return n;
}

static size_t sleb_encode(int64_t v, uint8_t *out) {
    size_t n = 0;
    int more = 1;
    while (more) {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;                                   /* arithmetic shift */
        int sign_bit_clear = (byte & 0x40) == 0;
        if ((v == 0 && sign_bit_clear) || (v == -1 && !sign_bit_clear))
            more = 0;
        else
            byte |= 0x80;
        out[n++] = byte;
    }
    return n;
}

static size_t sleb_decode(const uint8_t *in, int64_t *out) {
    int64_t result = 0;
    unsigned shift = 0;
    size_t n = 0;
    uint8_t byte;
    do {
        if (n >= 10) return 0;                     /* ยาวเกิน = ผิดรูป */
        byte = in[n++];
        result |= (int64_t)(byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    if (shift < 64 && (byte & 0x40))
        result |= -((int64_t)1 << shift);          /* sign-extend */
    *out = result;
    return n;
}
```

### ผลการรันจริง

```text
--- ULEB128 ---
624485       -> [e5 8e 26]
4294967295   -> [ff ff ff ff 0f]
--- SLEB128 ---
-1           -> [7f]
64           -> [c0 00]
-65          -> [bf 7f]
-2147483648  -> [80 80 80 80 78]
RESULT: ALL ROUND-TRIPS OK
```

### การตรวจสอบกับ engine จริง

นอกจากทดสอบ round-trip ผมตรวจว่าไบต์ที่ได้ **V8 อ่านกลับเป็นค่าเดิม** โดยสร้างโมดูลที่มี `i32.const <v>` แล้วเรียกฟังก์ชัน ครอบคลุมค่า `0, 63, 64, -64, -65, 624485, -123456, INT32_MAX, INT32_MIN` ผ่านทั้งหมด

---

## 3.6 ข้อควรระวังเมื่อเขียน Emitter

1. **`i32.const` ใช้ SLEB128 เสมอ** ส่วน index/size ใช้ ULEB128
2. **ค่า `u32` ที่มากกว่า `INT32_MAX`** ใน `i32.const` ให้เข้ารหัสเป็น signed 32 บิตก่อน (เช่น `0xFFFFFFFF` → `-1` → `7F`)
3. **`size` ของ section/function body ต้องรู้ก่อนเขียน** จึงต้อง buffer payload ไว้ก่อนแล้วค่อยเขียนความยาวนำหน้า (หรือเขียน padding 5 ไบต์แล้ว patch ทีหลัง)
4. **อย่าสมมุติว่า 1 ไบต์พอ** `size` ที่ ≥ 128 ต้อง 2 ไบต์ขึ้นไป (helper `sec()` ในบทที่ 2 ใช้ได้เฉพาะ payload สั้น)
5. **ตรวจความยาวตอน decode** เพื่อกันไฟล์ที่ผิดรูปทำให้อ่านล้น buffer

---

## สรุปบทที่ 3

- ชนิดแกนกลางมี 4 ตัวเลข (`i32 i64 f32 f64`) + `v128` + reference 2 ชนิด; boolean/pointer/char ไม่มีในตัวชนิด
- จำนวนเต็มในไบนารีทั้งหมดใช้ LEB128: **ULEB128** สำหรับ index/size, **SLEB128** สำหรับค่าคงที่ที่มีเครื่องหมาย
- ช่วง 1 ไบต์ของ SLEB128 คือ -64…63 (บิต 0x40 คือบิตเครื่องหมาย)
- โค้ด C ในบทนี้ผ่านการทดสอบทั้ง round-trip และกับ V8
- บทถัดไป: [ชุดคำสั่งและ Opcode](04-instruction-set.md)
