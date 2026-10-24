/**
 * Bare-Metal WebAssembly in Pure C (No Emscripten, No Libc)
 * ซอร์สโค้ดภาษา C ระดับ Bare-Metal สำหรับคอมไพล์ตรงสู่ Wasm ด้วย Clang
 * 
 * ผู้เขียน: Wirot Chookeaw (chin6700x)
 * สัญญาอนุญาต: Apache-2.0 / MIT © 2026
 * 
 * คอมไพล์ด้วยคำสั่ง:
 *   wasm32-clang -O3 -nostdlib -Wl,--no-entry \
 *     -Wl,--export=add -Wl,--export=fib \
 *     -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
 *     -Wl,--export=reverse_c -Wl,--export=dot_product \
 *     -Wl,--strip-all -o bare-metal.wasm bare-metal.c
 */

// สัญลักษณ์พิเศษจาก wasm-ld ที่ระบุจุดเริ่มต้นของ Heap ที่ปลอดภัยใน Linear Memory
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

// ระบบจัดสรรหน่วยความจำ Bump Allocator ขนาดจิ๋วในระดับ C
void* my_malloc(unsigned long size) {
    if (heap_top == 0) {
        heap_top = (unsigned long)&__heap_base;
    }
    unsigned long old = heap_top;
    // Align ที่ 8 ไบต์เสมอ: (old + size + 7) & ~7
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}

unsigned long get_heap_offset(void) {
    if (heap_top == 0) return (unsigned long)&__heap_base;
    return heap_top;
}

// 1. ฟังก์ชันคำนวณพื้นฐาน
int add(int a, int b) {
    return a + b;
}

// 2. ฟังก์ชันหาลำดับ Fibonacci แบบ O(N) Iterative
int fib(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b;
        a = b;
        b = c;
    }
    return b;
}

// 3. ฟังก์ชันประมวลผล String ใน Linear Memory
char* reverse_c(char* str, int len) {
    int i = 0, j = len - 1;
    while (i < j) {
        char temp = str[i];
        str[i] = str[j];
        str[j] = temp;
        i++;
        j--;
    }
    return str;
}

// 4. ฟังก์ชันประมวลผลอาร์เรย์ตัวเลข (Vector Dot Product)
float dot_product(const float* a, const float* b, int n) {
    float sum = 0.0f;
    for (int i = 0; i < n; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}
