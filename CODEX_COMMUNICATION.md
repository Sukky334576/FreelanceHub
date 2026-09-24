# 🤝 Codex & Antigravity Autonomous Communication Channel

> 🚨 **[PRIORITY 0: ต้องทำและตกลงในขั้นตอนนี้ก่อนเป็นอันดับแรก / MUST AGREE ON THIS STEP FIRST]**  
> เพื่อความสะดวก รวดเร็ว และไม่ต้องให้คุณผู้ใช้ต้องคอยคัดลอกข้อความยาวๆ สลับหน้าจอไปมา  
> เราจะใช้ไฟล์นี้และ GitHub Repository (`Sukky334576/FreelanceHub`) เป็น **ตู้สื่อสารและส่งต่องานอัตโนมัติ (Autonomous Git Relay Channel)** ระหว่าง **Codex** และ **Antigravity**

---

## 📌 1. กฎกติกาและกระบวนการทำงานร่วมกัน (Communication Protocol)

```mermaid
sequenceDiagram
    autonumber
    participant Codex as 🧠 Codex (Architecture & Code Reviewer)
    participant Git as 📦 GitHub Repository (main)
    participant Antigravity as 🛠️ Antigravity (Execution, Testing & Deployment)

    Note over Codex,Antigravity: [Step 0: ตกลงใช้ Git Relay ในการทำงาน]
    Codex->>Git: 1. เขียนคำแนะนำ/ตอบกลับลงในส่วน "Codex Inbox" แล้ว git push
    Git-->>Antigravity: 2. Antigravity ตรวจพบ Commit ใหม่ (Auto Git Pull)
    Antigravity->>Antigravity: 3. ปฏิบัติงานจริง: เขียนโค้ด, รัน Tests (32 รายการ), Deploy
    Antigravity->>Git: 4. เขียนบันทึกใน "Antigravity Log" แล้ว git push กลับ
    Git-->>Codex: 5. Codex pull โค้ดล่าสุดไปตรวจทานต่อได้ทันที
```

### หน้าที่ของแต่ละฝั่ง:
1. **Codex (ที่ปรึกษาและผู้วางสถาปัตยกรรม):**
   - ดึงโค้ดล่าสุด: `git pull origin main`
   - อ่านสถานะและสิ่งที่ Antigravity ทำไปแล้วในเอกสารนี้และ `ROADMAP.md`
   - พิมพ์คำตอบ ข้อเสนอแนะ หรือโค้ดที่ต้องการให้ลงมือทำลงใน **[Section 3: Codex Response Area]** ด้านล่าง
   - บันทึกและส่งงาน: `git commit -am "codex: review & guidance" && git push origin main`

2. **Antigravity (ผู้ลงมือปฏิบัติและ Deploy):**
   - ตรวจสอบการ Push ของ Codex อัตโนมัติ และดึงโค้ดมาวิเคราะห์
   - ลงมือเขียนโค้ดตามคำแนะนำ ตรวจสอบความถูกต้องทางการเงิน (รัน `npm test` ทั้งหมด 32/32 tests)
   - Deploy ขึ้นระบบจริงบน Cloudflare Pages (`https://natthawit-studio.pages.dev/`)
   - บันทึกผลลัพธ์ใน **[Section 2: Antigravity Execution Log]** แล้ว Push กลับขึ้น GitHub ทันที

---

## 🛠️ 2. Antigravity Execution Log (บันทึกสถานะล่าสุดจาก Antigravity)

**วันที่:** 24 กันยายน 2569 (September 2026)  
**สถานะปัจจุบัน:**
- ✅ **Financial Accuracy & Atomic RPCs:** ผ่านการทดสอบระดับลึกครบถ้วน 32/32 tests (MR01–MR10, FR01–FR06, RR01–RR06, H02)
- ✅ **Database & User Data:** ฐานข้อมูล Supabase Production บังคับใช้ `FORCE ROW LEVEL SECURITY` ทุกตาราง ข้อมูลคุณณัฐวิทย์ปลอดภัย 100% (638 transactions, 3 wallets รวม ฿67,056.22)
- ✅ **Rebrand UI to FreelanceHub:** เปลี่ยนแบรนด์เป็น "FreelanceHub" ครบทุกจุด (Login Gate, Desktop Sidebar, Mobile Header, PDF Invoices, Excel Export, PWA Manifest)
- ✅ **Deployment:** Live บน Cloudflare Pages (`https://natthawit-studio.pages.dev/`)
- ✅ **Master Blueprint:** จัดทำแผนงานและบันทึกลงใน [`ROADMAP.md`](./ROADMAP.md) เรียบร้อยแล้ว

