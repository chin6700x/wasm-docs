# บทที่ 6: แบบจำลองหน่วยความจำเชิงเส้น (Linear Memory Model & Page Architecture)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026  
> อ้างอิง: [W3C Core Spec — Memory Instructions](https://webassembly.github.io/spec/core/binary/instructions.html#memory-instructions) • [MDN WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory)

[⬅ บทที่ 5](05-control-flow.md) | [สารบัญ](README.md) | [บทที่ 7 ➡](07-tables-indirect-call.md)

> [!NOTE]
> ตัวอย่างโค้ดไบนารีและสถาปัตยกรรมการจัดการหน่วยความจำทั้งหมดในบทนี้ สามารถทดสอบและรันผ่าน V8 Engine ได้ทันทีด้วยไฟล์ [examples/memory-test.js](examples/memory-test.js) (ครอบคลุม Little-Endian, Sign-extension, Bump Allocator, Detached Buffer Gotcha, Max Limit และ Out-of-Bounds Trap)

---

## 6.1 โครงสร้างของ Linear Memory: Byte Array ขนาดยักษ์แบบไม่มี Segment

ในสถาปัตยกรรมคอมพิวเตอร์ดั้งเดิม (เช่น x86 Real Mode หรือ Protected Mode) หน่วยความจำมักถูกแบ่งแยกผ่าน **Segment Registers** (`CS`, `DS`, `SS`, `ES`) หรือผ่าน Virtual Memory Page Tables ที่มีการกำหนดสิทธิ์ Read/Write/Execute ต่อหน้า

ในทางตรงกันข้าม **WebAssembly Linear Memory** ได้รับการออกแบบให้เรียบง่าย ปลอดภัย และมีประสิทธิภาพสูงสุด:

```
+---------------------------------------------------------------------------------+
|                              Linear Memory (Wasm32)                             |
| แอดเดรส 0                                                       แอดเดรส N-1     |
| [ Byte 0 ] [ Byte 1 ] [ Byte 2 ] [ Byte 3 ] ... [ Byte 65,535 ] ... [ Byte N ]  |
+---------------------------------------------------------------------------------+
     ▲                                                 ▲
     │                                                 │
  แอดเดรสเป็นจำนวนเต็มบวก 32-บิต              ขยายขนาดได้ทีละ Page (64 KiB)
  (0x00000000 ถึง 0xFFFFFFFF)
```

### คุณลักษณะสำคัญ 4 ประการของ Linear Memory:
1. **Contiguous Byte Array (แถวลำดับของไบต์ต่อเนื่อง):**  
   มองเห็นเป็นอาร์เรย์ของไบต์ธรรมดา เริ่มต้นที่ Index `0` ไปจนถึงขอบเขตสิ้นสุดของหน่วยความจำ
2. **Untyped Bytes (ไบต์ไร้ชนิดข้อมูล):**  
   ในระดับหน่วยความจำ ไม่มีแนวคิดเรื่อง Class, Struct, หรือ Object มีเพียงตัวเลขไบต์บริสุทธิ์ ตัวแปรหรือคำสั่งที่เรียกอ่านจะเป็นผู้กำหนดเองว่าจะตีความไบต์เหล่านั้นเป็น `i32`, `f32`, `i64`, `f64`, หรือสตริง UTF-8
3. **Little-Endian Byte Ordering:**  
   มาตรฐาน W3C กำหนดให้ Linear Memory ของ WebAssembly จัดเก็บข้อมูลแบบ **Little-Endian เสมอ** (ไบต์ที่มีนัยสำคัญต่ำสุดหรือ LSB จะถูกบันทึกไว้ที่แอดเดรสน้อยที่สุด) ทำให้เข้ากันได้โดยตรงกับสถาปัตยกรรม x86-64 และ ARM64 โดยไม่ต้องสลับไบต์
4. **Sandboxed & Zero-Leak Isolation:**  
   พอยน์เตอร์ใน WebAssembly เป็นเพียง **Offset ภายใน Linear Memory** เท่านั้น ไม่ใช่ Real Physical หรือ OS Virtual Address โค้ด Wasm จึงไม่สามารถเจาะทะลุออกไปอ่านหน่วยความจำของ Process โฮสต์ภายนอกได้เลย

---

## 6.2 หน่วยของ Memory Page (1 Page = 64 KiB ตายตัว)

ขนาดของ Linear Memory ใน WebAssembly ไม่ได้นับเป็นไบต์เดี่ยวๆ ในการจัดสรร แต่จะขยายและวัดขนาดในหน่วย **Page**:

$$\mathbf{1\text{ Memory Page} = 65,536\text{ ไบต์} = 64\text{ KiB}}$$

```
+-------------------------------------------------------------------+
| 1 Page = 65,536 ไบต์ (64 KiB)                                     |
+-------------------------------------------------------------------+
| 2 Pages = 131,072 ไบต์ (128 KiB)                                  |
+-------------------------------------------------------------------+
| 16 Pages = 1,048,576 ไบต์ (1 MiB)                                 |
+-------------------------------------------------------------------+
| 65,536 Pages = 4,294,967,296 ไบต์ (4 GiB - เพดานสูงสุดของ Wasm32)   |
+-------------------------------------------------------------------+
```

### โครงสร้างการประกาศ Limits ใน Memory Section (Section 5)
ในโครงสร้างไบนารี แต่ละโมดูลสามารถประกาศ Memory Instance ได้ (ใน Wasm 1.0 จำกัดที่ 1 โมดูลต่อ 1 memory):

```
+-------------+------------------+------------------+
| Flags (1 B) | Minimum (u32 LEB)| Maximum (u32 LEB)|
+-------------+------------------+------------------+
```
- `Flags = 0x00`: กำหนดเฉพาะขนาดเริ่มต้น (`min`), ไม่มีเพดานจำกัด (ขยายได้เรื่อยๆ จนกว่าแรมของเครื่องจะหมด)
- `Flags = 0x01`: กำหนดทั้งขนาดเริ่มต้น (`min`) และเพดานสูงสุด (`max`)

**ตัวอย่างไบนารี:**
- `0x00 0x01` $\rightarrow$ ขั้นต่ำ 1 Page (64 KB), ไม่มีขีดจำกัดสูงสุด
- `0x01 0x01 0x04` $\rightarrow$ ขั้นต่ำ 1 Page (64 KB), สูงสุดไม่เกิน 4 Pages (256 KB)

---

## 6.3 คำสั่งอ่านและเขียนหน่วยความจำ (Memory Load & Store)

WebAssembly มีกลุ่มคำสั่งสำหรับโหลดค่าจาก Memory ขึ้นสู่สแตก และเขียนค่าจากสแตกลงสู่ Memory ครอบคลุมชนิดข้อมูลพื้นฐานทุกตัว:

### 1. คำสั่งอ่านและเขียนข้อมูลเต็มขนาด (Full Width)

| Opcode | คำสั่ง | Immediate | สแตกก่อน $\rightarrow$ หลัง | การทำงาน |
| :---: | :--- | :--- | :--- | :--- |
| `0x28` | `i32.load` | `memarg` | `[i32] -> [i32]` | อ่านค่า 32-bit จำนวนเต็ม (4 ไบต์) |
| `0x29` | `i64.load` | `memarg` | `[i32] -> [i64]` | อ่านค่า 64-bit จำนวนเต็ม (8 ไบต์) |
| `0x2A` | `f32.load` | `memarg` | `[i32] -> [f32]` | อ่านค่า IEEE-754 Single-Precision |
| `0x2B` | `f64.load` | `memarg` | `[i32] -> [f64]` | อ่านค่า IEEE-754 Double-Precision |
| `0x36` | `i32.store` | `memarg` | `[i32 i32] -> []` | เขียนค่า 32-bit ลงแอดเดรส (addr, val) |
| `0x37` | `i64.store` | `memarg` | `[i32 i64] -> []` | เขียนค่า 64-bit ลงแอดเดรส (addr, val) |
| `0x38` | `f32.store` | `memarg` | `[i32 f32] -> []` | เขียนค่าทศนิยม 32-bit ลงแอดเดรส |
| `0x39` | `f64.store` | `memarg` | `[i32 f64] -> []` | เขียนค่าทศนิยม 64-bit ลงแอดเดรส |

---

### 2. คำสั่งอ่านและเขียนขนาดย่อย (Sub-width Loads & Stores)

เมื่อต้องการประหยัดหน่วยความจำสำหรับชนิดข้อมูลขนาดเล็ก เช่น `char` (8-bit) หรือ `short` (16-bit) ในภาษา C:

| Opcode | คำสั่ง | สแตก | พฤติกรรมการแปลงขนาด |
| :---: | :--- | :--- | :--- |
| `0x2C` | `i32.load8_s` | `[i32] -> [i32]` | โหลด 1 ไบต์ แล้ว **Sign-Extend** เป็น 32-บิต |
| `0x2D` | `i32.load8_u` | `[i32] -> [i32]` | โหลด 1 ไบต์ แล้ว **Zero-Extend** เป็น 32-บิต |
| `0x2E` | `i32.load16_s`| `[i32] -> [i32]` | โหลด 2 ไบต์ แล้ว **Sign-Extend** เป็น 32-บิต |
| `0x2F` | `i32.load16_u`| `[i32] -> [i32]` | โหลด 2 ไบต์ แล้ว **Zero-Extend** เป็น 32-บิต |
| `0x30` | `i64.load8_s` | `[i32] -> [i64]` | โหลด 1 ไบต์ แล้ว Sign-Extend เป็น 64-บิต |
| `0x31` | `i64.load8_u` | `[i32] -> [i64]` | โหลด 1 ไบต์ แล้ว Zero-Extend เป็น 64-บิต |
| `0x32` | `i64.load16_s`| `[i32] -> [i64]` | โหลด 2 ไบต์ แล้ว Sign-Extend เป็น 64-บิต |
| `0x33` | `i64.load16_u`| `[i32] -> [i64]` | โหลด 2 ไบต์ แล้ว Zero-Extend เป็น 64-บิต |
| `0x34` | `i64.load32_s`| `[i32] -> [i64]` | โหลด 4 ไบต์ แล้ว Sign-Extend เป็น 64-บิต |
| `0x35` | `i64.load32_u`| `[i32] -> [i64]` | โหลด 4 ไบต์ แล้ว Zero-Extend เป็น 64-บิต |
| `0x3A` | `i32.store8`  | `[i32 i32] -> []`| ตัดเอาเฉพาะ 8 บิตล่างของค่าบนสแตกไปเขียน |
| `0x3B` | `i32.store16` | `[i32 i32] -> []`| ตัดเอาเฉพาะ 16 บิตล่างของค่าบนสแตกไปเขียน |
| `0x3C` | `i64.store8`  | `[i32 i64] -> []`| ตัดเอาเฉพาะ 8 บิตล่างไปเขียน |
| `0x3D` | `i64.store16` | `[i32 i64] -> []`| ตัดเอาเฉพาะ 16 บิตล่างไปเขียน |
| `0x3E` | `i64.store32` | `[i32 i64] -> []`| ตัดเอาเฉพาะ 32 บิตล่างไปเขียน |

> [!IMPORTANT]
> **ความแตกต่างระหว่าง `_u` และ `_s`:**  
> สมมุติค่าในหน่วยความจำเป็น `0xFE` (11111110):  
> - `i32.load8_u` จะเติมศูนย์ข้างหน้า $\rightarrow$ ได้ค่า `0x000000FE` = **`254`**
> - `i32.load8_s` บิตสูงสุดเป็น `1` จึงเติมหนึ่งข้างหน้า (Two's complement) $\rightarrow$ ได้ค่า `0xFFFFFFFE` = **`-2`**

---

## 6.4 ค่าพารามิเตอร์ของคำสั่ง Memory: `memarg` (Align & Offset)

ทุกคำสั่งในตระกูล `load` และ `store` จะตามด้วย Immediate Argument ที่เรียกว่า **`memarg`** ซึ่งประกอบด้วย 2 ค่า เข้ารหัสแบบ ULEB128:

```
[opcode] [align: u32 LEB128] [offset: u32 LEB128]
```

### 1. `align` (Alignment Exponent)
ค่า `align` ไม่ใช่จำนวนไบต์โดยตรง แต่เป็น **เลขชี้กำลังฐาน 2 ($2^{\text{align}}$)**:
- `align = 0` $\rightarrow 2^0 = 1$ ไบต์ (ไม่มีข้อกำหนด Alignment)
- `align = 1` $\rightarrow 2^1 = 2$ ไบต์ (แอดเดรสควรหารด้วย 2 ลงตัว)
- `align = 2` $\rightarrow 2^2 = 4$ ไบต์ (แอดเดรสควรหารด้วย 4 ลงตัว เช่น สำหรับ `i32`)
- `align = 3` $\rightarrow 2^3 = 8$ ไบต์ (แอดเดรสควรหารด้วย 8 ลงตัว เช่น สำหรับ `i64`, `f64`)

> [!NOTE]
> **Alignment Hint Rule:** มาตรฐาน W3C ระบุว่าค่า `align` เป็นเพียง **คำแนะนำ (Hint)** ให้เอนจิน JIT ทำการ Optimize โค้ด หากแอดเดรสไม่ตรงตาม Alignment (Unaligned Access) ซีพียูยุคใหม่จะยังคงอ่านเขียนได้ถูกต้องโดยไม่เกิด Hardware Crash  
> แต่มีกฎสำคัญคือ **ห้ามประกาศ $2^{\text{align}}$ เกินขนาดจริงของคำสั่งนั้น** (เช่น `i32.load` ขนาด 4 ไบต์ ห้ามประกาศ `align > 2` มิฉะนั้นจะเกิด Validation Error ตอนโหลดโมดูล)

### 2. `offset` (Static Address Offset)
ค่าคงที่ที่จะถูกนำไปบวกเข้ากับค่า Base Address ที่อยู่บนสแตกโดยอัตโนมัติ:

$$\text{Effective Address} = \text{Base Address (จากสแตก)} + \text{offset (จาก memarg)}$$

ฟีเจอร์นี้ช่วยประหยัดคำสั่ง `i32.add` ได้มหาศาลเมื่อคอมไพเลอร์สร้างโค้ดสำหรับเข้าถึงตัวแปรสมาชิกใน Struct เช่น `point->y`:
```wat
;; แทนที่จะต้องเขียน:
local.get $ptr
i32.const 4
i32.add
i32.load 0 0

;; สามารถเขียนสั้นๆ ได้ในคำสั่งเดียว:
local.get $ptr
i32.load 2 4   ;; align=2, offset=4
```

---

## 6.5 การตรวจสอบและขยายหน่วยความจำขณะทำงาน: `memory.size` และ `memory.grow`

WebAssembly อนุญาตให้โปรแกรมขอเพิ่มหน่วยความจำได้แบบไดนามิกระหว่างรันไทม์:

```
[ memory.size ]  Opcode: 0x3F 0x00   | สแตก: [] -> [i32]
คืนจำนวน Memory Page ปัจจุบันที่โปรแกรมถือครองอยู่

[ memory.grow ]  Opcode: 0x40 0x00   | สแตก: [i32 delta] -> [i32 prev_pages]
ขอขยายหน่วยความจำเพิ่มขึ้นอีก delta หน้า:
  - หากสำเร็จ: คืนจำนวนหน้าเดิม "ก่อนขยาย"
  - หากล้มเหลว: คืนค่า -1 (0xFFFFFFFF) โดยที่ขนาดหน่วยความจำเดิมจะไม่ได้รับผลกระทบ
```

> [!WARNING]
> **🚨 คำเตือนระดับวิศวกรรม: The Detached Buffer Gotcha**  
> เมื่อคำสั่ง `memory.grow` ถูกเรียก เอนจินของเบราว์เซอร์ (V8/SpiderMonkey) อาจจำเป็นต้องทำการจัดสรร Memory Block ใหม่และคัดลอกข้อมูล (`mremap` หรือย้าย Physical Buffer) ส่งผลให้:  
> **`ArrayBuffer` เดิมที่ JavaScript ถืออยู่จะถูกตัดการเชื่อมต่อ (Detached) กลายเป็นบัฟเฟอร์ขนาด 0 ไบต์ทันที!**  
> ```javascript
> const mem = instance.exports.memory;
> let view = new Uint8Array(mem.buffer); // ผูก view ไว้กับ buffer ปัจจุบัน
> 
> instance.exports.mem_grow(1); // สั่งขยายหน่วยความจำ 1 หน้า
> 
> console.log(view.byteLength); // 💥 กลายเป็น 0 ไบต์ทันที!
> view[0] = 42; // 💥 TypeError: Cannot perform operation on a detached ArrayBuffer
> 
> // ✅ วิธีแก้ที่ถูกต้อง: ดึง mem.buffer ใหม่ทุกครั้งหลังมีการ grow
> view = new Uint8Array(mem.buffer); 
> ```

---

## 6.6 การสร้าง Heap Memory Allocator ขนาดจิ๋ว (Minimal Bump Allocator)

ในการพัฒนาโมดูล WebAssembly ระดับ Bare-Metal ที่ไม่ต้องการพึ่งพา Libc ขนาดยักษ์ (เช่น `dlmalloc` หรือ `jemalloc` ซึ่งมีขนาดหลายสิบกิโลไบต์) เราสามารถเขียน **Bump Allocator (Linear Allocator)** สั้นๆ เพียงไม่กี่ไบต์ได้ด้วยตนเอง

### โครงสร้างหน่วยความจำ (Memory Layout Pattern):
```
แอดเดรส 0        แอดเดรส 1024                         Heap Pointer
+-----------------+-----------------------------------+--------------------+
| Static / Stack  | Block 1 (malloc) | Block 2 (malloc) | ยังไม่ถูกจัดสรร     |
| (1024 ไบต์แรก)   | 13 ไบต์ (Align 8) | 20 ไบต์ (Align 8) |                    |
+-----------------+-----------------------------------+--------------------+
                                                      ▲
                                                      │ ชี้ตำแหน่งว่างถัดไป
```

### การคำนวณ 8-Byte Alignment:
เพื่อให้สอดคล้องกับพอยน์เตอร์ทั่วไปและการโหลดค่า 64-บิต เราต้องปัดเศษแอดเดรสให้ลงตัวที่ 8 ไบต์เสมอ:

$$\text{aligned\_ptr} = (\text{ptr} + \text{size} + 7) \ \& \ (\sim 7) = (\text{ptr} + \text{size} + 7) \ \& \ (-8)$$

### โค้ด WebAssembly Text Format (`malloc` ในภาษา Wasm):
```wat
(module
  (memory (export "memory") 1 4) ;; min 1 page, max 4 pages
  
  ;; ตัวแปร Global เก็บตำแหน่ง Heap ว่างปัจจุบัน (เริ่มต้นที่ 1024)
  (global $heap_ptr (mut i32) (i32.const 1024))

  (func $malloc (export "malloc") (param $size i32) (result i32)
    (local $old_ptr i32)
    (local $new_ptr i32)

    ;; 1. บันทึกตำแหน่งเดิมไว้เพื่อคืนค่า
    global.get $heap_ptr
    local.set $old_ptr

    ;; 2. คำนวณตำแหน่งใหม่แบบ 8-byte aligned: (old_ptr + size + 7) & -8
    local.get $old_ptr
    local.get $size
    i32.add
    i32.const 7
    i32.add
    i32.const -8     ;; ใน SLEB128 เข้ารหัสเป็นไบต์ 0x78
    i32.and
    local.set $new_ptr

    ;; 3. อัปเดตตำแหน่ง Heap Pointer
    local.get $new_ptr
    global.set $heap_ptr

    ;; 4. คืนพอยน์เตอร์เริ่มต้นของบล็อก
    local.get $old_ptr
  )
)
```

---

## 6.7 การแลกเปลี่ยนข้อมูลกับ JavaScript ผ่าน Zero-Copy Memory Access

หนึ่งในจุดเด่นที่ทำให้ WebAssembly ทำงานได้เร็วกว่าระบบอื่น คือ JavaScript และ WebAssembly สามารถ **แชร์ Linear Memory เดียวกันได้โดยตรงแบบ Zero-Copy**:

```
+-----------------------------------------------------------------+
|                       Linear Memory Buffer                      |
|                                                                 |
|   JS DataView / TypedArray        Wasm i32.load / i32.store     |
|   (Uint8Array, Int32Array)                   │                  |
|              │                               │                  |
|              ▼                               ▼                  |
|    +---------------------------------------------------+        |
|    | ไบต์ที่ 0 | ไบต์ที่ 1 | ไบต์ที่ 2 | ... | ไบต์ที่ N |        |
|    +---------------------------------------------------+        |
+-----------------------------------------------------------------+
```

### 1. การส่งสตริง UTF-8 เข้าสู่ Wasm Linear Memory (Zero-Copy):
```javascript
function passStringToWasm(instance, text) {
  const encoder = new TextEncoder();
  const encodedBytes = encoder.encode(text);

  // 1. ขอจัดสรรพื้นที่ใน Wasm Heap
  const ptr = instance.exports.malloc(encodedBytes.length + 1);

  // 2. คัดลอกไบต์ลง Linear Memory ตรงๆ
  const mem = new Uint8Array(instance.exports.memory.buffer);
  mem.set(encodedBytes, ptr);
  mem[ptr + encodedBytes.length] = 0; // เติม Null-terminator \0

  return ptr; // ส่ง Pointer ไปให้ฟังก์ชัน Wasm ประมวลผลต่อ
}
```

### 2. การอ่านสตริง UTF-8 ออกจาก Wasm Linear Memory:
```javascript
function readStringFromWasm(instance, ptr) {
  const mem = new Uint8Array(instance.exports.memory.buffer);
  
  // หาจุดสิ้นสุดของ Null-terminated string
  let end = ptr;
  while (mem[end] !== 0) {
    end++;
  }

  // แปลงไบต์เป็นข้อความด้วย TextDecoder
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(mem.subarray(ptr, end));
}
```

---

## 6.8 การป้องกันและพฤติกรรม Out-of-Bounds Memory Trap

เมื่อคำสั่งใน WebAssembly พยายามอ่านหรือเขียนแอดเดรสที่อยู่นอกเหนือจากขอบเขตของ Linear Memory ปัจจุบัน:

$$\text{Effective Address} + \text{Access Size} > \text{Current Memory Size in Bytes}$$

เอนจินของเบราว์เซอร์จะสั่งให้เกิด **Hardware/Software Trap ทันที**:
1. การทำงานของ WebAssembly จะหยุดชะงักลงในจังหวะนั้น
2. โฮสต์รันไทม์จะโยนข้อผิดพลาด **`WebAssembly.RuntimeError: memory access out of bounds`** ออกมาใน JavaScript
3. ไม่เกิด Memory Corruption หรือ Buffer Overflow ที่ล้นออกไปทำลาย Process ของระบบ

สามารถดูการทดสอบพฤติกรรม Trap และการทำงานทั้งหมดในโค้ดตัวอย่างที่ตรวจสอบผ่าน V8 จริงได้ที่ [examples/memory-test.js](examples/memory-test.js)

---

[⬅ บทที่ 5: กฎการควบคุมการไหลและโครงสร้างบล็อก](05-control-flow.md) | [สารบัญหลัก](README.md) | [บทที่ 7: ฟังก์ชันพอยน์เตอร์และตารางทางอ้อม ➡](07-tables-indirect-call.md)
