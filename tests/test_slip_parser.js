/**
 * Unit Test Suite for FreelanceHub Slip Parser (js/slip-parser.js)
 * Tests parsing heuristics across K PLUS, MAKE by KBank, SCB EASY,
 * Krungthai NEXT, TrueMoney Wallet, ShopeePay, and boundary cases.
 */

const assert = require('assert');
const SlipParser = require('../js/slip-parser.js');

console.log('🧪 Starting Slip Parser Unit Test Suite (6 Banks & Edge Cases)...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

// 1. K PLUS (Kasikornbank)
runTest('K PLUS: Parses amount, 2-digit BE date, time, receiver, and ref', () => {
  const ocrText = `
    K PLUS
    โอนเงินสำเร็จ
    24 ก.ย. 67 14:32 น.
    จาก: นาย ณัฐวิทย์
    ไปยัง: ร้าน ซุปเปอร์มาร์เก็ต
    จำนวนเงิน: 1,250.00 บาท
    ค่าธรรมเนียม: 0.00 บาท
    เลขที่รายการ: 202409241432890123
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'kbank');
  assert.strictEqual(result.amount, 1250.00);
  assert.strictEqual(result.date, '2024-09-24');
  assert.strictEqual(result.time, '14:32');
  assert.strictEqual(result.refNumber, '202409241432890123');
  assert.strictEqual(result.needsReview, false);
  assert.strictEqual(result.status, 'ready');
});

// 2. MAKE by KBank
runTest('MAKE by KBank: Parses 4-digit BE date and category suggestion', () => {
  const ocrText = `
    MAKE by KBank
    โอนเงินสำเร็จ
    12 ต.ค. 2567 09:15 น.
    จาก Cloud Pocket: ค่าใช้จ่ายส่วนตัว
    ไปยัง: บจก. ปตท. น้ำมัน
    จำนวนเงิน: 950.00 บาท
    รหัสอ้างอิง: MK20241012987654
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'make');
  assert.strictEqual(result.amount, 950.00);
  assert.strictEqual(result.date, '2024-10-12');
  assert.strictEqual(result.time, '09:15');
  assert.strictEqual(result.refNumber, 'MK20241012987654');
  assert.strictEqual(result.suggestedCategory, 'ค่าเดินทาง/ที่พัก');
  assert.strictEqual(result.needsReview, false);
});

// 3. SCB EASY (Siam Commercial Bank)
runTest('SCB EASY: Differentiates transfer amount from remaining balance', () => {
  const ocrText = `
    SCB EASY
    โอนเงินสำเร็จ
    15 ต.ค. 67 - 18:45
    จาก: บัญชี ออมทรัพย์ xxx-1234
    ไปยัง: นาย สมชาย รักดี
    จำนวนเงิน: 3,500.00 บาท
    ค่าธรรมเนียม: 0.00 บาท
    เลขที่อ้างอิง: 2024101588776655
    ยอดเงินคงเหลือ: 54,200.00 บาท
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'scb');
  assert.strictEqual(result.amount, 3500.00, 'Must pick transfer amount 3500, NOT remaining balance 54200');
  assert.strictEqual(result.date, '2024-10-15');
  assert.strictEqual(result.time, '18:45');
  assert.strictEqual(result.refNumber, '2024101588776655');
  assert.strictEqual(result.needsReview, false);
});

// 4. Krungthai NEXT
runTest('Krungthai NEXT: Parses KTB slip with seconds in timestamp', () => {
  const ocrText = `
    Krungthai NEXT
    โอนสำเร็จ
    20 ต.ค. 2567 11:20:15
    จาก: นาย ณัฐวิทย์
    ไปยัง: บริษัท แอดวานซ์ ไวร์เลส เน็ทเวอร์ค
    จำนวนเงิน: 1,175.93 บาท
    รหัสอ้างอิง: KTB998877665544
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'ktb');
  assert.strictEqual(result.amount, 1175.93);
  assert.strictEqual(result.date, '2024-10-20');
  assert.strictEqual(result.time, '11:20');
  assert.strictEqual(result.refNumber, 'KTB998877665544');
  assert.strictEqual(result.needsReview, false);
});

