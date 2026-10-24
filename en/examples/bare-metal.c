/**
 * Bare-Metal WebAssembly in Pure C (No Emscripten, No Libc)
 * Bare-metal C source code compiled directly to Wasm via Clang
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 * 
 * Compile command:
 *   wasm32-clang -O3 -nostdlib -Wl,--no-entry \
 *     -Wl,--export=add -Wl,--export=fib \
 *     -Wl,--export=my_malloc -Wl,--export=get_heap_offset \
 *     -Wl,--export=reverse_c -Wl,--export=dot_product \
 *     -Wl,--strip-all -o bare-metal.wasm bare-metal.c
 */

// Special symbol emitted by wasm-ld designating the safe start of heap space in Linear Memory
extern unsigned char __heap_base;
static unsigned long heap_top = 0;

// Tiny bump allocator implemented in pure C
void* my_malloc(unsigned long size) {
    if (heap_top == 0) {
        heap_top = (unsigned long)&__heap_base;
    }
    unsigned long old = heap_top;
    // Always align to 8-byte boundary: (old + size + 7) & ~7
    heap_top = (old + size + 7) & ~7UL;
    return (void*)old;
}

unsigned long get_heap_offset(void) {
    if (heap_top == 0) return (unsigned long)&__heap_base;
    return heap_top;
}

// 1. Basic arithmetic function
int add(int a, int b) {
    return a + b;
}

// 2. Iterative O(N) Fibonacci calculation
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

// 3. In-place string reversal in Linear Memory
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

// 4. Vector dot product computation on float arrays
float dot_product(const float* a, const float* b, int n) {
    float sum = 0.0f;
    for (int i = 0; i < n; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}
