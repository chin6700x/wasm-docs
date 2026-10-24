# บทที่ 4: ชุดคำสั่งและการประมวลผล (Instruction Set & Opcode Reference)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026
> อ้างอิง: [Core Spec — Instructions](https://webassembly.github.io/spec/core/binary/instructions.html)

[⬅ บทที่ 3](03-types-leb128.md) | [สารบัญ](README.md) | [บทที่ 5 ➡](05-control-flow.md)

> [!NOTE]
> ทุก opcode ที่ระบุในบทนี้ถูกตรวจกับ V8 จริงด้วย [examples/opcode-test.js](examples/opcode-test.js) — **80 เคส ผ่านทั้งหมด** (ค่าปกติ, ค่าขอบเขต, และ trap)

---

## 4.1 รูปแบบคำสั่ง

คำสั่งคือ **opcode 1 ไบต์** ตามด้วย immediate (ถ้ามี) เช่น `i32.const 5` = `41 05`
คำสั่งกลุ่มใหม่ใช้ prefix: `0xFC` (saturating/bulk memory), `0xFD` (SIMD), `0xFE` (atomics)

กฎ validation สำคัญ: ทุกคำสั่งมี **ชนิดสแตก** ที่แน่นอน เช่น `i32.add : [i32 i32] -> [i32]` ถ้าสแตกไม่ตรงกับที่ต้องการ โมดูลถูกปฏิเสธตั้งแต่ validate

---

## 4.2 ค่าคงที่ (Constants)

| Opcode | คำสั่ง | Immediate | ตัวอย่าง |
| :---: | :--- | :--- | :--- |
| `0x41` | `i32.const` | SLEB128 (s32) | `41 7F` = -1 |
| `0x42` | `i64.const` | SLEB128 (s64) | `42 C0 00` = 64 |
| `0x43` | `f32.const` | 4 ไบต์ IEEE754 little-endian | 1.5 = `43 00 00 C0 3F` |
| `0x44` | `f64.const` | 8 ไบต์ IEEE754 little-endian | 1.5 = `44 00 00 00 00 00 00 F8 3F` |

ค่าคงที่ float **ไม่ใช้ LEB128** แต่เป็นไบต์ดิบ

---

## 4.3 ตัวแปร Local และ Global

| Opcode | คำสั่ง | Immediate | สแตก | ความหมาย |
| :---: | :--- | :--- | :--- | :--- |
| `0x20` | `local.get` | local idx (u32) | `[] -> [t]` | อ่านค่า local |
| `0x21` | `local.set` | local idx | `[t] -> []` | เขียนค่า local |
| `0x22` | `local.tee` | local idx | `[t] -> [t]` | เขียนแล้ว **คงค่าไว้บนสแตก** |
| `0x23` | `global.get` | global idx | `[] -> [t]` | อ่าน global |
| `0x24` | `global.set` | global idx | `[t] -> []` | เขียน global (ต้อง mutable) |

- ลำดับ index ของ local: **พารามิเตอร์ก่อน แล้วตามด้วย locals ที่ประกาศใน Code section**
- locals ที่ประกาศเพิ่ม **ถูกตั้งค่าเริ่มต้นเป็น 0** โดยอัตโนมัติ (ตรวจแล้ว)

```text
;; f(x) = (x*2) + (x*2) ใช้ local.tee เก็บ x*2 ไว้ใน local 1
local.get 0 ; i32.const 2 ; i32.mul
local.tee 1          ; เก็บลง local 1 และคงค่าบนสแตก
local.get 1 ; i32.add      ; f(5) = 20  ✔
```

---

## 4.4 การคำนวณจำนวนเต็ม

> เครื่องหมาย: Wasm ไม่แยกชนิด signed/unsigned แต่ **คำสั่งเป็นตัวกำหนด** (`_s` = signed, `_u` = unsigned)

### i32 (opcode `0x67`–`0x78`)

| Opcode | คำสั่ง | ตัวอย่างที่ตรวจแล้ว |
| :---: | :--- | :--- |
| `0x67` | `i32.clz` | `clz(1)` = 31 |
| `0x68` | `i32.ctz` | `ctz(8)` = 3 |
| `0x69` | `i32.popcnt` | `popcnt(255)` = 8 |
| `0x6A` | `i32.add` | `2+3` = 5; `INT_MAX+1` = INT_MIN (wrap ไม่ trap) |
| `0x6B` | `i32.sub` | `2-3` = -1 |
| `0x6C` | `i32.mul` | `6*7` = 42 |
| `0x6D` | `i32.div_s` | `-7/2` = **-3** (ปัดเข้าหาศูนย์) |
| `0x6E` | `i32.div_u` | `-7/2` = **2147483644** (ตีความ -7 เป็น 4294967289) |
| `0x6F` | `i32.rem_s` | `-7%2` = -1 |
| `0x70` | `i32.rem_u` | `-7%2` = 1 |
| `0x71` | `i32.and` | `12&10` = 8 |
| `0x72` | `i32.or` | `12\|10` = 14 |
| `0x73` | `i32.xor` | `12^10` = 6 |
| `0x74` | `i32.shl` | `1<<31` = INT_MIN |
| `0x75` | `i32.shr_s` | `-8>>1` = **-4** (คงเครื่องหมาย) |
| `0x76` | `i32.shr_u` | `-8>>>1` = **2147483644** (เติมศูนย์) |
| `0x77` | `i32.rotl` | `rotl(0x80000001,1)` = 3 |
| `0x78` | `i32.rotr` | `rotr(1,1)` = INT_MIN |

### i64 (opcode `0x79`–`0x8A`)

ลำดับเดียวกับ i32 ทุกตัว โดยเลื่อนไป `0x79 = i64.clz` … `0x7C = i64.add`, `0x7D sub`, `0x7E mul`, `0x7F div_s`, `0x80 div_u`, `0x81 rem_s`, `0x82 rem_u`, `0x83 and`, `0x84 or`, `0x85 xor`, `0x86 shl`, `0x87 shr_s`, `0x88 shr_u`, `0x89 rotl`, `0x8A rotr`

### จุดที่ต้องรู้เกี่ยวกับ Shift

> [!IMPORTANT]
> จำนวนที่เลื่อน (shift count) ถูก **mod ด้วยความกว้างบิต** (32 หรือ 64) อัตโนมัติ เช่น `1 << 33` ใน i32 = `1 << 1` = **2** (ตรวจแล้ว) ต่างจาก C ที่เป็น undefined behavior — compiler ต้องระวังเมื่อแปลงจาก C

### Trap ของการหาร

| กรณี | ผล |
| :--- | :--- |
| `div_s/div_u/rem_s/rem_u` ตัวหาร = 0 | **trap** (`divide by zero` / `remainder by zero`) |
| `i32.div_s` เมื่อ `INT_MIN / -1` | **trap** (integer overflow) |
| `i32.rem_s` เมื่อ `INT_MIN % -1` | **ไม่ trap** คืน 0 |
| `add/sub/mul` ล้น | **wrap around** ไม่ trap |

---

## 4.5 การเปรียบเทียบ

ผลลัพธ์เป็น `i32` เสมอ (0 หรือ 1)

| i32 | i64 | ความหมาย |
| :---: | :---: | :--- |
| `0x45` `eqz` | `0x50` `eqz` | เท่ากับศูนย์ (รับ 1 ค่า) |
| `0x46` `eq` | `0x51` | เท่ากับ |
| `0x47` `ne` | `0x52` | ไม่เท่ากับ |
| `0x48` `lt_s` | `0x53` | น้อยกว่า (signed) |
| `0x49` `lt_u` | `0x54` | น้อยกว่า (unsigned) |
| `0x4A` `gt_s` | `0x55` | มากกว่า (signed) |
| `0x4B` `gt_u` | `0x56` | มากกว่า (unsigned) |
| `0x4C` `le_s` | `0x57` | น้อยกว่าหรือเท่ากับ (signed) |
| `0x4D` `le_u` | `0x58` | (unsigned) |
| `0x4E` `ge_s` | `0x59` | มากกว่าหรือเท่ากับ (signed) |
| `0x4F` `ge_u` | `0x5A` | (unsigned) |

ตัวอย่างที่ตรวจแล้ว: `lt_s(-1, 1)` = **1** แต่ `lt_u(-1, 1)` = **0** (เพราะ -1 = 0xFFFFFFFF)

### Float: `f32` `0x5B`–`0x60`, `f64` `0x61`–`0x66`
ลำดับ `eq, ne, lt, gt, le, ge` — **ไม่มี `_s/_u`** และ NaN ทำให้ทุกอย่างเป็นเท็จ ยกเว้น `ne`

```text
f64.lt(NaN, 1) = 0     f64.ne(NaN, NaN) = 1     (ตรวจแล้ว)
```

---

## 4.6 การคำนวณ Float

| f32 | f64 | ความหมาย | ตัวอย่างที่ตรวจแล้ว |
| :---: | :---: | :--- | :--- |
| `0x8B` | `0x99` | `abs` | |
| `0x8C` | `0x9A` | `neg` | `neg(5)` = -5 |
| `0x8D` | `0x9B` | `ceil` | `ceil(1.2)` = 2 |
| `0x8E` | `0x9C` | `floor` | `floor(-1.2)` = -2 |
| `0x8F` | `0x9D` | `trunc` | `trunc(-1.9)` = -1 |
| `0x90` | `0x9E` | `nearest` | `nearest(2.5)` = **2**, `nearest(3.5)` = **4** (ปัดเข้าหาเลขคู่) |
| `0x91` | `0x9F` | `sqrt` | `sqrt(9)` = 3 |
| `0x92` | `0xA0` | `add` | |
| `0x93` | `0xA1` | `sub` | |
| `0x94` | `0xA2` | `mul` | |
| `0x95` | `0xA3` | `div` | หารศูนย์ได้ ±Inf/NaN **ไม่ trap** |
| `0x96` | `0xA4` | `min` | `min(-0, 0)` = **-0** |
| `0x97` | `0xA5` | `max` | |
| `0x98` | `0xA6` | `copysign` | `copysign(3,-1)` = -3 |

> [!WARNING]
> `nearest` คือปัดแบบ **ties-to-even** ไม่ใช่ `Math.round` ของ JS และ `min/max` ถือว่า `-0 < +0` และคืน NaN ถ้าตัวใดตัวหนึ่งเป็น NaN

---

## 4.7 การแปลงชนิด (Conversions)

| Opcode | คำสั่ง | ความหมาย |
| :---: | :--- | :--- |
| `0xA7` | `i32.wrap_i64` | ตัดเหลือ 32 บิตล่าง (`0x1_0000_0005` → 5) |
| `0xA8`/`0xA9` | `i32.trunc_f32_s/u` | float → int (**trap** ถ้า NaN/นอกช่วง) |
| `0xAA`/`0xAB` | `i32.trunc_f64_s/u` | `trunc_f64_s(-3.9)` = -3 |
| `0xAC` | `i64.extend_i32_s` | ขยายแบบคงเครื่องหมาย (`-1` → `-1n`) |
| `0xAD` | `i64.extend_i32_u` | ขยายแบบเติมศูนย์ (`-1` → `4294967295n`) |
| `0xAE`–`0xB1` | `i64.trunc_f32/f64_s/u` | float → i64 (trap ได้) |
| `0xB2`–`0xB5` | `f32.convert_i32/i64_s/u` | int → f32 |
| `0xB6` | `f32.demote_f64` | f64 → f32 |
| `0xB7`–`0xBA` | `f64.convert_i32/i64_s/u` | `convert_i32_u(-1)` = 4294967295 |
| `0xBB` | `f64.promote_f32` | f32 → f64 |
| `0xBC` | `i32.reinterpret_f32` | **เปลี่ยนการตีความบิต** ไม่แปลงค่า (`1.0f` → `0x3F800000`) |
| `0xBD` | `i64.reinterpret_f64` | เช่นกัน |
| `0xBE` | `f32.reinterpret_i32` | |
| `0xBF` | `f64.reinterpret_i64` | |

### Sign-extension (Core 2.0)
| Opcode | คำสั่ง | ตัวอย่าง |
| :---: | :--- | :--- |
| `0xC0` | `i32.extend8_s` | `0x80` → -128 |
| `0xC1` | `i32.extend16_s` | `0x8000` → -32768 |
| `0xC2`/`0xC3`/`0xC4` | `i64.extend8_s/16_s/32_s` | `0x80000000n` → `-2147483648n` |

ใช้แปลง `char`/`short` ที่ถูก load มาเป็น `i32` ให้เป็นค่าลบที่ถูกต้อง

### Saturating Truncation (prefix `0xFC`)

`trunc` ปกติ **trap** เมื่อค่าเกินช่วง ส่วนรุ่น saturating จะ **ไม่ trap**:

| ไบต์ | คำสั่ง |
| :---: | :--- |
| `FC 00` / `FC 01` | `i32.trunc_sat_f32_s/u` |
| `FC 02` / `FC 03` | `i32.trunc_sat_f64_s/u` |
| `FC 04` / `FC 05` | `i64.trunc_sat_f32_s/u` |
| `FC 06` / `FC 07` | `i64.trunc_sat_f64_s/u` |

พฤติกรรม (ตรวจแล้วกับ `FC 02`): `NaN` → **0**, `1e10` → **INT_MAX**, `-1e10` → **INT_MIN**

> [!TIP]
> ภาษาอย่าง Rust ใช้ `trunc_sat` เป็นค่าเริ่มต้นของ `as` cast จึงไม่ trap เมื่อ float เกินช่วง

---

## 4.8 Parametric และคำสั่งพื้นฐาน

| Opcode | คำสั่ง | สแตก | ความหมาย |
| :---: | :--- | :--- | :--- |
| `0x00` | `unreachable` | `[] -> ...` | trap ทันที |
| `0x01` | `nop` | `[] -> []` | ไม่ทำอะไร |
| `0x1A` | `drop` | `[t] -> []` | ทิ้งค่าบนสุด |
| `0x1B` | `select` | `[t t i32] -> [t]` | ถ้า `c ≠ 0` เลือกค่าแรก ไม่งั้นค่าที่สอง |

```text
;; select(a, b, c)
local.get 0 ; local.get 1 ; local.get 2 ; select
;; select(10, 20, 1) = 10     select(10, 20, 0) = 20     (ตรวจแล้ว)
```

> [!NOTE]
> `select` **ประเมินทั้งสองค่าก่อนเสมอ** (ไม่ short-circuit) จึงเหมาะกับค่าที่ไม่มี side effect การทำ `a ? b() : c()` ต้องใช้ `if/else` (บทที่ 5)

---

## 4.9 รูปแบบ Bytecode ของ expression

ตัวอย่างการแปลง `(a + b) * c` เป็นสแตก:

```text
local.get 0     ; [a]
local.get 1     ; [a b]
i32.add         ; [a+b]
local.get 2     ; [a+b c]
i32.mul         ; [(a+b)*c]
```

หลักการสำหรับ code generator: **ประเมินตัวถูกดำเนินการซ้ายไปขวา แล้วปล่อยคำสั่ง** (post-order traversal ของ AST) — วิธีนี้ทำให้ emitter ไม่ต้องทำ register allocation เลย

---

## 4.10 เครื่องมือทดสอบของบทนี้

[examples/opcode-test.js](examples/opcode-test.js) สร้างโมดูลย่อยต่อเคสแล้วเรียกเทียบค่า (ใช้ `Object.is` เพื่อแยก `-0`/`NaN`):

```bash
$ node examples/opcode-test.js
opcode checks: 80 passed, 0 failed (รวม 80)
```

เคสครอบคลุม: เปรียบเทียบ i32/i64/float, คำนวณ i32/i64/float, ทุกกลุ่ม conversion, sign-extension, `trunc_sat`, และ 6 trap (`÷0`, `INT_MIN/-1`, `rem ÷0`, `trunc NaN`, `trunc` เกินช่วง, `unreachable`)

---

## สรุปบทที่ 4

- opcode 1 ไบต์ + immediate; signed/unsigned แยกที่ตัวคำสั่ง (`_s`/`_u`) ไม่ใช่ที่ชนิด
- Shift count ถูก mod ความกว้างบิต, `add/sub/mul` wrap ไม่ trap, การหารศูนย์ของ integer trap
- `nearest` ปัดเข้าเลขคู่, `reinterpret` ไม่แปลงค่า, `trunc` trap แต่ `trunc_sat` ไม่ trap
- `local.tee` และ `select` ช่วยลดจำนวนคำสั่ง
- emitter สร้างโค้ดจาก AST ด้วย post-order ได้โดยไม่ต้องจัดสรร register
- บทถัดไป: [Structured Control Flow](05-control-flow.md)
