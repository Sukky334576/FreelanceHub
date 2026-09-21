-- ==============================================================================
-- NATTHAWIT STUDIO: OPTIONAL DATABASE MIGRATION SCRIPT
-- ==============================================================================
-- สคริปต์นี้เป็นทางเลือก (Optional) สำหรับรันใน Supabase SQL Editor
-- เพื่อเพิ่มคอลัมน์ `scope` (สตูดิโอ/ส่วนตัว) และ `account` (ชื่อบัญชี) ลงในตาราง `transactions`
-- 
-- คุณสมบัติความปลอดภัย:
-- 1. ใช้ IF NOT EXISTS จะไม่เกิด Error หากมีคอลัมน์อยู่แล้ว
-- 2. ข้อมูลเดิม 558 รายการจะได้รับค่า DEFAULT 'สตูดิโอ' และ 'บัญชีสตูดิโอ' โดยอัตโนมัติ
-- 3. ข้อมูลเดิมทั้งหมด (ID, ยอดเงิน, วันที่) ปลอดภัย 100% ไม่มีการสูญหายหรือเปลี่ยนแปลง
-- ==============================================================================

-- 1. เพิ่มคอลัมน์ scope (สตูดิโอ / ส่วนตัว)
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS scope text DEFAULT 'สตูดิโอ';

-- 2. เพิ่มคอลัมน์ account (ชื่อบัญชี เช่น บัญชีสตูดิโอ, บัญชีส่วนตัว, เงินสด)
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS account text DEFAULT 'บัญชีสตูดิโอ';

-- 3. อัปเดตข้อมูลเดิมในอดีต (ถ้าต้องการกำหนดค่าเริ่มต้น)
UPDATE public.transactions 
SET scope = 'สตูดิโอ' 
WHERE scope IS NULL;

UPDATE public.transactions 
SET account = 'บัญชีสตูดิโอ' 
WHERE account IS NULL;

-- 4. ตรวจสอบผลลัพธ์
SELECT count(*) AS total_transactions, scope, account 
FROM public.transactions 
GROUP BY scope, account;
