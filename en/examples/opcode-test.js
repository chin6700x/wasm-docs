#!/usr/bin/env node
/*
 * opcode-test.js — Verifying WebAssembly opcode semantics directly against production V8 Engine
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 *
 * Each test case synthesizes a miniature module containing one function:
 * local.get [params...] -> [opcode] -> end
 * Evaluates return value with Object.is to differentiate -0 and NaN.
 * Usage: node opcode-test.js
 */
const T = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };

function uleb(v) { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; }
const vec = (items) => [...uleb(items.length), ...items.flat()];
const section = (id, payload) => [id, ...uleb(payload.length), ...payload];

function build(ptypes, rtype, body) {
  const code = [0x00, ...body, 0x0b];                      // 0 locals
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, vec([[0x60, ...vec(ptypes.map(t => [T[t]])), ...vec(rtype ? [[T[rtype]]] : [])]])),
    ...section(3, vec([[0]])),
    ...section(7, vec([[1, 0x66, 0x00, 0]])),               // export "f"
    ...section(10, vec([[...uleb(code.length), ...code]])),
  ]);
}
function run(ptypes, rtype, opBytes, args) {
  const body = [];
  ptypes.forEach((_, i) => body.push(0x20, i));
  body.push(...opBytes);
  const m = new WebAssembly.Instance(new WebAssembly.Module(build(ptypes, rtype, body)));
  return m.exports.f(...args);
}

