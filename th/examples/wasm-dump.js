#!/usr/bin/env node
/*
 * wasm-dump.js — อ่านโครงสร้าง Section ของไฟล์ .wasm ด้วยมือ (ไม่พึ่งไลบรารี)
 * Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
 * ใช้: node wasm-dump.js file.wasm
 */
const fs = require('fs');

const SECTION_NAMES = {
  0: 'Custom', 1: 'Type', 2: 'Import', 3: 'Function', 4: 'Table', 5: 'Memory',
  6: 'Global', 7: 'Export', 8: 'Start', 9: 'Element', 10: 'Code', 11: 'Data',
  12: 'DataCount', 13: 'Tag'
};
const VALTYPE = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128', 0x70: 'funcref', 0x6f: 'externref' };
const KIND = ['func', 'table', 'memory', 'global', 'tag'];

function readU32(b, st) {               // Unsigned LEB128 (สูงสุด 5 ไบต์สำหรับ u32)
  let result = 0, shift = 0, byte;
  do {
    byte = b[st.pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return result >>> 0;
}
function readName(b, st) {
  const len = readU32(b, st);
  const s = Buffer.from(b.subarray(st.pos, st.pos + len)).toString('utf8');
  st.pos += len;
  return s;
}
function readLimits(b, st) {
  const flag = b[st.pos++];
  const min = readU32(b, st);
  const max = (flag & 1) ? readU32(b, st) : null;
  return { min, max };
}

function dump(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 8 || b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d)
    throw new Error('ไม่ใช่ไฟล์ WebAssembly (magic ผิด)');
  const version = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  console.log(`magic  : 00 61 73 6d ("\\0asm")`);
  console.log(`version: ${version}`);
  console.log(`size   : ${b.length} bytes\n`);

  const st = { pos: 8 };
  while (st.pos < b.length) {
    const start = st.pos;
    const id = b[st.pos++];
    const size = readU32(b, st);
    const payload = st.pos;
    const end = payload + size;
    const name = SECTION_NAMES[id] || `Unknown(${id})`;
    let detail = '';
    const p = { pos: payload };

    switch (id) {
      case 0: detail = `name="${readName(b, p)}"`; break;
      case 1: {
        const n = readU32(b, p); const sigs = [];
        for (let i = 0; i < n; i++) {
          p.pos++; // 0x60
          const pc = readU32(b, p); const ps = [];
          for (let j = 0; j < pc; j++) ps.push(VALTYPE[b[p.pos++]]);
          const rc = readU32(b, p); const rs = [];
          for (let j = 0; j < rc; j++) rs.push(VALTYPE[b[p.pos++]]);
          sigs.push(`(${ps.join(',')})->(${rs.join(',')})`);
        }
        detail = `${n} types: ${sigs.slice(0, 3).join(' ')}${n > 3 ? ' ...' : ''}`; break;
      }
      case 2: {
        const n = readU32(b, p); const items = [];
        for (let i = 0; i < n; i++) {
          const mod = readName(b, p), nm = readName(b, p), kind = b[p.pos++];
          items.push(`${mod}.${nm}:${KIND[kind]}`);
          if (kind === 0) readU32(b, p);
          else if (kind === 1) { p.pos++; readLimits(b, p); }
          else if (kind === 2) readLimits(b, p);
          else if (kind === 3) p.pos += 2;
        }
        detail = `${n} imports: ${items.slice(0, 4).join(', ')}${n > 4 ? ' ...' : ''}`; break;
      }
      case 3: detail = `${readU32(b, p)} functions`; break;
      case 4: detail = `${readU32(b, p)} tables`; break;
      case 5: {
        const n = readU32(b, p); const l = readLimits(b, p);
        detail = `${n} memory: min=${l.min} page(s) (${l.min * 64} KiB)` + (l.max !== null ? `, max=${l.max}` : ''); break;
      }
      case 6: detail = `${readU32(b, p)} globals`; break;
      case 7: {
        const n = readU32(b, p); const ex = [];
        for (let i = 0; i < n; i++) {
          const nm = readName(b, p), kind = b[p.pos++], idx = readU32(b, p);
          ex.push(`${nm}(${KIND[kind]}#${idx})`);
        }
        detail = `${n} exports: ${ex.slice(0, 6).join(', ')}${n > 6 ? ' ...' : ''}`; break;
      }
      case 8: detail = `start=func#${readU32(b, p)}`; break;
      case 9: detail = `${readU32(b, p)} element segments`; break;
      case 10: detail = `${readU32(b, p)} function bodies`; break;
      case 11: detail = `${readU32(b, p)} data segments`; break;
      case 12: detail = `dataCount=${readU32(b, p)}`; break;
    }
    console.log(`@0x${start.toString(16).padStart(4, '0')}  id=${String(id).padStart(2)} ${name.padEnd(9)} size=${String(size).padStart(6)}  ${detail}`);
    st.pos = end;
  }
}

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('usage: node wasm-dump.js file.wasm'); process.exit(1); }
  dump(fs.readFileSync(f));
}
module.exports = { dump };
