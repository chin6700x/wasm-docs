;; sieve.wat — Sieve of Eratosthenes เขียนด้วย WebAssembly Text Format ล้วน
;; Author: Wirot Chookeaw (chin6700x) • License: Apache-2.0 / MIT © 2026
;;
;; หน่วยความจำ: 1 byte ต่อ 1 ตัวเลข (1 = อาจเป็นจำนวนเฉพาะ, 0 = ไม่ใช่)
;; 1 หน้า = 65,536 ไบต์ ดังนั้นรองรับ n สูงสุด 65,535
;;
;; คอมไพล์: wat2wasm sieve.wat -o sieve.wasm

(module
  (memory (export "memory") 1)

  ;; sieve(n) -> จำนวนจำนวนเฉพาะที่ <= n (คืน -1 ถ้า n เกินความจุหน่วยความจำ)
  (func $sieve (export "sieve") (param $n i32) (result i32)
    (local $i i32)
    (local $j i32)
    (local $count i32)

    ;; ป้องกัน out-of-bounds: n ต้อง < 65536
    (if (i32.ge_u (local.get $n) (i32.const 65536))
      (then (return (i32.const -1))))

    ;; ตั้งต้นทุกช่อง [0..n] เป็น 1 ด้วย bulk-memory (memory.fill)
    (memory.fill
      (i32.const 0)
      (i32.const 1)
      (i32.add (local.get $n) (i32.const 1)))

    ;; 0 และ 1 ไม่ใช่จำนวนเฉพาะ
    (i32.store8 (i32.const 0) (i32.const 0))
    (if (i32.ge_u (local.get $n) (i32.const 1))
      (then (i32.store8 (i32.const 1) (i32.const 0))))

    ;; วงนอก: i = 2; i*i <= n; i++
    (local.set $i (i32.const 2))
    (block $outer_done
      (loop $outer
        (br_if $outer_done
          (i32.gt_u (i32.mul (local.get $i) (local.get $i)) (local.get $n)))

        (if (i32.load8_u (local.get $i))
          (then
            ;; วงใน: j = i*i; j <= n; j += i  -> ขีดฆ่าตัวคูณ
            (local.set $j (i32.mul (local.get $i) (local.get $i)))
            (block $inner_done
              (loop $inner
                (br_if $inner_done (i32.gt_u (local.get $j) (local.get $n)))
                (i32.store8 (local.get $j) (i32.const 0))
                (local.set $j (i32.add (local.get $j) (local.get $i)))
                (br $inner)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))

    ;; นับจำนวนเฉพาะ
    (local.set $i (i32.const 2))
    (block $count_done
      (loop $count_loop
        (br_if $count_done (i32.gt_u (local.get $i) (local.get $n)))
        (local.set $count
          (i32.add (local.get $count) (i32.load8_u (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $count_loop)))

    (local.get $count))

  ;; is_prime(i) -> 1/0 (ใช้ได้หลังเรียก sieve(n) โดย i <= n)
  (func (export "is_prime") (param $i i32) (result i32)
    (i32.load8_u (local.get $i)))
)