const B = (x) => BigInt.asIntN(64, BigInt(x));
const MIN32 = -2147483648, MAX32 = 2147483647;
// [name, opcode(bytes), param_types, result_type, arguments, expected_value]
const cases = [
  // ---- i32 Comparisons ----
  ['i32.eqz 0', [0x45], ['i32'], 'i32', [0], 1],
  ['i32.eqz 5', [0x45], ['i32'], 'i32', [5], 0],
  ['i32.eq', [0x46], ['i32', 'i32'], 'i32', [7, 7], 1],
  ['i32.ne', [0x47], ['i32', 'i32'], 'i32', [7, 7], 0],
  ['i32.lt_s -1<1', [0x48], ['i32', 'i32'], 'i32', [-1, 1], 1],
  ['i32.lt_u -1<1', [0x49], ['i32', 'i32'], 'i32', [-1, 1], 0],
  ['i32.gt_s', [0x4a], ['i32', 'i32'], 'i32', [-1, 1], 0],
  ['i32.gt_u', [0x4b], ['i32', 'i32'], 'i32', [-1, 1], 1],
  ['i32.le_s', [0x4c], ['i32', 'i32'], 'i32', [3, 3], 1],
  ['i32.le_u', [0x4d], ['i32', 'i32'], 'i32', [-1, 1], 0],
  ['i32.ge_s', [0x4e], ['i32', 'i32'], 'i32', [-1, 1], 0],
  ['i32.ge_u', [0x4f], ['i32', 'i32'], 'i32', [-1, 1], 1],
  // ---- i64 Comparisons ----
  ['i64.eqz', [0x50], ['i64'], 'i32', [0n], 1],
  ['i64.eq', [0x51], ['i64', 'i64'], 'i32', [5n, 5n], 1],
  ['i64.lt_s', [0x53], ['i64', 'i64'], 'i32', [-1n, 1n], 1],
  ['i64.lt_u', [0x54], ['i64', 'i64'], 'i32', [-1n, 1n], 0],
  // ---- Floating-point Comparisons ----
  ['f32.eq', [0x5b], ['f32', 'f32'], 'i32', [1.5, 1.5], 1],
  ['f64.lt', [0x63], ['f64', 'f64'], 'i32', [1, 2], 1],
  ['f64.lt NaN', [0x63], ['f64', 'f64'], 'i32', [NaN, 1], 0],
  ['f64.ne NaN', [0x62], ['f64', 'f64'], 'i32', [NaN, NaN], 1],
  // ---- i32 Arithmetic ----
  ['i32.clz 1', [0x67], ['i32'], 'i32', [1], 31],
  ['i32.ctz 8', [0x68], ['i32'], 'i32', [8], 3],
  ['i32.popcnt 255', [0x69], ['i32'], 'i32', [255], 8],
  ['i32.add', [0x6a], ['i32', 'i32'], 'i32', [2, 3], 5],
  ['i32.add wrap', [0x6a], ['i32', 'i32'], 'i32', [MAX32, 1], MIN32],
  ['i32.sub', [0x6b], ['i32', 'i32'], 'i32', [2, 3], -1],
  ['i32.mul', [0x6c], ['i32', 'i32'], 'i32', [6, 7], 42],
  ['i32.div_s -7/2', [0x6d], ['i32', 'i32'], 'i32', [-7, 2], -3],
  ['i32.div_u -7/2', [0x6e], ['i32', 'i32'], 'i32', [-7, 2], 2147483644],
  ['i32.rem_s -7%2', [0x6f], ['i32', 'i32'], 'i32', [-7, 2], -1],
  ['i32.rem_u -7%2', [0x70], ['i32', 'i32'], 'i32', [-7, 2], 1],
  ['i32.and', [0x71], ['i32', 'i32'], 'i32', [12, 10], 8],
  ['i32.or', [0x72], ['i32', 'i32'], 'i32', [12, 10], 14],
  ['i32.xor', [0x73], ['i32', 'i32'], 'i32', [12, 10], 6],
  ['i32.shl 1<<31', [0x74], ['i32', 'i32'], 'i32', [1, 31], MIN32],
  ['i32.shl 1<<33 (mod 32)', [0x74], ['i32', 'i32'], 'i32', [1, 33], 2],
  ['i32.shr_s -8>>1', [0x75], ['i32', 'i32'], 'i32', [-8, 1], -4],
  ['i32.shr_u -8>>>1', [0x76], ['i32', 'i32'], 'i32', [-8, 1], 2147483644],
  ['i32.rotl', [0x77], ['i32', 'i32'], 'i32', [0x80000001 | 0, 1], 3],
  ['i32.rotr', [0x78], ['i32', 'i32'], 'i32', [1, 1], MIN32],
  // ---- i64 Arithmetic ----
  ['i64.clz 1', [0x79], ['i64'], 'i64', [1n], 63n],
  ['i64.add', [0x7c], ['i64', 'i64'], 'i64', [2n, 3n], 5n],
  ['i64.div_s', [0x7f], ['i64', 'i64'], 'i64', [-7n, 2n], -3n],
  ['i64.shr_s', [0x87], ['i64', 'i64'], 'i64', [-8n, 1n], -4n],
  ['i64.shr_u', [0x88], ['i64', 'i64'], 'i64', [-8n, 1n], B(9223372036854775804n)],
  ['i64.rotl', [0x89], ['i64', 'i64'], 'i64', [B(0x8000000000000001n), 1n], 3n],
  // ---- Floating-point Arithmetic ----
  ['f64.add', [0xa0], ['f64', 'f64'], 'f64', [0.5, 0.25], 0.75],
  ['f64.sqrt 9', [0x9f], ['f64'], 'f64', [9], 3],
  ['f64.ceil 1.2', [0x9b], ['f64'], 'f64', [1.2], 2],
  ['f64.floor -1.2', [0x9c], ['f64'], 'f64', [-1.2], -2],
  ['f64.trunc -1.9', [0x9d], ['f64'], 'f64', [-1.9], -1],
  ['f64.nearest 2.5 (ties to even)', [0x9e], ['f64'], 'f64', [2.5], 2],
  ['f64.nearest 3.5', [0x9e], ['f64'], 'f64', [3.5], 4],
  ['f64.min(-0,0)', [0xa4], ['f64', 'f64'], 'f64', [-0, 0], -0],
  ['f64.copysign', [0xa6], ['f64', 'f64'], 'f64', [3, -1], -3],
  ['f64.neg', [0x9a], ['f64'], 'f64', [5], -5],
  ['f32.add', [0x92], ['f32', 'f32'], 'f32', [0.5, 0.25], 0.75],
  // ---- Conversions & Casts ----
  ['i32.wrap_i64', [0xa7], ['i64'], 'i32', [0x100000005n], 5],
  ['i64.extend_i32_s -1', [0xac], ['i32'], 'i64', [-1], -1n],
  ['i64.extend_i32_u -1', [0xad], ['i32'], 'i64', [-1], 4294967295n],
  ['i32.trunc_f64_s -3.9', [0xaa], ['f64'], 'i32', [-3.9], -3],
  ['i32.trunc_f64_u 3000000000', [0xab], ['f64'], 'i32', [3000000000], -1294967296],
  ['f64.convert_i32_s -1', [0xb7], ['i32'], 'f64', [-1], -1],
  ['f64.convert_i32_u -1', [0xb8], ['i32'], 'f64', [-1], 4294967295],
  ['f32.demote_f64', [0xb6], ['f64'], 'f32', [1.5], 1.5],
  ['f64.promote_f32', [0xbb], ['f32'], 'f64', [1.5], 1.5],
  ['i32.reinterpret_f32 1.0', [0xbc], ['f32'], 'i32', [1.0], 0x3f800000],
  ['f32.reinterpret_i32', [0xbe], ['i32'], 'f32', [0x3f800000], 1.0],
  ['i32.extend8_s 0x80', [0xc0], ['i32'], 'i32', [0x80], -128],
  ['i32.extend16_s 0x8000', [0xc1], ['i32'], 'i32', [0x8000], -32768],
  ['i64.extend32_s', [0xc4], ['i64'], 'i64', [0x80000000n], -2147483648n],
  // ---- saturating truncations (prefix 0xFC) ----
  ['i32.trunc_sat_f64_s NaN', [0xfc, 0x02], ['f64'], 'i32', [NaN], 0],
  ['i32.trunc_sat_f64_s 1e10', [0xfc, 0x02], ['f64'], 'i32', [1e10], MAX32],
  ['i32.trunc_sat_f64_s -1e10', [0xfc, 0x02], ['f64'], 'i32', [-1e10], MIN32],
];

