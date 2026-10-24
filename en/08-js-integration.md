# Chapter 08: JavaScript and Browser API Integration (JS & Web API Integration)

> **Author:** Wirot Chookeaw ([chin6700x](https://github.com/chin6700x)) • **Documentation:** [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) • **Code:** [Apache-2.0 / MIT](../LICENSE)  
> **References:** [MDN WebAssembly JavaScript Interface](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface) • [W3C WebAssembly JS API Spec](https://webassembly.github.io/spec/js-api/)

[⬅ Chapter 07](07-tables-indirect-call.md) | [Table of Contents](README.md) | [Chapter 09 ➡](09-clang-bare-metal.md)

> [!NOTE]
> All bridge architectures, streaming compilation simulations, host callback bindings, and zero-dependency sovereign `ccall`/`cwrap` implementations in this chapter have been empirically validated on the V8 Engine in [examples/js-bridge-test.js](examples/js-bridge-test.js).

---

## 8.1 The WebAssembly JavaScript Interface Architecture

Modern web browsers expose a standardized global namespace **`WebAssembly`**, enabling JavaScript runtimes to fetch, compile, instantiate, and exchange memory and calls with WebAssembly modules:

```
+-----------------------------------------------------------------------------------+
|                        WebAssembly JavaScript API Lifecycle                       |
|                                                                                   |
|  [ Fetch Network Stream ]                                                         |
|             │                                                                     |
|             ▼                                                                     |
|  WebAssembly.instantiateStreaming(response, importObject)                         |
|             │                                                                     |
|      ┌──────┴─────────────────────────────────┐                                   |
|      ▼                                        ▼                                   |
|  [ WebAssembly.Module ]               [ WebAssembly.Instance ]                    |
|  (Stateless Compiled Machine Code)    (Stateful Execution: Memory, Table, Globals)|
+-----------------------------------------------------------------------------------+
```

### 1. Three Primary Instantiation Paradigms

#### A) `WebAssembly.instantiateStreaming()` (Gold Standard for Production Browsers)
The most performant mechanism available. The browser runtime **JIT-compiles bytecode incrementally while raw network chunks are streaming over HTTP**, without buffering the entire payload into an intermediary `ArrayBuffer`:
```javascript
const importObject = { env: { log: (x) => console.log(x) } };

// Compilation begins the exact millisecond the first TCP network packet arrives
const { module, instance } = await WebAssembly.instantiateStreaming(
  fetch("app.wasm"), 
  importObject
);
```

#### B) `WebAssembly.instantiate(bufferSource, importObject)`
Used when the module payload already resides in memory as an `ArrayBuffer` or `Uint8Array` (e.g., in Node.js server scripts, indexedDB offline caches, or local file systems):
```javascript
const wasmBuffer = await fs.promises.readFile("app.wasm");
const { module, instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
```

#### C) Decoupled Workflow: `WebAssembly.compile()` and `new WebAssembly.Instance()`
Ideal for multi-threaded architectures requiring **sharing compiled bytecode across Web Workers**:
```javascript
// Compile once into a stateless, thread-safe WebAssembly.Module
const module = await WebAssembly.compile(wasmBuffer);

// Broadcast the module to worker threads via postMessage()
// Each worker instantiates its own isolated execution instance with dedicated state:
const instance1 = new WebAssembly.Instance(module, importObject1);
const instance2 = new WebAssembly.Instance(module, importObject2);
```

---

## 8.2 Data Exchange: JavaScript $\leftrightarrow$ WebAssembly

Because WebAssembly's core instruction set operates strictly on low-level numeric primitives (`i32`, `i64`, `f32`, `f64`), passing complex structures (such as UTF-8 strings, byte buffers, JSON, or C-structs) requires an explicit **Linear Memory Bridge**:

### 1. Scalar Value Marshaling
- `i32`, `f32`, `f64` $\rightarrow$ Pass and return directly as standard JavaScript `Number` types.
- `i64` $\rightarrow$ Pass and return as JavaScript **`BigInt`** types (denoted by an `n` suffix, e.g., `42n`).

---

### 2. Passing UTF-8 Strings from JS to Wasm (Zero-Copy Transfer)

```
[ JavaScript ]                                         [ WebAssembly Linear Memory ]
const text = "Wirot";                                   
const bytes = TextEncoder.encode(text);                  
const ptr = instance.exports.alloc(bytes.length + 1); ──► [ Heap Allocator returns ptr = 1040 ]
Uint8Array(memory.buffer).set(bytes, ptr);            ──► [ 1040: 'W' 'i' 'r' 'o' 't' '\0' ]
instance.exports.process_str(ptr);                    ──► Read and compute via i32.load
```

#### Concrete Implementation:
```javascript
const encoder = new TextEncoder();
const text = "WebAssembly 2026";
const encodedBytes = encoder.encode(text);

// 1. Request heap allocation inside Wasm via an exported allocator function
const ptr = instance.exports.alloc(encodedBytes.length + 1);

// 2. Blast bytes directly into Linear Memory via TypedArray view
const memoryView = new Uint8Array(instance.exports.memory.buffer);
memoryView.set(encodedBytes, ptr);
memoryView[ptr + encodedBytes.length] = 0; // Append null terminator \0

// 3. Pass raw pointer and length into Wasm entrypoint
instance.exports.process_string(ptr, encodedBytes.length);
```

---

### 3. Reading Strings from WebAssembly to JavaScript (`TextDecoder`)

When a WebAssembly function returns a pointer `ptr` to a null-terminated C string in memory:
```javascript
function readStringFromWasm(instance, ptr) {
  const memoryView = new Uint8Array(instance.exports.memory.buffer);
  
  // Locate null terminator
  let end = ptr;
  while (memoryView[end] !== 0) {
    end++;
  }

  // Create zero-copy TypedArray subarray view and decode UTF-8
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(memoryView.subarray(ptr, end));
}
```

---

## 8.3 Building a Sovereign Universal Bridge (`ccall` & `cwrap` Without Emscripten)

Emscripten provides convenient helper functions like `ccall()` and `cwrap()`, but carries hundreds of kilobytes of runtime glue code.  
We can implement a **Sovereign JS Bridge in under 60 lines of clean code** featuring automatic type conversion:

```javascript
class SovereignWasmBridge {
  constructor(instance) {
    this.instance = instance;
    this.exports = instance.exports;
    this.memory = instance.exports.memory;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8");
  }

  // Allocate memory and write string into Wasm heap
  allocString(str) {
    const bytes = this.encoder.encode(str);
    const ptr = this.exports.alloc(bytes.length + 1);
    const mem = new Uint8Array(this.memory.buffer);
    mem.set(bytes, ptr);
    mem[ptr + bytes.length] = 0; // Null terminator
    return { ptr, len: bytes.length };
  }

  // Read null-terminated string out of Wasm Linear Memory
  readString(ptr) {
    const mem = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return this.decoder.decode(mem.subarray(ptr, end));
  }

  // Invoke Wasm function with automatic marshaling
  ccall(ident, returnType, argTypes = [], args = []) {
    const fn = this.exports[ident];
    if (typeof fn !== "function") {
      throw new Error(`Export '${ident}' not found in Wasm instance`);
    }

    const wasmArgs = [];
    for (let i = 0; i < args.length; i++) {
      const type = argTypes[i];
      const val = args[i];

      if (type === "string") {
        const { ptr } = this.allocString(val);
        wasmArgs.push(ptr);
      } else if (type === "number") {
        wasmArgs.push(Number(val));
      } else if (type === "boolean") {
        wasmArgs.push(val ? 1 : 0);
      } else {
        wasmArgs.push(val);
      }
    }

    const rawResult = fn(...wasmArgs);

    if (returnType === "string") return this.readString(rawResult);
    if (returnType === "boolean") return Boolean(rawResult);
    if (returnType === "number") return Number(rawResult);
    return rawResult;
  }

  // Wrap Wasm function as a transparent native JavaScript function
  cwrap(ident, returnType, argTypes = []) {
    return (...args) => this.ccall(ident, returnType, argTypes, args);
  }
}
```

### Usage Demonstration:
```javascript
const bridge = new SovereignWasmBridge(instance);

// Wrap native C/Wasm functions in one declarative statement
const greetUser = bridge.cwrap("greet_user", "string", ["string"]);
const addNumbers = bridge.cwrap("add_numbers", "number", ["number", "number"]);

console.log(greetUser("Wirot Chookeaw")); // Outputs: "Hello, Wirot Chookeaw!"
console.log(addNumbers(15, 27));           // Outputs: 42
```

---

## 8.4 Importing Host Browser APIs into WebAssembly (Import Object)

In the binary structure, **Section 2 (Import Section)** enables modules to declare external functions provided by the host runtime:

```wat
(module
  ;; Import host functions from JavaScript
  (import "env" "host_log" (func $host_log (param i32 i32)))
  (import "env" "get_time" (func $get_time (result f64)))
  (import "env" "on_event" (func $on_event (param i32 i32)))
  
  (memory (export "memory") 1)
  
  (func (export "trigger")
    ;; Invoke high-resolution host timer
    call $get_time
    drop
    
    ;; Emit event notification back to host
    i32.const 42
    i32.const 100
    call $on_event
  )
)
```

### Host Instantiation Binding:
```javascript
const importObject = {
  env: {
    host_log: (ptr, len) => {
      const mem = new Uint8Array(instance.exports.memory.buffer);
      const msg = new TextDecoder().decode(mem.subarray(ptr, ptr + len));
      console.log("[Wasm Log]:", msg);
    },
    get_time: () => performance.now(),
    on_event: (eventId, data) => {
      console.log(`Event ${eventId} triggered with data ${data}`);
    }
  }
};

const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
instance.exports.trigger();
```

---

## 8.5 Empirical Benchmarks: Raw Call vs. Sovereign Bridge Overhead

Empirical benchmark execution conducted in [examples/js-bridge-test.js](examples/js-bridge-test.js) over 1,000,000 invocations on V8 (Node.js v24 on Apple Silicon):

| Call Invocation Pattern | Time (1M Calls) | Throughput Rate | Engineering Profile |
| :--- | :---: | :---: | :--- |
| **Raw Wasm Export Call** | **11.91 ms** | **~84 Million calls/sec** | Maximum speed; ideal for hot graphics/physics calculation loops |
| **Sovereign Bridge (`cwrap`)** | **26.68 ms** | **~37 Million calls/sec** | Maximum ergonomic abstraction with automatic string/type marshaling; tiny ~14 ns per-call overhead |

Inspect the runnable benchmark and integration test suite in [examples/js-bridge-test.js](examples/js-bridge-test.js).

---

[⬅ Chapter 07: Function Pointers and Tables](07-tables-indirect-call.md) | [Main Table of Contents](README.md) | [Chapter 09: Compiling C to Bare-Metal Wasm with Clang ➡](09-clang-bare-metal.md)
