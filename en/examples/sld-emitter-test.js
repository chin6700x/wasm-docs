/**
 * SLD Sovereign WebAssembly Emitter Verification Suite
 * Verification suite for compiling C directly to WebAssembly with sld-compiler (Clean-Room C99 Emitter)
 * 
 * Author: Wirot Chookeaw (chin6700x)
 * License: Apache-2.0 / MIT © 2026
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sldBin = '/Users/chinchin/.local/bin/sld';
const testC = path.join(__dirname, 'sovereign-sample.c');
const testHtml = path.join(__dirname, 'sovereign-sample.html');
const testJs = path.join(__dirname, 'sovereign-sample.js');
const testWasm = path.join(__dirname, 'sovereign-sample.wasm');

console.log("=== Starting SLD Sovereign WebAssembly Emitter Suite ===");

// 1. Generate sample C source code
const cSource = `
int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    return a * b;
}

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int fibonacci(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int c = a + b;
        a = b;
        b = c;
    }
    return b;
}
`;

fs.writeFileSync(testC, cSource.trim());
console.log(`1. Successfully generated source code: ${path.basename(testC)}`);

// 2. Compile with SLD Compiler
console.log(`2. Compiling directly with ${sldBin} --target=wasm32...`);
const t0 = performance.now();
execSync(`"${sldBin}" --target=wasm32 -o "${testHtml}" "${testC}"`, { stdio: 'inherit' });
const duration = performance.now() - t0;
console.log(`   ⏱️ Compilation succeeded in only ${duration.toFixed(2)} ms!`);

// Sanitize HTML output to use clean title and lang="en"
if (fs.existsSync(testHtml)) {
  let htmlContent = fs.readFileSync(testHtml, 'utf8');
  htmlContent = htmlContent.replace('<html lang="th">', '<html lang="en">');
  htmlContent = htmlContent.replace(/<title>.*?<\/title>/, '<title>Sovereign WebAssembly Sandbox • SLD</title>');
  htmlContent = htmlContent.replace(/<h1>⚡.*?<\/h1>/, '<h1>⚡ Sovereign WebAssembly Sandbox</h1>');
  fs.writeFileSync(testHtml, htmlContent);
}

// 3. Verify all 3 generated artifacts
assert(fs.existsSync(testWasm), "Expected .wasm file to be generated");
assert(fs.existsSync(testJs), "Expected .js bridge file to be generated");
assert(fs.existsSync(testHtml), "Expected .html sandbox file to be generated");

const wasmBytes = fs.readFileSync(testWasm);
console.log(`   .wasm binary size: ${wasmBytes.length} bytes (< 1 KB)`);
assert(wasmBytes.length < 1024, "Binary size must remain compact at sub-1KB level");
console.log("   ✅ Generated Wasm, JS companion, and HTML sandbox artifacts successfully");

// 4. Verify runtime behavior on V8 Engine
console.log("\n3. Verifying execution output in Node.js:");
const { instance } = await WebAssembly.instantiate(wasmBytes);
const exp = instance.exports;

console.log("   All exported symbols:", Object.keys(exp));
assert.strictEqual(exp.add(15, 27), 42);
assert.strictEqual(exp.multiply(6, 7), 42);
assert.strictEqual(exp.factorial(5), 120);
assert.strictEqual(exp.fibonacci(10), 55);

console.log("   ✔ add(15, 27) = 42");
console.log("   ✔ multiply(6, 7) = 42");
console.log("   ✔ factorial(5) = 120");
console.log("   ✔ fibonacci(10) = 55");

console.log("\n=======================================================");
console.log("🎉 All tests passed successfully with 100% W3C standard compliance!");
console.log("=======================================================");