let pass = 0, fail = 0;
for (const [name, op, pt, rt, args, want] of cases) {
  let got;
  try { got = run(pt, rt, op, args); } catch (e) { got = `THROW ${e.message}`; }
  const w = rt === 'f32' ? Math.fround(want) : want;
  if (Object.is(got, w)) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${String(got)} want ${String(w)}`); }
}

// ---- Hardware Traps ----
const traps = [
  ['i32.div_s ÷0', [0x6d], ['i32', 'i32'], 'i32', [1, 0], /divide by zero/],
  ['i32.div_s INT_MIN/-1', [0x6d], ['i32', 'i32'], 'i32', [MIN32, -1], /overflow|unrepresentable/i],
  ['i32.rem_s ÷0', [0x6f], ['i32', 'i32'], 'i32', [1, 0], /remainder by zero/],
  ['i32.trunc_f64_s NaN', [0xaa], ['f64'], 'i32', [NaN], /unrepresentable/],
  ['i32.trunc_f64_s 1e10', [0xaa], ['f64'], 'i32', [1e10], /unrepresentable/],
  ['unreachable', [0x00], [], null, [], /unreachable/],
];
for (const [name, op, pt, rt, args, re] of traps) {
  try { run(pt, rt, op, args); fail++; console.log(`FAIL trap ${name}: Did not trap`); }
  catch (e) {
    if (e instanceof WebAssembly.RuntimeError && re.test(e.message)) pass++;
    else { fail++; console.log(`FAIL trap ${name}: ${e.name}: ${e.message}`); }
  }
}

console.log(`\nopcode checks: ${pass} passed, ${fail} failed (total: ${pass + fail})`);
process.exit(fail ? 1 : 0);
