# บทที่ 5: กฎการควบคุมการไหลและโครงสร้างบล็อก (Structured Control Flow & Validation)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • เอกสาร: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • โค้ด: [Apache-2.0 / MIT](../LICENSE)
> อ้างอิง: [W3C Core Spec — Control Instructions](https://webassembly.github.io/spec/core/binary/instructions.html#control-instructions) • [MDN Control Flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)

[⬅ บทที่ 4](04-instruction-set.md) | [สารบัญ](README.md) | [บทที่ 6 ➡](06-linear-memory.md)

> [!NOTE]
> ตัวอย่างโค้ดไบนารีและสถาปัตยกรรมทั้งหมดในบทนี้ ได้รับการทดสอบผ่าน V8 Engine จริงใน [examples/control-flow-test.js](examples/control-flow-test.js) (ครอบคลุม `block`, `loop`, `if-else`, `br_table`, และ State-Machine Dispatcher)

---

## 5.1 ทำไม WebAssembly ถึงไม่มีคำสั่งกระโดดอิสระ (`goto`)?

ในสถาปัตยกรรม CPU ฮาร์ดแวร์ทั่วไป (เช่น ARM64, x86-64) มีคำสั่งกระโดดแบบอิสระ (`jmp`, `b`, `b.eq`) ซึ่งสามารถกระโดดไปยังตำแหน่ง Memory Address หรือ Label ใดก็ได้ในโค้ด

แต่ใน **WebAssembly** มาตรฐาน W3C ได้จงใจ **ตัดคำสั่ง `goto` ออกอย่างสิ้นเชิง** และบังคับให้โปรแกรมต้องเขียนอยู่ในรูป **Structured Control Flow** (บล็อกแบบซ้อนกัน) ด้วยเหตุผลสำคัญ 4 ประการ:

1. **Fast Single-Pass Validation (ตรวจสอบความปลอดภัยได้ในรอบเดียว):**  
   หากยอมให้มี `goto` ข้ามบล็อกมั่วซั่ว ตัว Validator ของเบราว์เซอร์จะต้องสร้าง Control Flow Graph (CFG) และคำนวณชนิดข้อมูลบน Stack แบบ Dataflow Analysis ซึ่งกินเวลาและหน่วยความจำมหาศาล แต่ด้วยโครงสร้างบล็อก เบราว์เซอร์สามารถตรวจสอบชนิดและขนาดของสแตกได้ใน Pass เดียวด้วยความเร็วสูง
2. **Determinism & Static Stack Height (ความสูงของสแตกต้องรู้แน่นอนล่วงหน้า):**  
   ในทุกตำแหน่งของบล็อก จำนวนและชนิดของค่าบน Operand Stack จะต้องเท่าเดิมเสมอไม่ว่าจะไหลเข้ามาจากเส้นทางใด
3. **No Spacing/Dangling Return Address:**  
   ป้องกันการเจาะระบบแบบ Return-Oriented Programming (ROP) และการกระโดดข้ามตัวแปร local initialization
4. **Hardware JIT Compilation:**  
   บล็อกที่มีโครงสร้างช่วยให้ JIT Compiler แปลงโค้ดเป็นเนทีฟ Assembly ประสิทธิภาพสูงได้ทันที

---

## 5.2 คำสั่งสร้างบล็อกควบคุม (Block Constructs)

WebAssembly มีบล็อกควบคุม 3 ชนิดหลัก ทุกบล็อกต้องปิดท้ายด้วยคำสั่ง **`end` (`0x0B`)** เสมอ:

| Opcode | คำสั่ง | Immediate | สแตกผลลัพธ์ | ความหมาย |
| :---: | :--- | :--- | :--- | :--- |
| `0x02` | `block` | `blocktype` | `[t1*] -> [t2*]` | สร้างขอบเขตบล็อก (กระโดดออกไปข้างหน้า) |
| `0x03` | `loop` | `blocktype` | `[t1*] -> [t2*]` | สร้างลูปวนรอบ (กระโดดกลับไปหัวลูป) |
| `0x04` | `if` | `blocktype` | `[i32 t1*] -> [t2*]` | ตรวจเงื่อนไขจากค่าบนสุดของสแตก |
| `0x05` | `else` | ไม่มี | สลับเข้าแขนง else | สลับการทำงานเมื่อเงื่อนไข `if` เป็นเท็จ |
| `0x0B` | `end` | ไม่มี | ปิดบล็อก | ตัวปิดท้ายของ `block`, `loop`, `if`, หรือ `func` |

### Blocktype (ลายเซ็นของบล็อก)
บล็อกใน WebAssembly สามารถส่งผ่านค่าหรือคืนค่าผลลัพธ์ได้เหมือนฟังก์ชัน:
- `0x40` = **void** (บล็อกไม่คืนค่า)
- `0x7F` (`i32`), `0x7E` (`i64`), `0x7D` (`f32`), `0x7C` (`f64`) = บล็อกคืนค่า 1 ค่า
- `s33 LEB128` (ค่าจำนวนเต็มบวก) = Type Index ใน Type Section สำหรับรับและคืนค่าหลายค่า (Multi-value Blocks)

---

## 5.3 คำสั่งกระโดดด้วย Label Depth (`br`, `br_if`, `br_table`)

การกระโดดใน WebAssembly ไม่ได้กระโดดไปยังที่อยู่ของหน่วยความจำ แต่กระโดดอ้างอิงตาม **ความลึกของบล็อกที่ซ้อนกันอยู่ (Label Index / Depth)** โดยนับ `0` จากบล็อกในสุดที่ครอบตัวมันอยู่:

| Opcode | คำสั่ง | Immediate | สแตก | พฤติกรรม |
| :---: | :--- | :--- | :--- | :--- |
| `0x0C` | `br` | `labelidx (u32)` | `[val*] -> ...` | กระโดดทันทีแบบไม่มีเงื่อนไข |
| `0x0D` | `br_if` | `labelidx (u32)` | `[val* i32] -> [val*]` | ป๊อป `i32` ขึ้นมา ถ้า $\neq 0$ ให้กระโดด |
| `0x0E` | `br_table` | `vec(labelidx) labelidx` | `[val* i32] -> ...` | Jump Table คล้าย `switch-case` |
| `0x0F` | `return` | ไม่มี | `[val*] -> ...` | กระโดดออกจากฟังก์ชันทันที |

### ⚠️ กฎเหล็ก: ความแตกต่างระหว่าง `block` กับ `loop`
นี่คือจุดที่คนเขียน Wasm Compiler มักสับสนมากที่สุด:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. ภายใน `block`: `br 0` คือ "BREAK" (กระโดดข้ามไปท้ายบล็อก)  │
│ 2. ภายใน `loop`:  `br 0` คือ "CONTINUE" (กระโดดวนกลับมาหัวลูป)│
└─────────────────────────────────────────────────────────────┘
```

```text
(block $B                    (loop $L
  ...                          ...
  br 0  ───┐                   br 0  ───┐ (วนซ้ำ)
  ...      │                   ...      │
) <────────┘ (ออกนอก block)  ) <────────┘ (ไปหัว loop)
```

---

## 5.4 ตัวอย่างคำสั่งจริง (ทดสอบแล้ว)

### 1. การใช้ `block` และ `br` ส่งค่าผลลัพธ์ (Break with Value)
ถ้าส่ง `x == 0` ให้ break ออกจากบล็อกด้วยค่า `42` ถ้าไม่ใช่ให้ fallthrough ไปจบที่ `100`:

```wat
(func (export "f") (param i32) (result i32)
  (block (result i32)
    local.get 0
    i32.eqz
    (if
      (then
        i32.const 42
        br 1             ;; กระโดดออกจาก if (depth 0) และ block (depth 1) พร้อมหิ้วค่า 42
      )
    )
    i32.const 100        ;; ค่าปกติถ้าไม่เข้า if
  )                      ;; end block (รับค่า i32 ส่งออก)
)
```
- **Bytecode:** `02 7F 20 00 45 04 40 41 2A 0C 01 0B 41 E4 00 0B 0B`
- **ผลทดสอบ:** `f(0)` คืนค่า **42**, `f(5)` คืนค่า **100** ✔

---

### 2. ลูปคำนวณผลรวม (While Loop Pattern)
คำนวณ `sum = 10 + 9 + ... + 1`:

```wat
(func (export "f") (param $n i32) (result i32)
  (local $sum i32)
  (loop
    local.get $n
    i32.eqz
    if
      local.get $sum
      return             ;; ถ้า n == 0 คืนค่าทันที
    end
    local.get $sum
    local.get $n
    i32.add
    local.set $sum       ;; sum += n
    local.get $n
    i32.const 1
    i32.sub
    local.set $n         ;; n -= 1
    br 0                 ;; br 0 ใน loop = กระโดดวนกลับไปหัวลูป
  )
  local.get $sum
)
```
- **ผลทดสอบ:** `f(10)` คืนค่า **55** ✔

---

### 3. การสร้าง Jump Table ด้วย `br_table` (Switch-Case)
คำสั่ง `br_table` รับ vector ของ label indices ตามด้วย default label index และรับค่า index จากสแตก:

```text
br_table [label0, label1, ...] label_default
```

```wat
(func (export "f") (param i32) (result i32)
  (block $default
    (block $case1
      (block $case0
        local.get 0
        br_table 0 1 2   ;; 0 -> $case0, 1 -> $case1, ค่าอื่น -> $default
      )
      i32.const 10
      return             ;; Case 0: คืนค่า 10
    )
    i32.const 20
    return               ;; Case 1: คืนค่า 20
  )
  i32.const 99           ;; Default: คืนค่า 99
)
```
- **Bytecode:** `02 40 02 40 02 40 20 00 0E 02 00 01 02 0B 41 0A 0F 0B 41 14 0F 0B 41 E3 00 0B`
- **ผลทดสอบ:** `f(0)` $\rightarrow$ **10**, `f(1)` $\rightarrow$ **20**, `f(9)` $\rightarrow$ **99** ✔

---

## 5.5 การแปลงภาษา C ที่มี `goto` ให้เป็น Wasm (State-Machine Dispatch Loop)

เนื่องจากภาษา C มีคำสั่ง `goto` ข้ามบล็อกอิสระ แต่ Wasm ไม่มี `goto` ตัวคอมไพเลอร์อย่าง `sld` จึงใช้วิธี **State-Machine Dispatch Loop (Program Counter Emulation)**:

### ตัวอย่างโค้ดภาษา C:
```c
int state_calc(int x) {
    int acc = 0;
L1:
    acc += x;
    if (x > 10) goto L_END;
L2:
    x += 5;
    goto L1;
L_END:
    return acc;
}
```

### แปลงเป็น WebAssembly Architecture ใน [`sld_wasm.c`](file:///Volumes/Mac%20Backup/compiler-dev/sld-compiler/src/sld_wasm.c):
1. สร้าง Local Register พิเศษชื่อ `$pc` (Program Counter) เริ่มต้นที่ `0`
2. ครอบบล็อกคำสั่งทั้งหมดไว้ใน `loop $dispatch`
3. แต่ละ Label ใน C จะกลายเป็นเงื่อนไข `if ($pc == label_id)`
4. เมื่อสั่ง `goto target_label` ใน C จะแปลงเป็น:
   ```text
   i32.const target_label_id
   local.set $pc
   br 1  ;; กระโดดออกจาก if แล้ววนกลับไปหัว loop $dispatch
   ```

```wat
(func (export "f") (param $x i32) (result i32)
  (local $acc i32)
  (local $pc i32)        ;; ตัวนับ Program Counter
  (loop $dispatch
    ;; Block L1 (pc == 0)
    local.get $pc
    i32.eqz
    (if
      local.get $acc
      local.get $x
      i32.add
      local.set $acc     ;; acc += x

      local.get $x
      i32.const 10
      i32.gt_s
      (if
        i32.const 2
        local.set $pc    ;; pc = 2 (L_END)
        br 2             ;; กระโดดไป loop $dispatch
      )
      i32.const 1
      local.set $pc      ;; pc = 1 (fallthrough ไป L2)
      br 1               ;; กระโดดไป loop $dispatch
    )

    ;; Block L2 (pc == 1)
    local.get $pc
    i32.const 1
    i32.eq
    (if
      local.get $x
      i32.const 5
      i32.add
      local.set $x       ;; x += 5
      i32.const 0
      local.set $pc      ;; pc = 0 (goto L1)
      br 1               ;; กระโดดไป loop $dispatch
    )

    ;; Block L_END (pc == 2)
    local.get $pc
    i32.const 2
    i32.eq
    (if
      local.get $acc
      return             ;; คืนค่าผลลัพธ์ acc
    )
  )
  local.get $acc
)
```
- **ผลทดสอบเมื่อส่ง $x = 2$:**  
  - รอบ 1 (L1): `acc = 2`, `x = 2` ($\le 10$) $\rightarrow$ ไป L2
  - รอบ 2 (L2): `x = 7` $\rightarrow$ ไป L1
  - รอบ 3 (L1): `acc = 2 + 7 = 9`, `x = 7` ($\le 10$) $\rightarrow$ ไป L2
  - รอบ 4 (L2): `x = 12` $\rightarrow$ ไป L1
  - รอบ 5 (L1): `acc = 9 + 12 = 21`, `x = 12` ($> 10$) $\rightarrow$ ไป L_END
  - คืนค่าผลลัพธ์ **21** ถูกต้องแม่นยำ 100% ✔

---

## 5.6 Stack Polymorphism และคำสั่ง `unreachable`

เมื่อคำสั่งอย่าง `unreachable` (`0x00`), `return` (`0x0F`), หรือ `br` แบบไม่มีเงื่อนไข (`0x0C`) ทำงาน เส้นทางการประมวลผลปกติจะสิ้นสุดลง (Unreachable Code)

มาตรฐาน W3C กำหนดว่าหลังคำสั่งเหล่านี้ **Operand Stack จะเข้าสู่สถานะ Polymorphic (ยืดหยุ่นรองรับทุกชนิด):**
- ตัว Validator จะอนุญาตให้คำสั่งถัดไป (ก่อนถึง `end` หรือ `else`) ดึงค่าอะไรออกจากสแตกก็ได้เสมือนมีค่าอยู่จริง เพื่อให้คอมไพเลอร์ไม่ต้องล้างสแตกด้วยมือ
- ตัวอย่างเช่น:
  ```wat
  unreachable
  i32.add      ;; ผ่าน validation! แม้บนสแตกจะไม่มี i32 สองตัว เพราะ unreachable เติม type ให้แบบ polymorphic
  ```

---

## สรุปบทที่ 5

- Wasm บังคับใช้ **Structured Control Flow** เพื่อให้ตรวจสอบความถูกต้องได้ใน Pass เดียว ปลอดภัย และคอมไพล์ลง JIT ได้เร็ว
- `br` อ้างอิงตามความลึก (Label Depth): **`br` ใน `block` คือ break ออกไปข้างหน้า, `br` ใน `loop` คือ continue วนกลับไปหัวลูป**
- สามารถแปลง `goto` ในภาษา C ไปเป็น WebAssembly ได้อย่างราบรื่นโดยใช้ **State-Machine Dispatch Loop**
- บล็อกสามารถรับและส่งค่ากลับผ่านสแตกได้ด้วย `blocktype`
- บทถัดไป: [แบบจำลองหน่วยความจำเชิงเส้น (Linear Memory Model)](06-linear-memory.md)
