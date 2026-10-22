/**
 * FreelanceHub Slip Parser (On-Device OCR Text Extraction Engine)
 * Pure function module for parsing transfer slips across Thai banks & e-wallets:
 * - K PLUS (Kasikornbank)
 * - MAKE by KBank
 * - SCB EASY (Siam Commercial Bank)
 * - Krungthai NEXT (KTB)
 * - TrueMoney Wallet
 * - ShopeePay
 * 
 * Extracts: Amount, Date, Time, Receiver/Merchant, Reference ID, Bank Brand
 * Ambiguity Guard: Flags incomplete/ambiguous slips as 'needs_review'
 * Zero external network calls. Safe from XSS.
 */

(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.SlipParser = factory();
    root.SlipParserEngine = root.SlipParser;
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var THAI_MONTHS_MAP = {
    'ม.ค.': '01', 'มกราคม': '01', 'มกรา': '01',
    'ก.พ.': '02', 'กุมภาพันธ์': '02', 'กุมภา': '02',
    'มี.ค.': '03', 'มีนาคม': '03', 'มีนา': '03',
    'เม.ย.': '04', 'เมษายน': '04', 'เมษา': '04',
    'พ.ค.': '05', 'พฤษภาคม': '05', 'พฤษภา': '05',
    'มิ.ย.': '06', 'มิถุนายน': '06', 'มิถุนา': '06',
    'ก.ค.': '07', 'กรกฎาคม': '07', 'กรกฎา': '07',
    'ส.ค.': '08', 'สิงหาคม': '08', 'สิงหา': '08',
    'ก.ย.': '09', 'กันยายน': '09', 'กันยา': '09',
    'ต.ค.': '10', 'ตุลาคม': '10', 'ตุลา': '10',
    'พ.ย.': '11', 'พฤศจิกายน': '11', 'พฤศจิกา': '11',
    'ธ.ค.': '12', 'ธันวาคม': '12', 'ธันวา': '12'
  };

  var ENG_MONTHS_MAP = {
    'jan': '01', 'january': '01',
    'feb': '02', 'february': '02',
    'mar': '03', 'march': '03',
    'apr': '04', 'april': '04',
    'may': '05',
    'jun': '06', 'june': '06',
    'jul': '07', 'july': '07',
    'aug': '08', 'august': '08',
    'sep': '09', 'september': '09', 'sept': '09',
    'oct': '10', 'october': '10',
    'nov': '11', 'november': '11',
    'dec': '12', 'december': '12'
  };

  function sanitizeText(str) {
    if (!str) return '';
    return String(str)
      .replace(/\u0e4d\u0e32/g, '\u0e33')
      .replace(/[<>]/g, '')
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '')
      .trim();
  }

  var BANK_LABELS = {
    make: 'MAKE by KBank', kbank: 'K PLUS / กสิกรไทย', scb: 'SCB / ไทยพาณิชย์',
    ktb: 'Krungthai / กรุงไทย', paotang: 'เป๋าตัง / G-Wallet',
    truemoney: 'TrueMoney Wallet', shopeepay: 'ShopeePay', unknown: 'ไม่ระบุธนาคาร'
  };

  function matchBrand(text) {
    var t = text.toLowerCase().replace(/\s+/g, '');
    if (/make(?:by)?kbank/.test(t)) return 'make';
    if (/เป๋าตัง|g-wallet/.test(t)) return 'paotang';
    if (/truemoney|truewallet|ทรูมันนี่/.test(t)) return 'truemoney';
    if (/shopeepay|ช้อปปี้เพย์|airpay/.test(t)) return 'shopeepay';
    if (/kplus|kbank|กสิกรไทย/.test(t)) return 'kbank';
    if (/scb|ไทยพาณิชย์/.test(t)) return 'scb';
    if (/krungthai|กรุงไทย|\bktb\b/.test(t)) return 'ktb';
    return 'unknown';
  }

  function detectBank(text) {
    // Identify the issuer before the recipient block, never from a recipient bank or memo.
    var lines = String(text || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var prefix = [];
    for (var i = 0; i < lines.length; i++) {
      if (/^(?:ไปยัง|ผู้รับ|เข้าบัญชี|to\b|recipient\b|บันทึกช่วยจำ|หมายเหตุ)/i.test(lines[i])) break;
      prefix.push(lines[i]);
    }
    var head = prefix.join('\n');
    // MAKE logo and “by KBank” can be separate OCR lines.
    if (/(?:make|["']ake)[\s\S]{0,90}by\s*kbank/i.test(head)) return 'make';
    for (var j = 0; j < prefix.length; j++) {
      if (/^[-\s]*scr$/i.test(prefix[j])) return 'scb'; // OCR confusion on standalone SCB logo only
      var brand = matchBrand(prefix[j]);
      if (brand !== 'unknown') return brand;
    }
    return 'unknown';
  }

  function extractCaption(text, bank) {
    var lines = String(text || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var stop = /^(?:ผู้รับเงินสามารถ|ตรวจสอบสถานะ|สแกน|scan|qr|รหัสอ้างอิง|เลขที่รายการ|ค่าธรรมเนียม|จำนวนเงิน|วันที่ทำรายการ)/i;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(?:[บป]ันทึกช่วยจำ|บันทึกช่วยจํา|หมายเหตุ|ข้อความถึงผู้รับ|ข้อความเพิ่มเติม|memo|note|remark)\s*[:：-]?\s*(.*)$/i);
      if (m) {
        var parts = m[1] ? [m[1]] : [];
        if (!parts.length && lines[i + 1] && !stop.test(lines[i + 1])) parts.push(lines[i + 1]);
        return sanitizeText(parts.join('\n'));
      }
    }
    // MAKE has an unlabelled message box after the transaction reference.
    if (bank === 'make') {
      var refIndex = lines.findIndex(function(l) { return /^(?:เลขที่รายการ|รหัสอ้างอิง)\s*[:：]?/.test(l); });
      if (refIndex >= 0) {
        var tail = lines.slice(refIndex + 1);
        if (tail.length && /^[A-Za-z0-9_-]{8,}$/.test(tail[0])) tail.shift();
        tail = tail.filter(function(l) { return !/^(?:สแกนเพื่อตรวจสอบ|scan to verify|qr code)$/i.test(l); });
        if (tail.length && !stop.test(tail[0]) && /[ก-๙A-Za-z]{2}/.test(tail[0])) {
          return sanitizeText(tail[0]);
        }
      }
    }
    return '';
  }

  function normalizeYear(rawYear) {
    var y = parseInt(rawYear, 10);
    if (isNaN(y)) return null;
    // 4-digit Buddhist Era (e.g. 2567 -> 2024)
    if (y >= 2500 && y <= 2650) {
      return y - 543;
    }
    // 2-digit Buddhist Era (e.g. 67 -> 2024)
    if (y >= 50 && y <= 99) {
      return 2500 + y - 543;
    }
    // 4-digit Common Era (e.g. 2024 -> 2024)
    if (y >= 2000 && y <= 2099) {
      return y;
    }
    // 2-digit Common Era (e.g. 24 -> 2024)
    if (y >= 20 && y <= 49) {
      return 2000 + y;
    }
    return y;
  }

  function extractDateAndTime(text) {
    if (!text) return { date: null, time: null, rawDate: null };

    var date = null;
    var time = null;
    var rawDate = null;

    // 1. Time extraction (HH:mm or HH:mm:ss)
    var timeMatch = text.match(/\b([01]?[0-9]|2[0-3])[:.]([0-5][0-9])(?::([0-5][0-9]))?\b(?:\s*น\.)?/);
    if (timeMatch) {
      var hh = ('0' + timeMatch[1]).slice(-2);
      var mm = timeMatch[2];
      time = hh + ':' + mm;
    }

    // 2. Date with Thai Month (e.g. "24 ก.ย. 2567", "15 ต.ค. 67", "5 มกราคม 2025")
    var thaiMonthPattern = new RegExp(
      '\\b([0-2]?[0-9]|3[01])\\s*(' + Object.keys(THAI_MONTHS_MAP).join('|').replace(/\./g, '\\.') + ')\\s*([0-9]{2,4})\\b',
      'i'
    );
    var thaiMatch = text.match(thaiMonthPattern);
    if (thaiMatch) {
      var d = ('0' + thaiMatch[1]).slice(-2);
      var mKey = thaiMatch[2].toLowerCase();
      var m = THAI_MONTHS_MAP[mKey];
      var y = normalizeYear(thaiMatch[3]);
      if (y && m && d) {
        date = y + '-' + m + '-' + d;
        rawDate = thaiMatch[0];
      }
    }

    // 3. Date with English Month (e.g. "24 Sep 2024", "15 October 2024")
    if (!date) {
      var engMonthPattern = new RegExp(
        '\\b([0-2]?[0-9]|3[01])\\s*([A-Za-z]{3,9})\\s*([0-9]{2,4})\\b',
        'i'
      );
      var engMatch = text.match(engMonthPattern);
      if (engMatch) {
        var emKey = engMatch[2].toLowerCase();
        if (ENG_MONTHS_MAP[emKey]) {
          var ed = ('0' + engMatch[1]).slice(-2);
          var em = ENG_MONTHS_MAP[emKey];
          var ey = normalizeYear(engMatch[3]);
          if (ey && em && ed) {
            date = ey + '-' + em + '-' + ed;
            rawDate = engMatch[0];
          }
        }
      }
    }

    // 4. Numeric Slash/Dash Date (e.g. "24/09/2567", "24/09/2024", "2024-09-24")
    if (!date) {
      var numMatch = text.match(/\b([0-2]?[0-9]|3[01])[\/\-.]([01]?[0-9])[\/\-.]([0-9]{2,4})\b/);
      if (numMatch) {
        var nd = ('0' + numMatch[1]).slice(-2);
        var nm = ('0' + numMatch[2]).slice(-2);
        var ny = normalizeYear(numMatch[3]);
        if (ny && parseInt(nm, 10) >= 1 && parseInt(nm, 10) <= 12) {
          date = ny + '-' + nm + '-' + nd;
          rawDate = numMatch[0];
        }
      }
    }

    return { date: date, time: time, rawDate: rawDate };
  }

  function extractAmount(text) {
    if (!text) return null;

    // Subsidised receipts: use the amount actually paid, including integer baht.
    var paid = text.match(/(?:จำนวน(?:เงิน|เจงิน)ที่ชำระ|ยอดชำระทั้งหมด)\s*[:：]?\s*(?:฿|THB)?\s*(\d[\d,]*(?:\.\d{2})?)/i);
    if (paid) return Number(paid[1].replace(/,/g, ''));
    var lines = text.split('\n');
    var candidates = [];

    // Helper: test if line indicates fee or balance to ignore
    function isIgnoredLine(line) {
      var l = line.toLowerCase();
      if (l.includes('ค่าธรรมเนียม') || l.includes('fee') || l.includes('0.00 บาท')) {
        if (!l.includes('จำนวนเงิน') && !l.includes('ยอดเงิน')) return true;
      }
      if (l.includes('ยอดเงินคงเหลือ') || l.includes('คงเหลือ') || l.includes('balance') || l.includes('ยอดคงเหลือ')) {
        return true;
      }
      return false;
    }

    // Pass 1: Look for explicit labels: "จำนวนเงิน", "ยอดเงิน", "Amount", "THB", "บาท"
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (isIgnoredLine(line)) continue;

      // Label followed by number on same line or within next line
      var labelMatch = line.match(/(?:จำนวนเงิน|จำนวน|ยอดเงิน|Amount|Total)\s*[:]?\s*(?:฿|THB)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/i);
      if (labelMatch) {
        var val = parseFloat(labelMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          candidates.push({ amount: val, priority: 1 });
        }
      } else if (/(?:จำนวนเงิน|ยอดเงิน|Amount)\s*[:]?$/i.test(line) && i + 1 < lines.length) {
        // Amount label on one line, number on next line
        var nextLine = lines[i + 1].trim();
        var nextMatch = nextLine.match(/^(?:฿|THB)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/i);
        if (nextMatch) {
          var val2 = parseFloat(nextMatch[1].replace(/,/g, ''));
          if (!isNaN(val2) && val2 > 0) {
            candidates.push({ amount: val2, priority: 1 });
          }
        }
      }

      // Suffix pattern: "500.00 บาท" or "500.00 THB"
      var suffixMatch = line.match(/\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))\s*(?:บาท|THB)\b/i);
      if (suffixMatch && !line.includes('ค่าธรรมเนียม') && !line.includes('คงเหลือ')) {
        var val3 = parseFloat(suffixMatch[1].replace(/,/g, ''));
        if (!isNaN(val3) && val3 > 0) {
          candidates.push({ amount: val3, priority: 2 });
        }
      }
    }

    // Pass 2: Look for currency symbol: ฿1,200.00
    if (candidates.length === 0) {
      var symbolMatch = text.match(/(?:฿|THB)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/i);
      if (symbolMatch) {
        var val4 = parseFloat(symbolMatch[1].replace(/,/g, ''));
        if (!isNaN(val4) && val4 > 0) {
          candidates.push({ amount: val4, priority: 3 });
        }
      }
    }

    // Pass 3: General decimal number with commas, excluding 0.00 and phone/account patterns
    if (candidates.length === 0) {
      var genericMatches = text.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))\b/g);
      for (var match of genericMatches) {
        var val5 = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val5) && val5 > 0) {
          // Avoid matching 0.00 (fee)
          candidates.push({ amount: val5, priority: 4 });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Pick candidate with highest priority (lowest priority number)
    candidates.sort(function(a, b) { return a.priority - b.priority; });
    return candidates[0].amount;
  }

  function extractReceiver(text) {
    if (!text) return '';
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var m = line.match(/^(?:ไปยัง|ผู้รับเงิน|เข้าบัญชี|To\b|Recipient\b)\s*[:]?\s*(.*)/i);
      if (m) {
        var receiver = m[1].trim();
        // If receiver is empty on this line, check next line
        if (!receiver && i + 1 < lines.length) {
          receiver = lines[i + 1].trim();
        }
        // Remove account numbers if attached (e.g. "xxx-1234")
        receiver = receiver.replace(/\b[xX0-9]{3,}[-xX0-9]*\b/g, '').trim();
        if (receiver.length > 1) {
          return sanitizeText(receiver);
        }
      }
    }
    return '';
  }

  function extractReferenceNumber(text) {
    if (!text) return '';
    var refMatch = text.match(/(?:เลขที่รายการ|รหัสอ้างอิง|เลขที่อ้างอิง|รหัสธุรกรรม|Transaction Ref|Ref No|Reference No|Ref)\s*[:]?\s*([A-Za-z0-9_-]{8,})/i);
    if (refMatch && refMatch[1]) {
      return sanitizeText(refMatch[1]);
    }
    return '';
  }

  function suggestCategory(merchantOrNote) {
    if (!merchantOrNote) return '';
    var lower = merchantOrNote.toLowerCase();
    if (lower.includes('7-eleven') || lower.includes('seven') || lower.includes('เซเว่น') ||
        lower.includes('อาหาร') || lower.includes('food') || lower.includes('grab') ||
        lower.includes('lineman') || lower.includes('lotus') || lower.includes('cafe') ||
        lower.includes('coffee') || lower.includes('กาแฟ')) {
      return 'ค่าอาหาร/ของใช้';
    }
    if (lower.includes('ptt') || lower.includes('ปตท') || lower.includes('shell') ||
        lower.includes('บางจาก') || lower.includes('น้ำมัน') || lower.includes('ทางด่วน') ||
        lower.includes('bts') || lower.includes('mrt') || lower.includes('grab car')) {
      return 'ค่าเดินทาง/ที่พัก';
    }
    if (lower.includes('adobe') || lower.includes('apple') || lower.includes('google') ||
        lower.includes('canva') || lower.includes('chatgpt') || lower.includes('กล้อง') ||
        lower.includes('เลนส์') || lower.includes('อุปกรณ์')) {
      return 'ค่าอุปกรณ์/ซอฟต์แวร์';
    }
    if (lower.includes('ค่าไฟ') || lower.includes('ค่าน้ำ') || lower.includes('ค่าเน็ต') ||
        lower.includes('ais') || lower.includes('truemove') || lower.includes('true online') ||
        lower.includes('dtac') || lower.includes('การไฟฟ') || lower.includes('การประปา')) {
      return 'สาธารณูปโภค/บิล';
    }
    if (lower.includes('ค่าเช่า') || lower.includes('สตูดิโอ') || lower.includes('studio')) {
      return 'ค่าเช่า/สตูดิโอ';
    }
    return '';
  }

  function parse(ocrText, options) {
    options = options || {};
    var raw = ocrText || '';
    var clean = sanitizeText(raw);

    var bank = detectBank(sanitizeText(options.headerText || ''));
    if (bank === 'unknown') bank = detectBank(clean);
    var caption = extractCaption(clean, bank);
    if (bank === 'make' && caption && /[ก-๙]/.test(options.captionText || '')) {
      var captionLines = sanitizeText(options.captionText).split('\n');
      caption = captionLines.find(function(l) { return /[ก-๙]{2}/.test(l); }) || caption;
      caption = caption.replace(/^[|\s]+/, '');
    }
    var amount = extractAmount(clean);
    var dateTimeInfo = extractDateAndTime(clean);
    var receiver = extractReceiver(clean);
    var refNumber = extractReferenceNumber(clean);

    var needsReview = false;
    var reviewReasons = [];
    if (caption) { needsReview = true; reviewReasons.push('กรุณาตรวจแคปชั่นจาก OCR ก่อนบันทึก'); }
    if (bank === 'unknown') { needsReview = true; reviewReasons.push('ไม่สามารถระบุแอปต้นทางได้จากข้อความ'); }

    if (amount === null || typeof amount === 'undefined' || amount <= 0) {
      needsReview = true;
      reviewReasons.push('ไม่พบยอดเงินที่ชัดเจน กรุณาระบุยอดเงิน');
    }

    if (!dateTimeInfo.date) {
      needsReview = true;
      reviewReasons.push('ไม่พบวันที่ทำรายการ กรุณาระบุวันที่');
    }

    // Default note
    var noteParts = [];
    if (caption) noteParts.push(caption);
    if (receiver) noteParts.push(receiver);
    if (refNumber) noteParts.push('Ref: ' + refNumber);
    var suggestedNote = noteParts.join(' • ');

    var suggestedCat = suggestCategory(caption || receiver);

    return {
      success: true,
      bank: bank,
      bankSource: BANK_LABELS[bank],
      caption: caption,
      amount: amount !== null ? amount : null,
      date: dateTimeInfo.date,
      time: dateTimeInfo.time || null,
      receiver: receiver,
      refNumber: refNumber,
      note: suggestedNote,
      suggestedCategory: suggestedCat,
      needsReview: needsReview,
      needs_review: needsReview,
      reviewReasons: reviewReasons,
      status: needsReview ? 'needs_review' : 'ready',
      confidence: (amount !== null && dateTimeInfo.date && refNumber) ? 'high' : (amount !== null && dateTimeInfo.date ? 'medium' : 'low'),
      rawTextLength: raw.length
    };
  }

  function generateFileFingerprint(file) {
    if (!file) return null;
    var name = file.name || 'unnamed';
    var size = file.size || 0;
    var time = file.lastModified || 0;
    var str = name + '_' + size + '_' + time;
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return 'fp_' + Math.abs(hash).toString(16);
  }

  return {
    parse: parse,
    parseSlipText: parse,
    detectBank: detectBank,
    extractCaption: extractCaption,
    extractAmount: extractAmount,
    extractDateAndTime: extractDateAndTime,
    extractReceiver: extractReceiver,
    extractReferenceNumber: extractReferenceNumber,
    suggestCategory: suggestCategory,
    generateFileFingerprint: generateFileFingerprint,
    sanitizeText: sanitizeText
  };
}));
