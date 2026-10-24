/*
 * leb128.c — ULEB128 / SLEB128 encode & decode for WebAssembly
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * Compile:  clang -std=c99 -Wall -Wextra -O2 leb128.c -o leb128 && ./leb128
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Encodes ULEB128 to out buffer; returns number of bytes written (up to 10 bytes for u64) */
static size_t uleb_encode(uint64_t v, uint8_t *out) {
    size_t n = 0;
    do {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;
        if (v != 0) byte |= 0x80;          /* Continuation bit set */
        out[n++] = byte;
    } while (v != 0);
    return n;
}

/* Encodes SLEB128 (two's complement, sign-extended) */
static size_t sleb_encode(int64_t v, uint8_t *out) {
    size_t n = 0;
    int more = 1;
    while (more) {
        uint8_t byte = (uint8_t)(v & 0x7F);
        v >>= 7;                            /* Arithmetic shift preserving sign bit */
        int sign_bit_clear = (byte & 0x40) == 0;
        if ((v == 0 && sign_bit_clear) || (v == -1 && !sign_bit_clear))
            more = 0;                       /* Final byte reached */
        else
            byte |= 0x80;
        out[n++] = byte;
    }
    return n;
}

/* Decodes ULEB128; returns byte count read, or 0 if malformed / exceeds max length */
static size_t uleb_decode(const uint8_t *in, uint64_t *out) {
    uint64_t result = 0;
    unsigned shift = 0;
    size_t n = 0;
    for (;;) {
        if (n >= 10) return 0;
        uint8_t byte = in[n++];
        result |= (uint64_t)(byte & 0x7F) << shift;
        shift += 7;
        if ((byte & 0x80) == 0) break;
    }
    *out = result;
    return n;
}

static size_t sleb_decode(const uint8_t *in, int64_t *out) {
    int64_t result = 0;
    unsigned shift = 0;
    size_t n = 0;
    uint8_t byte;
    do {
        if (n >= 10) return 0;
        byte = in[n++];
        result |= (int64_t)(byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    if (shift < 64 && (byte & 0x40))
        result |= -((int64_t)1 << shift);   /* Sign-extend */
    *out = result;
    return n;
}

static void print_hex(const uint8_t *b, size_t n) {
    for (size_t i = 0; i < n; i++) printf("%02x%s", b[i], i + 1 < n ? " " : "");
}

int main(void) {
    const uint64_t u_cases[] = {0, 1, 63, 64, 127, 128, 624485, 0xFFFFFFFFu};
    const int64_t  s_cases[] = {0, 1, -1, 63, 64, -64, -65, 624485, -123456,
                                2147483647LL, -2147483648LL};
    int fail = 0;
    uint8_t buf[16];

    printf("--- ULEB128 ---\n");
    for (size_t i = 0; i < sizeof u_cases / sizeof *u_cases; i++) {
        size_t n = uleb_encode(u_cases[i], buf);
        uint64_t back = 0;
        size_t m = uleb_decode(buf, &back);
        printf("%-12llu -> [", (unsigned long long)u_cases[i]);
        print_hex(buf, n);
        printf("]%s\n", (m == n && back == u_cases[i]) ? "" : "  FAIL");
        if (m != n || back != u_cases[i]) fail = 1;
    }

    printf("--- SLEB128 ---\n");
    for (size_t i = 0; i < sizeof s_cases / sizeof *s_cases; i++) {
        size_t n = sleb_encode(s_cases[i], buf);
        int64_t back = 0;
        size_t m = sleb_decode(buf, &back);
        printf("%-12lld -> [", (long long)s_cases[i]);
        print_hex(buf, n);
        printf("]%s\n", (m == n && back == s_cases[i]) ? "" : "  FAIL");
        if (m != n || back != s_cases[i]) fail = 1;
    }

    printf(fail ? "RESULT: FAIL\n" : "RESULT: ALL ROUND-TRIPS OK\n");
    return fail;
}
