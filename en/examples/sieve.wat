;; sieve.wat — Sieve of Eratosthenes implemented in pure WebAssembly Text Format (WAT)
;; Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
;;
;; Memory Layout: 1 byte per integer (1 = prime candidate, 0 = composite)
;; 1 page = 65,536 bytes; safely accommodates n up to 65,535
;;
;; Assemble: wat2wasm sieve.wat -o sieve.wasm

(module
  (memory (export "memory") 1)

  ;; sieve(n) -> returns prime count <= n (returns -1 if n exceeds memory capacity)
  (func $sieve (export "sieve") (param $n i32) (result i32)
    (local $i i32)
    (local $j i32)
    (local $count i32)

    ;; Bounds guard: n must be < 65536
    (if (i32.ge_u (local.get $n) (i32.const 65536))
      (then (return (i32.const -1))))

    ;; Initialize all slots [0..n] to 1 using bulk-memory (memory.fill)
    (memory.fill
      (i32.const 0)
      (i32.const 1)
      (i32.add (local.get $n) (i32.const 1)))

    ;; 0 and 1 are non-prime by definition
    (i32.store8 (i32.const 0) (i32.const 0))
    (if (i32.ge_u (local.get $n) (i32.const 1))
      (then (i32.store8 (i32.const 1) (i32.const 0))))

    ;; Outer loop: i = 2; i*i <= n; i++
    (local.set $i (i32.const 2))
    (block $outer_done
      (loop $outer
        (br_if $outer_done
          (i32.gt_u (i32.mul (local.get $i) (local.get $i)) (local.get $n)))

        (if (i32.load8_u (local.get $i))
          (then
            ;; Inner loop: j = i*i; j <= n; j += i  -> mark multiples composite
            (local.set $j (i32.mul (local.get $i) (local.get $i)))
            (block $inner_done
              (loop $inner
                (br_if $inner_done (i32.gt_u (local.get $j) (local.get $n)))
                (i32.store8 (local.get $j) (i32.const 0))
                (local.set $j (i32.add (local.get $j) (local.get $i)))
                (br $inner)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))

    ;; Count total primes
    (local.set $i (i32.const 2))
    (block $count_done
      (loop $count_loop
        (br_if $count_done (i32.gt_u (local.get $i) (local.get $n)))
        (local.set $count
          (i32.add (local.get $count) (i32.load8_u (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $count_loop)))

    (local.get $count))

  ;; is_prime(i) -> 1/0 (valid after executing sieve(n) where i <= n)
  (func (export "is_prime") (param $i i32) (result i32)
    (i32.load8_u (local.get $i)))
)