---

## 💬 3. Codex Response Area (พื้นที่สำหรับ Codex พิมพ์ตอบกลับ)

> 💡 **สำหรับ Codex:** เมื่อดึงไฟล์นี้มาแล้ว โปรดช่วยตอบและให้ข้อเสนอแนะใน 3 หัวข้อนี้ด้านล่างนี้ได้เลยครับ:

### หัวข้อที่ 1: ระบบ Onboarding ผู้ใช้ใหม่ (New User Provisioning)
* **คำถาม:** เมื่อผู้ใช้ใหม่สมัครสมาชิกผ่าน Supabase Auth จะยังไม่มีกระเป๋าเงิน (Wallets) หรือหมวดหมู่ตั้งต้น Codex แนะนำให้สร้างข้อมูลเริ่มต้นแบบไหนดีที่สุด?
  - **แนวทาง A:** ใช้ PostgreSQL Database Trigger บนตาราง `auth.users` เพื่อ `INSERT INTO wallets` และ `categories` อัตโนมัติทันทีที่สมัคร
  - **แนวทาง B:** ให้ Frontend ตรวจสอบ ถ้า `wallets.length === 0` ให้เด้ง Onboarding Wizard 3 ขั้นตอนให้ผู้ใช้เลือกตั้งชื่อบัญชีและยอดเงินเริ่มต้นเอง
  - *ความคิดเห็นและข้อเสนอแนะจาก Codex:*  
    <!-- Codex กรอกคำตอบตรงนี้ -->

---

### หัวข้อที่ 2: ระบบยืนยันตัวตนและโครงสร้างพื้นฐานเพิ่มเติม (Auth & Infra)
* **คำถาม:** สำหรับการเปิดให้ฟรีแลนซ์ทั่วไปใช้งาน Codex แนะนำ Tech Stack ด้าน Email และ Error Tracking ตัวใดที่คุ้มค่า เสถียร และผูกกับ Supabase ได้ง่ายที่สุด?
  - อีเมลยืนยันตัวตนและรีเซ็ตรหัสผ่าน (Resend / Brevo / อื่นๆ)
  - ตัวดักจับข้อผิดพลาด (Sentry Browser SDK)
  - *ความคิดเห็นและข้อเสนอแนะจาก Codex:*  
    <!-- Codex กรอกคำตอบตรงนี้ -->

---

### หัวข้อที่ 3: ระบบการชำระเงินสำหรับฟรีแลนซ์ไทย (Payment Integration)
* **คำถาม:** หากต้องการเปิดรับสมัครสมาชิกรายเดือน (Pro Subscription ฿99 - ฿149/เดือน) สำหรับผู้ใช้ในไทย Codex แนะนำสถาปัตยกรรมแบบใด?
  - **แนวทาง A:** Stripe Billing (รองรับตัดบัตรเครดิต/เดบิตอัตโนมัติรายเดือน แต่คนไทยบางส่วนไม่มีบัตร)
  - **แนวทาง B:** Thai QR PromptPay Payment Gateway (เช่น GB Prime Pay / Opn / Chillpay) แล้วใช้ Webhook อัปเดตวันหมดอายุของสมาชิกในตาราง `subscriptions`
  - *ความคิดเห็นและข้อเสนอแนะจาก Codex:*  
    <!-- Codex กรอกคำตอบตรงนี้ -->

---

### ข้อเสนอแนะอื่นๆ จาก Codex:
<!-- Codex สามารถเพิ่มเติมข้อเสนอแนะ หรือสิ่งที่ Antigravity ควรเริ่มทำก่อนได้ตรงนี้ -->

---
*(เมื่อพิมพ์เสร็จแล้ว ให้ Codex ทำการ `git commit -am "codex: recommendations" && git push origin main` ได้เลยครับ)*
