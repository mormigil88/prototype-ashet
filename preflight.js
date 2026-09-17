/**
 * preflight.js — Sensitive document classifier
 * Blocks passports, ID cards, bank cards, and other sensitive documents
 * from being sent to external Vision APIs.
 */
const fs = require('fs');

/**
 * Classify if an image is a sensitive document that must not leave the machine.
 * Returns { blocked: true, reason: '...' } if blocked, { blocked: false } otherwise.
 *
 * Uses file content analysis (magic bytes) and filename heuristics.
 * Does NOT perform OCR or image classification — only lightweight checks.
 */
function classifyImage(imagePath) {
  // Check filename heuristics first (fast)
  const basename = require('path').basename(imagePath).toLowerCase();

  const sensitivePatterns = [
    // Russian / Cyrillic
    'паспорт', 'passport', 'id_card', 'identity', 'удостоверение',
    'bank_card', 'credit_card', 'debit_card', 'карта_банка',
    'снилс', 'snils', 'инн', 'водительск', 'driver license',
    'visa', 'travel_document', 'ticket_reservation', 'boarding_pass',
    'insurance_policy', 'полис', 'diploma', 'certificate',
    'passport_', 'img_passport', 'scan_passport', 'удостоверение',
    // Latin equivalents
    'driver_license', 'drivers_license', 'license_plate', 'id_card',
    'bankcard', 'creditdebit', 'insurance_card', 'passport_scan',
    'passport_photo', 'passportImg', 'snils', 'inn', 'id_number',
    'voditel', 'voditel_license', 'license_front', 'license_back',
    // Generic sensitive (block ANY filename containing these)
    'sensitive', 'personal', 'private', 'confidential', 'secret',
    'identity_doc', 'id_document', 'tax_document', 'legal_doc',
  ];

  for (const pattern of sensitivePatterns) {
    if (basename.includes(pattern)) {
      return {
        blocked: true,
        reason: `sensitive_document:${pattern}`,
        detail: `Filename suggests sensitive document (${pattern}). Refusing to send to external Vision API.`
      };
    }
  }

  // Check magic bytes (file header) for known document/image types
  try {
    const fd = fs.openSync(imagePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);

    // JPEG, PNG, WebP, TIFF — all okay for now
    // We check for PDF (sensitive docs often scanned as PDF)
    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
      return {
        blocked: true,
        reason: 'sensitive_document:pdf',
        detail: 'PDF files are not accepted (often used for sensitive document scans).'
      };
    }
  } catch (e) {
    // Can't read header — let it pass to Vision, which will fail gracefully
  }

  return { blocked: false };
}

module.exports = { classifyImage };
