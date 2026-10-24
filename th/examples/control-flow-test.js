#!/usr/bin/env node
/*
 * control-flow-test.js — ทดสอบ Structured Control Flow (block, loop, br, br_if, br_table, dispatch)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * รัน: node control-flow-test.js
 */
const uleb = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (v) => { v = BigInt(v); const o = []; for (;;) { let b = Number(v & 0x7fn); v >>= 7n; const s = (b & 0x40) !== 0; if ((v === 0n && !s) || (v === -1n && s)) { o.push(b); return o; } o.push(b | 0x80); } };
const sec = (id, p) => [id, ...uleb(p.length), ...p];

function makeMod(params, results, locals, body) {
  const codeBody = [...uleb(locals.length), ...locals.flatMap(([c, t]) => [...uleb(c), t]), ...body, 0x0b];
  const sec10 = [1, ...uleb(codeBody.length), ...codeBody];
  const bytes = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...sec(1, [1, 0x60, ...uleb(params.length), ...params, ...uleb(results.length), ...results]),
    ...sec(3, [1, 0]),
    ...sec(7, [1, 1, 0x66, 0, 0]), // export "f"
    ...sec(10, sec10)
  ]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f;
}

console.log('=== Testing WebAssembly Structured Control Flow ===');

// 1. block + br (break to end of block)
const f1 = makeMod([0x7f], [0x7f], [], [
  0x02, 0x7f,            // block (result i32)
    0x20, 0,             // local.get 0
    0x45,                // i32.eqz
    0x04, 0x40,          // if (void)
      0x41, ...sleb(42), // i32.const 42
      0x0c, 1,           // br 1 (out of if, out of block with 42)
    0x0b,                // end if
    0x41, ...sleb(100),  // i32.const 100
  0x0b                   // end block
]);
console.log('1. block+br:     f(0) =', f1(0), '(expected 42), f(5) =', f1(5), '(expected 100)');

// 2. loop (while n > 0 sum += n; n--)
const f2 = makeMod([0x7f], [0x7f], [[1, 0x7f]], [
  0x03, 0x40,            // loop (void)
    0x20, 0,             // local.get 0 (n)
    0x45,                // i32.eqz
    0x04, 0x40,          // if (n == 0)
      0x20, 1,           // local.get 1 (sum)
      0x0f,              // return
    0x0b,                // end if
    0x20, 1, 0x20, 0, 0x6a, 0x21, 1, // sum += n
    0x20, 0, 0x41, 1, 0x6b, 0x21, 0, // n -= 1
    0x0c, 0,             // br 0 (loop again to top of loop)
  0x0b,                  // end loop
  0x20, 1                // return sum
]);
console.log('2. loop (sum):   f(10) =', f2(10), '(expected 55)');

// 3. if-else with expression result
const f3 = makeMod([0x7f], [0x7f], [], [
  0x20, 0,               // local.get 0
  0x04, 0x7f,            // if (result i32)
    0x41, 1,             // 1
  0x05,                  // else
    0x41, 2,             // 2
  0x0b                   // end if
]);
console.log('3. if-else:      f(1) =', f3(1), ', f(0) =', f3(0), '(expected 1, 2)');

// 4. br_table (jump table: 0 -> 10, 1 -> 20, default -> 99)
const f4 = makeMod([0x7f], [0x7f], [], [
  0x02, 0x40,            // block $default
    0x02, 0x40,          // block $c1
      0x02, 0x40,        // block $c0
        0x20, 0,         // local.get 0
        0x0e, 2, 0, 1, 2,// br_table: targets=[c0, c1], default=default
      0x0b,              // end $c0
      0x41, 10, 0x0f,    // return 10
    0x0b,                // end $c1
    0x41, 20, 0x0f,      // return 20
  0x0b,                  // end $default
  0x41, ...sleb(99)      // return 99
]);
console.log('4. br_table:     f(0) =', f4(0), ', f(1) =', f4(1), ', f(9) =', f4(9), '(expected 10, 20, 99)');

// 5. State-machine dispatch loop (Compiling arbitrary C goto to WebAssembly)
// int state_calc(int x) {
//     int acc = 0;
// L1: acc += x; if (x > 10) goto L_END;
// L2: x += 5; goto L1;
// L_END: return acc;
// }
const f5 = makeMod([0x7f], [0x7f], [[1, 0x7f], [1, 0x7f]], [ // local 1: acc, local 2: pc
  0x03, 0x40,            // loop $dispatch
    // block for L1 (pc == 0)
    0x20, 2, 0x45, 0x04, 0x40, // if pc == 0
      0x20, 1, 0x20, 0, 0x6a, 0x21, 1,     // acc += x
      0x20, 0, 0x41, 10, 0x4a, 0x04, 0x40, // if x > 10
        0x41, 2, 0x21, 2, // pc = 2 (L_END)
        0x0c, 2,          // br 2 to loop $dispatch
      0x0b,
      0x41, 1, 0x21, 2,   // pc = 1 (fallthrough to L2)
      0x0c, 1,            // br 1 to loop $dispatch
    0x0b,

    // block for L2 (pc == 1)
    0x20, 2, 0x41, 1, 0x46, 0x04, 0x40, // if pc == 1
      0x20, 0, 0x41, 5, 0x6a, 0x21, 0, // x += 5
      0x41, 0, 0x21, 2,   // pc = 0 (goto L1)
      0x0c, 1,            // br 1 to loop $dispatch
    0x0b,

    // block for L_END (pc == 2)
    0x20, 2, 0x41, 2, 0x46, 0x04, 0x40, // if pc == 2
      0x20, 1, 0x0f,      // return acc
    0x0b,
  0x0b,
  0x20, 1
]);
console.log('5. C goto dispatch: f(2) =', f5(2), '(expected 21)');
