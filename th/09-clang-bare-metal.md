# บทที่ 9: การคอมไพล์ C/C++ สู่ Wasm ด้วย Clang โดยไม่ใช้ Emscripten (Bare-Metal Wasm Toolchain)

> ผู้เขียน: Wirot Chookeaw (`chin6700x`) • License: Apache-2.0 / MIT © 2026  
> อ้างอิง: [LLVM WebAssembly Documentation](https://llvm.org/docs/WebAssembly.html) • [LLD WebAssembly Port (wasm-ld)](https://lld.llvm.org/WebAssembly.html)

[⬅ บทที่ 8](08-js-integration.md) | [สารบัญ](README.md) | [บทที่ 10 ➡](10-sovereign-emitter.md)

> [!NOTE]
> ตัวอย่างซอร์สโค้ดภาษา C และสคริปต์คอมไพล์ไบนารีขนาด 711 ไบต์ (< 1 KB) ในบทนี้ สามารถทดสอบและคอมไพล์ผ่านเครื่องจริงได้ทันทีด้วย [examples/bare-metal.c](examples/bare-metal.c) และ [examples/bare-metal-test.js](examples/bare-metal-test.js)

---

## 9.1 ความแตกต่างระหว่าง `emcc` กับ `clang --target=wasm32`

ในการพัฒนา WebAssembly จากภาษา C หรือ C++ นักพัฒนาส่วนใหญ่มักเริ่มต้นด้วย **Emscripten (`emcc`)** ซึ่งเป็น Toolchain ที่ทรงพลัง แต่สำหรับงานวิศวกรรมระบบระดับแกนกลาง (Core Systems) หรือ Micro-modules ทั้งสองแนวทางมีความแตกต่างกันอย่างมีนัยสำคัญ:

```
+------------------------------------+------------------------------------+
|          Emscripten (emcc)         |     Bare-Metal (clang -target)     |
+------------------------------------+------------------------------------+
| • จำลองระบบปฏิบัติการ POSIX บนเว็บ | • ผลิตเฉพาะ WebAssembly ไบต์โค้ดแท้ |
| • มี Virtual File System (MEMFS)   | • ไม่มีระบบไฟล์ ไม่มี Syscall Bloat |
| • สร้างไฟล์ Glue JS ขนาด 50KB - 2MB | • ขนาดไฟล์ไบนารีเพียง 200B - 2KB  |
| • เหมาะสำหรับพอร์ตเกม C++/SDL/OpenGL| • เหมาะสำหรับ Core Libraries/Crypto|
+------------------------------------+------------------------------------+
```

| มิติการเปรียบเทียบ | Emscripten (`emcc`) | Bare-Metal Clang (`wasm32-clang`) |
| :--- | :--- | :--- |
| **ขนาดไบนารีขั้นต่ำ** | มักเริ่มต้นที่ 15 KB – 100+ KB (รวม JS) | **200 ไบต์ – 1 KB** (Wasm บริสุทธิ์) |
| **การพึ่งพา JavaScript** | ต้องมี Glue Code JS ขนาดยักษ์ในการบูต | **ไม่ต้องใช้ Glue Code** โหลดผ่าน JS ธรรมดาได้ |
| **เวลาในการคอมไพล์** | ช้า (ประมวลผลหลายขั้นตอน) | **เร็วมากในระดับเสี้ยววินาที (< 50ms)** |
| **การจัดการหน่วยความจำ** | บังคับใช้ `dlmalloc` / `emmalloc` | **โปรแกรมเมอร์ควบคุมเอง 100%** |
| **ความเหมาะสม** | เกม, กราฟิก 3D (WebGL), แอพ Desktop เก่า | **Crypto, Parser, Math Engine, Sovereign Modules** |

---

## 9.2 สถาปัตยกรรม LLVM WebAssembly และ `wasm-ld`

LLVM (ตั้งแต่เวอร์ชัน 8 เป็นต้นมา) บรรจุ WebAssembly Backend (`wasm32` และ `wasm64`) ไว้เป็นคอมไพเลอร์เป้าหมายมาตรฐานโดยไม่ต้องติดตั้งปลั๊กอินเพิ่มเติม  
การคอมไพล์จาก C สู่ Wasm จะแบ่งเป็น 2 ส่วนหลัก:
1. **Frontend (`clang`):** แปลงโค้ด C/C++ เป็น LLVM Bitcode/Object File (`.o`) ในรูป WebAssembly Object Format
2. **Linker (`wasm-ld`):** ลิงก์ Object Files เข้าด้วยกัน, จัดสรรโครงสร้างหน่วยความจำ (Static Data, Stack, Heap), และสังเคราะห์ Wasm Binary Sections

```
+---------------+      +-------------------+      +-------------+      +-----------------+
|  Source Code  | ───► |       Clang       | ───► |   wasm-ld   | ───► | Sub-1KB .wasm   |
| (bare-metal.c)|      | (--target=wasm32) |      |   Linker    |      | (Pure Hardware) |
+---------------+      +-------------------+      +-------------+      +-----------------+
```

### พารามิเตอร์และธงสำคัญ (Compiler & Linker Flags):

```bash
clang --target=wasm32 -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=add -Wl,--export=fib \
  -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
  -Wl,--strip-all \
  -o app.wasm bare-metal.c
```

| Flag | ความสำคัญทางเทคนิค |
| :--- | :--- |
| **`--target=wasm32`** | กำหนดสถาปัตยกรรมเป้าหมายเป็น 32-bit WebAssembly (หรือใช้ `wasm32-clang`) |
| **`-O3`** | ปรับแต่งประสิทธิภาพสูงสุด ยุบรวมลูป และตัดโค้ดที่ไม่ได้ใช้ (Dead Code Elimination) |
| **`-nostdlib`** | ปิดการเชื่อมโยง C Standard Library (ไม่นำ `libc.a` หรือ `crt0.o` มาพ่วง) |
| **`-Wl,--no-entry`** | สั่งให้ `wasm-ld` ไม่ต้องค้นหาฟังก์ชัน `main()` (เนื่องจากเราสร้างไลบรารี) |
| **`-Wl,--export=symbol`** | กำหนดชื่อฟังก์ชัน C ที่ต้องการ Export ออกสู่ WebAssembly Export Section |
| **`-Wl,--export-all`** | ส่งออกฟังก์ชันและตัวแปร Global ทั้งหมด (เหมาะสำหรับการทดสอบ) |
| **`-Wl,--allow-undefined`** | อนุญาตให้เรียกฟังก์ชันที่ไม่มีนิยามในโค้ด โดย Linker จะแปลงเป็น Import Section อัตโนมัติ |
| **`-Wl,--strip-all`** | ลบตารางสัญลักษณ์สำหรับดีบัก (`name` custom section) เพื่อให้ได้ไบนารีที่เล็กที่สุด |

---

## 9.3 ปัญหาขาดแคลน C Standard Library (Libc-less Environment) และทางออก

เมื่อใช้งานโหมด `-nostdlib` เราจะไม่สามารถเรียกใช้ฟังก์ชันมาตรฐานอย่าง `malloc()`, `free()`, `memcpy()`, หรือ `printf()` ได้ หากต้องการใช้ฟังก์ชันเหล่านี้ เรามีทางเลือกทางวิศวกรรมที่สะอาดและมีประสิทธิภาพสูง:

### 1. สัญลักษณ์มหัศจรรย์: `extern unsigned char __heap_base;`
เมื่อ `wasm-ld` จัดวาง Layout หน่วยความจำ มันจะวาง Data Segment และ Stack ไว้ที่ตอนต้น และสร้างสัญลักษณ์พิเศษชื่อ **`__heap_base`** ชี้ไปยังตำแหน่งแรกสุดของหน่วยความจำว่างที่ปลอดภัยสำหรับ Heap:

```
+----------------------+--------------------+---------------------------------------+
|  Static Data Segment | Stack (เติบโตลง)   | Heap เริ่มต้น (__heap_base)            |
|  (สตริงค่าคงที่ ฯลฯ) |                    | สามารถจัดสรร (malloc) ต่อจากจุดนี้     |
+----------------------+--------------------+---------------------------------------+
0                                           ▲
                                            │
                                  extern unsigned char __heap_base;
```

### 2. การสร้าง Bump Allocator ภายในภาษา C (เพียง 10 บรรทัด):
```c
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

void* my_malloc(unsigned long size) {
    if (heap_top == 0) {
        heap_top = (unsigned long)&__heap_base;
    }
    unsigned long old = heap_top;
    // Align ที่ขอบ 8 ไบต์เสมอ: (old + size + 7) & ~7
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}
```

### 3. การสร้างฟังก์ชันพื้นฐานสำหรับ Memory & String:
```c
void* my_memcpy(void* dest, const void* src, unsigned long n) {
    char* d = (char*)dest;
    const char* s = (const char*)src;
    while (n--) *d++ = *s++;
    return dest;
}

unsigned long my_strlen(const char* s) {
    const char* p = s;
    while (*p) p++;
    return (unsigned long)(p - s);
}
```

---

## 9.4 กรณีศึกษา: การสร้าง Wasm ไบนารีขนาดเล็กกว่า 1 KB (Sub-1KB)

ตัวอย่างซอร์สโค้ด [bare-metal.c](examples/bare-metal.c) ที่ประกอบด้วย:
- ฟังก์ชันคำนวณคณิตศาสตร์ (`add`, `fib`)
- ระบบจัดสรรหน่วยความจำ Heap (`my_malloc`)
- ฟังก์ชันประมวลผลสตริงใน Linear Memory (`reverse_c`)
- ฟังก์ชันประมวลผลอาร์เรย์ทศนิยม (`dot_product`)

```c
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

void* my_malloc(unsigned long size) {
    if (heap_top == 0) heap_top = (unsigned long)&__heap_base;
    unsigned long old = heap_top;
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}

int add(int a, int b) { return a + b; }

int fib(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b; a = b; b = c;
    }
    return b;
}

char* reverse_c(char* str, int len) {
    int i = 0, j = len - 1;
    while (i < j) {
        char temp = str[i]; str[i] = str[j]; str[j] = temp;
        i++; j--;
    }
    return str;
}

float dot_product(const float* a, const float* b, int n) {
    float sum = 0.0f;
    for (int i = 0; i < n; i++) sum += a[i] * b[i];
    return sum;
}
```

### ผลลัพธ์การคอมไพล์จริง:
เมื่อคอมไพล์ด้วยคำสั่ง:
```bash
wasm32-clang -O3 -nostdlib -Wl,--no-entry \
  -Wl,--export=add -Wl,--export=fib \
  -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
  -Wl,--export=reverse_c -Wl,--export=dot_product \
  -Wl,--strip-all -o bare-metal.wasm bare-metal.c
```

ขนาดไฟล์ไบนารีที่ได้มีขนาดเพียง **711 ไบต์เท่านั้น!** (น้อยกว่า 1 กิโลไบต์)  
สามารถนำไปโหลดและรันบนเบราว์เซอร์หรือ Node.js ได้ทันทีโดยไม่ต้องพึ่งพาไฟล์ JavaScript เสริมใดๆ ทั้งสิ้น

สามารถทดสอบรันการคอมไพล์และการประมวลผลจริงได้ที่ [examples/bare-metal-test.js](examples/bare-metal-test.js)

---

[⬅ บทที่ 8: การทำงานร่วมกับ JavaScript และ Browser API](08-js-integration.md) | [สารบัญหลัก](README.md) | [บทที่ 10: การสร้าง Sovereign WebAssembly Emitter ด้วยตนเอง ➡](10-sovereign-emitter.md)
