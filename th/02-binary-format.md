# บทที่ 2: โครงสร้าง Binary Format ตามมาตรฐาน W3C

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • เอกสาร: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • โค้ด: [Apache-2.0 / MIT](../LICENSE)
> อ้างอิง: [Core Spec — Binary Format](https://webassembly.github.io/spec/core/binary/index.html)

[⬅ บทที่ 1](01-core-architecture.md) | [สารบัญ](README.md) | [บทที่ 3 ➡](03-types-leb128.md)

---

## 2.1 Magic Number และ Version

ทุกไฟล์ `.wasm` ต้องขึ้นต้นด้วย 8 ไบต์:

| Offset | ไบต์ | ความหมาย |
| :---: | :--- | :--- |
| 0–3 | `00 61 73 6D` | Magic number = `"\0asm"` |
| 4–7 | `01 00 00 00` | Version = 1 (little-endian u32) |

- ถ้า magic ผิด engine ปฏิเสธทันที (`CompileError: expected magic word`)
- Version ปัจจุบันยังเป็น `1` เสมอ (ฟีเจอร์ใหม่ต่อยอดโดยไม่เปลี่ยน version)

---

## 2.2 โครงสร้าง Section

หลัง header ไฟล์คือลำดับของ **section** แต่ละอันมีรูปแบบเดียวกัน:

```text
+---------+-------------------+-------------------+
| id (u8) | size (u32 LEB128) | payload (size ไบต์) |
+---------+-------------------+-------------------+
```

- `size` นับเฉพาะ **payload** (ไม่รวม id และตัว size เอง)
- ผู้อ่านข้าม section ที่ไม่รู้จักได้เสมอโดยอ่าน `size` แล้วกระโดดข้าม
- ถ้า payload ที่อ่านจริงไม่ตรงกับ `size` โมดูลถือว่าผิดรูป (malformed)

### กฎเรื่องลำดับ

Section ที่ไม่ใช่ Custom ต้องปรากฏ **ตามลำดับ id** และ **ไม่เกินหนึ่งครั้ง** ยกเว้น DataCount ที่อยู่ก่อน Code:

```text
Type(1) → Import(2) → Function(3) → Table(4) → Memory(5) → Global(6)
→ Export(7) → Start(8) → Element(9) → DataCount(12) → Code(10) → Data(11)
```

> [!IMPORTANT]
> ข้อควรระวัง: **DataCount (id 12) ต้องมาก่อน Code (id 10)** แม้เลข id จะมากกว่า ส่วน Custom Section (id 0) วางที่ไหนก็ได้

---

## 2.3 รายละเอียดแต่ละ Section

### สรุป

| ID | ชื่อ | เนื้อหา | จำเป็น? |
| :---: | :--- | :--- | :---: |
| 0 | Custom | ข้อมูลเสริม (`name`, debug, `producers`) | ไม่ |
| 1 | Type | ลายเซ็นฟังก์ชัน | ถ้ามีฟังก์ชัน |
| 2 | Import | สิ่งที่นำเข้าจากโฮสต์ | ไม่ |
| 3 | Function | type index ของแต่ละฟังก์ชัน | ถ้ามีฟังก์ชัน |
| 4 | Table | ประกาศ table | ไม่ |
| 5 | Memory | ประกาศ memory | ไม่ |
| 6 | Global | ตัวแปร global + ค่าเริ่มต้น | ไม่ |
| 7 | Export | สิ่งที่ส่งออก | ไม่ (แต่ไม่ export = เรียกไม่ได้) |
| 8 | Start | ฟังก์ชันที่รันอัตโนมัติ | ไม่ |
| 9 | Element | ค่าเริ่มต้นของ table | ไม่ |
| 12 | DataCount | จำนวน data segment | ถ้าใช้ `memory.init`/`data.drop` |
| 10 | Code | ตัวโค้ดของทุกฟังก์ชัน | ถ้ามีฟังก์ชัน |
| 11 | Data | ข้อมูลเริ่มต้นของ memory | ไม่ |

ทุก section ที่เป็นรายการ (vector) ขึ้นต้นด้วย **จำนวนรายการ** (u32 LEB128) แล้วตามด้วยรายการ

### Section 1 — Type

```text
vec(functype)     functype = 0x60 vec(valtype) vec(valtype)
                                  พารามิเตอร์    ผลลัพธ์
```

ตัวอย่าง `(i32,i32)->i32`: `60 02 7F 7F 01 7F`

### Section 2 — Import

```text
vec(import)   import = module:name  field:name  desc
desc = 0x00 typeidx          ; ฟังก์ชัน
     | 0x01 tabletype        ; table
     | 0x02 limits           ; memory
     | 0x03 valtype mut      ; global
```

`name` = ความยาว (u32) + ไบต์ UTF-8 ฟังก์ชันที่ import จะได้ **function index ก่อน** ฟังก์ชันที่นิยามในโมดูล

### Section 3 — Function

รายการ type index เท่านั้น (ไม่มีโค้ด) ฟังก์ชันที่ i ในโมดูลใช้ type ที่ `typeidx[i]` ส่วนโค้ดจริงอยู่ใน Code section ที่ลำดับเดียวกัน

### Section 4 — Table

```text
tabletype = reftype(0x70|0x6F) limits
limits    = 0x00 min | 0x01 min max
```

### Section 5 — Memory

```text
limits: 0x00 min          ; ไม่จำกัดสูงสุด
        0x01 min max      ; หน่วยเป็น page (64 KiB)
```

ตัวอย่าง `05 03 01 00 01` = 1 memory, min 1 page

### Section 6 — Global

```text
vec(global)   global = valtype mut(0=const,1=var) init_expr(...0x0B)
```

### Section 7 — Export

```text
vec(export)   export = name kind(0=func,1=table,2=memory,3=global) index
```

### Section 8 — Start

index ของฟังก์ชันที่ไม่มีพารามิเตอร์/ผลลัพธ์ รันตอน instantiate

### Section 9 — Element

กำหนดค่าเริ่มต้นให้ table (เช่น วางฟังก์ชันที่ index 0..n) มีหลายรูปแบบตาม flag (active/passive/declarative) อธิบายเพิ่มในบทที่ 7

### Section 10 — Code

```text
vec(code)   code = size(u32)  func
func = vec(locals)  expr
locals = count(u32) valtype        ; ประกาศเป็นกลุ่ม
expr = instr* 0x0B
```

> [!WARNING]
> `locals` ประกาศเป็น **กลุ่ม (count, type)** ตัวแปรที่ถูกอ้างด้วย `local.get N` ต้องมี index น้อยกว่า (จำนวนพารามิเตอร์ + จำนวน locals ทั้งหมด) มิฉะนั้นเกิด `invalid local index` — ข้อผิดพลาดนี้เคยเจอจริงตอนทำ emitter ของ `sld` (บทที่ 11)

### Section 11 — Data

```text
vec(data)   data = flag expr? vec(byte)
flag 0: active, memory 0, มี offset expr
flag 1: passive (ใช้กับ memory.init)
flag 2: active, ระบุ memory index
```

ใช้เก็บสตริงและข้อมูลคงที่ที่ถูกคัดลอกเข้า memory ตอน instantiate

### Section 12 — DataCount

จำนวน data segment (u32) จำเป็นเพื่อให้ validator ตรวจ `memory.init` ใน Code section ได้แบบ single-pass ก่อนจะเห็น Data section

### Section 0 — Custom

```text
name (string)  bytes...
```

ไม่มีผลต่อการรัน ใช้เก็บข้อมูลเช่น `name` (ชื่อฟังก์ชัน/ตัวแปรสำหรับดีบัก), `producers`, `sourceMappingURL`

---

## 2.4 เครื่องมือ: `wasm-dump.js` อ่าน Section ด้วยตัวเอง

สคริปต์ [examples/wasm-dump.js](examples/wasm-dump.js) อ่านโครงสร้างทั้งหมดโดยไม่ใช้ไลบรารี มี logic หลักเพียง:

```javascript
let pos = 8;                         // ข้าม header
while (pos < bytes.length) {
  const id   = bytes[pos++];
  const size = readU32(bytes, st);   // ULEB128
  const end  = st.pos + size;
  // ... อ่านรายละเอียดตาม id ...
  st.pos = end;                      // กระโดดข้าม section
}
```

### ผลลัพธ์จริง 1: ไฟล์จาก `sld` (ไฟล์ C 2 ฟังก์ชัน)

```text
$ sld --target=wasm32 t.c -o t.wasm && node wasm-dump.js t.wasm
magic  : 00 61 73 6d ("\0asm")
version: 1
size   : 109 bytes

@0x0008  id= 1 Type      size=    12  2 types: (i32,i32)->(i32) (i32)->(i32)
@0x0016  id= 3 Function  size=     3  2 functions
@0x001b  id= 5 Memory    size=     3  1 memory: min=1 page(s) (64 KiB)
@0x0020  id= 7 Export    size=    21  3 exports: memory(memory#0), add(func#0), sq(func#1)
@0x0037  id=10 Code      size=    52  2 function bodies
```

มีเพียง 5 section ที่จำเป็น ไม่มี Import/Global/Data

### ผลลัพธ์จริง 2: ไฟล์จาก Emscripten (`syn.wasm` 65,598 ไบต์)

```text
@0x0008  id= 1 Type      size=   206  30 types
@0x00d9  id= 2 Import    size=    31  5 imports: a.a:func, a.b:func, ...
@0x00fa  id= 3 Function  size=    93  92 functions
@0x0159  id= 4 Table     size=     5  1 tables
@0x0160  id= 5 Memory    size=     7  1 memory: min=258 page(s) (16512 KiB), max=32768
@0x0169  id= 6 Global    size=     8  1 globals
@0x0173  id= 7 Export    size=    57  14 exports
@0x01ae  id= 9 Element   size=    17  1 element segments
@0x01c1  id=12 DataCount size=     1  dataCount=27
@0x01c4  id=10 Code      size= 60587  92 function bodies
@0xee73  id=11 Data      size=  4552  27 data segments
```

สังเกต:
- DataCount (id 12) อยู่ **ก่อน** Code (id 10) ตามกฎ
- ไฟล์ Emscripten เล็กกว่า 66 KB ส่วนใหญ่ (60,587 ไบต์) คือ Code ที่มาจาก libc (`malloc`, `sprintf` ฯลฯ)
- Memory เริ่มที่ 258 page (≈16 MiB) และ max 32,768 page (2 GiB)
- ชื่อ import/export ถูกย่อ (`a.a`, `f`, `g`) จากการ minify

---

## 2.5 สร้างโมดูลด้วยมือทีละ Section (ฝึกให้เข้าใจ)

ฟังก์ชัน `sq(x) = x*x` ที่ export:

```javascript
const sec = (id, payload) => [id, payload.length, ...payload]; // ใช้ได้เมื่อ payload < 128 ไบต์

const bytes = new Uint8Array([
  0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
  ...sec(1, [1, 0x60,1,0x7f, 1,0x7f]),                   // Type: (i32)->i32
  ...sec(3, [1, 0]),                                     // Function: 1 ฟังก์ชัน type 0
  ...sec(7, [1, 2,0x73,0x71, 0x00, 0]),                  // Export: "sq" func#0
  ...sec(10,[1, 7, 0, 0x20,0, 0x20,0, 0x6c, 0x0b]),      // Code: local.get0 local.get0 i32.mul end
]);
const { instance } = await WebAssembly.instantiate(bytes);
console.log(instance.exports.sq(12)); // 144
```

> [!NOTE]
> helper `sec()` ข้างต้นใช้ได้เฉพาะ payload สั้นกว่า 128 ไบต์ เพราะ `size` ต้องเข้ารหัส LEB128 (บทที่ 3) ถ้ามากกว่านั้นต้องใช้ฟังก์ชัน encode LEB128 จริง

---

## 2.6 ข้อผิดพลาดที่พบบ่อยในระดับ Binary

| ข้อความ error | สาเหตุ |
| :--- | :--- |
| `expected magic word 00 61 73 6d` | header ผิด หรือไฟล์ไม่ใช่ wasm (บ่อยสุด: server ส่ง HTML 404 มาแทน) |
| `section out of order` | เรียง section ผิดลำดับ |
| `section was shorter than expected size` | `size` ไม่ตรงกับ payload จริง |
| `function and code section have inconsistent lengths` | จำนวนใน Function ≠ Code |
| `invalid local index: N` | อ้าง local เกินจำนวนที่ประกาศ |

---

## สรุปบทที่ 2

- ไฟล์ Wasm = header 8 ไบต์ + ลำดับ section รูปแบบ `id | size | payload`
- ลำดับ section ถูกกำหนดตายตัว (DataCount มาก่อน Code)
- Section ที่เป็นรายการขึ้นต้นด้วยจำนวนรายการเสมอ และตัวเลขทั้งหมดเข้ารหัสแบบ LEB128
- เขียน parser เองได้ใน ~100 บรรทัด และสร้างโมดูลด้วยมือได้
- บทถัดไป: [ระบบประเภทข้อมูลและ LEB128](03-types-leb128.md)