// 5. TrueMoney Wallet
runTest('TrueMoney: Parses numeric slash date and e-wallet keyword', () => {
  const ocrText = `
    TrueMoney
    โอนเงินสำเร็จ
    05/10/2024 16:30
    ไปยัง: True Coffee
    จำนวนเงินที่โอน: 165.00 บาท
    เลขที่รายการ: TM9876543210
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'truemoney');
  assert.strictEqual(result.amount, 165.00);
  assert.strictEqual(result.date, '2024-10-05');
  assert.strictEqual(result.time, '16:30');
  assert.strictEqual(result.refNumber, 'TM9876543210');
  assert.strictEqual(result.suggestedCategory, 'ค่าอาหาร/ของใช้');
});

// 6. ShopeePay
runTest('ShopeePay: Parses currency symbol and CE year', () => {
  const ocrText = `
    ShopeePay
    โอนเงินสำเร็จ
    10 ต.ค. 2024 13:45
    ไปยัง: ร้าน ข้าวมันไก่ ประตูน้ำ
    ยอดเงิน: ฿80.00
    รหัสธุรกรรม: SP20241010112233
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.bank, 'shopeepay');
  assert.strictEqual(result.amount, 80.00);
  assert.strictEqual(result.date, '2024-10-10');
  assert.strictEqual(result.time, '13:45');
  assert.strictEqual(result.refNumber, 'SP20241010112233');
});

// 7. Ambiguity Guard: Missing Amount
runTest('Ambiguity Guard: Missing amount flags needs_review and does NOT invent 0.00', () => {
  const ocrText = `
    โอนเงินสำเร็จ
    24 ก.ย. 67 14:32 น.
    ไปยัง: เพื่อนร่วมงาน
    รหัสอ้างอิง: REF123456789
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.amount, null, 'Must NOT default to 0.00');
  assert.strictEqual(result.needsReview, true);
  assert.strictEqual(result.status, 'needs_review');
  assert(result.reviewReasons.some(r => r.includes('ยอดเงิน')));
});

// 8. Ambiguity Guard: Missing Date
runTest('Ambiguity Guard: Missing date flags needs_review and does NOT invent today', () => {
  const ocrText = `
    โอนเงินสำเร็จ
    จำนวนเงิน: 500.00 บาท
    ไปยัง: ร้านค้า
  `;
  const result = SlipParser.parse(ocrText);
  assert.strictEqual(result.date, null, 'Must NOT default to today silently');
  assert.strictEqual(result.needsReview, true);
  assert.strictEqual(result.status, 'needs_review');
  assert(result.reviewReasons.some(r => r.includes('วันที่')));
});

// 9. XSS Sanitization
runTest('Security: Strips HTML and script injection attempts from OCR text', () => {
  const ocrText = `
    โอนเงินสำเร็จ
    24 ก.ย. 67 14:32 น.
    ไปยัง: <script>alert("xss")</script>ร้านค้า <b>ABC</b>
    จำนวนเงิน: 250.00 บาท
    เลขที่รายการ: REF99887766
  `;
  const result = SlipParser.parse(ocrText);
  assert(!result.receiver.includes('<script>'), 'HTML brackets must be stripped');
  assert(!result.receiver.includes('<b>'), 'HTML tags must be stripped');
  assert.strictEqual(result.amount, 250.00);
});

// 10. File Fingerprinting
runTest('File Fingerprinting: Stable deterministic hash from file properties', () => {
  const f1 = { name: 'slip1.jpg', size: 102400, lastModified: 1727160000000 };
  const f2 = { name: 'slip1.jpg', size: 102400, lastModified: 1727160000000 };
  const f3 = { name: 'slip2.jpg', size: 204800, lastModified: 1727170000000 };

  const fp1 = SlipParser.generateFileFingerprint(f1);
  const fp2 = SlipParser.generateFileFingerprint(f2);
  const fp3 = SlipParser.generateFileFingerprint(f3);

  assert.strictEqual(fp1, fp2, 'Identical file metadata must produce identical fingerprint');
  assert.notStrictEqual(fp1, fp3, 'Different files must produce different fingerprints');
});

console.log(`\n=======================================================`);
console.log(`🏁 Slip Parser Results: ${passedTests} / ${totalTests} test suites PASSED`);
console.log(`=======================================================\n`);

if (passedTests < totalTests) {
  process.exit(1);
} else {
  process.exit(0);
}
