#!/usr/bin/env python3
"""
preflight.py — Local content preflight with OCR + local classification.
Blocks sensitive documents BEFORE any external API call.
No external network access, no VisionProvider invocation.
"""
import sys
import re
import os

try:
    import pytesseract
    from PIL import Image
    HAS_OCR = True
except ImportError:
    HAS_OCR = False
    # OCR is REQUIRED — without it we cannot guarantee no sensitive content leaked to Vision API.
    # preflight MUST fail if OCR is unavailable.
    _OCR_UNAVAILABLE = True

TESSDATA_PREFIX = os.environ.get('TESSDATA_PREFIX', '/usr/share/tesseract-ocr/5/tessdata')

# ─── SENSITIVE DOCUMENT PATTERNS ──────────────────────────────────────────────
RUSSIAN_PASSPORT_PATTERNS = [
    r'паспорт\s*(гражданина\s*)?рф',
    r'серия\s*\d{4}',
    r'номер\s*\d{6}',
    r'[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.',
    r'дата\s+рождения',
    r'место\s+рождения',
    r'код\s+подразделения',
    r'\d{4}\s+\d{6}',  # series + number
]

INTERNATIONAL_PASSPORT_PATTERNS = [
    r'passport',
    r'nationality',
    r'surname.*given\s*names',
    r'date\s+of\s+birth',
    r'place\s+of\s+birth',
    r'travel\s+document',
]

BANK_CARD_PATTERNS = [
    r'\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}',  # 16 digits
    r'\d{4}[\s\-]?\d{6}[\s\-]?\d{5}',  # Amex
    r'cvv', r'cvc', r'valid\s*thru', r'exp\s*date',
]

ID_DOCUMENT_PATTERNS = [
    r'удостоверение',
    r'водительск',
    r'driver\s*license',
    r'id\s*card',
    r'identity\s*card',
    r'снилс',
    r'snils',
    r'инн\b',
    r'tax\s*id',
    r'taxpayer',
]


def ocr_image(image_path: str) -> str:
    """Extract text from image using tesseract OCR. FAILS if OCR unavailable."""
    if not HAS_OCR:
        print(
            "FATAL: tesseract-ocr or pytesseract not installed. "
            "OCR is required for preflight — cannot proceed without it.",
            file=sys.stderr
        )
        sys.exit(1)
    try:
        langs = 'eng+rus'
        tessdata = TESSDATA_PREFIX
        text = pytesseract.image_to_string(
            Image.open(image_path),
            lang=langs,
            config=f'--tessdata-dir {tessdata}'
        )
        return text.lower()
    except Exception as e:
        print(f"OCR FAILED: {e}", file=sys.stderr)
        sys.exit(1)


def classify_document(image_path: str) -> dict:
    """
    Returns {blocked: True, reason, detail} if sensitive document detected,
    or {blocked: False} if clean.
    Always check filename FIRST (fast path, no OCR needed).
    """
    # 1. Filename-based fast check (before any OCR)
    import os as _os
    basename = _os.path.basename(image_path).lower()
    SENSITIVE_FILENAME_KEYWORDS = [
        'passport', 'bank_card', 'credit_card', 'debit_card',
        'снилс', 'snils', 'инн', 'водительск', 'удостоверение',
        'driver_license', 'visa', 'boarding_pass', 'insurance',
        'sensitive', 'personal', 'identity', 'id_card', 'id_document',
    ]
    for kw in SENSITIVE_FILENAME_KEYWORDS:
        if kw in basename:
            return {
                'blocked': True,
                'reason': f'sensitive_document:filename:{kw}',
                'detail': f'Filename contains sensitive keyword: {kw}. Hard stop.'
            }

    # 2. OCR-based check
    text = ocr_image(image_path)
    text_lower = text.lower()

    all_patterns = (
        RUSSIAN_PASSPORT_PATTERNS +
        INTERNATIONAL_PASSPORT_PATTERNS +
        BANK_CARD_PATTERNS +
        ID_DOCUMENT_PATTERNS
    )

    matched = []
    for pattern in all_patterns:
        if re.search(pattern, text_lower):
            matched.append(pattern)

    categories = {
        'passport': any(re.search(p, text_lower) for p in RUSSIAN_PASSPORT_PATTERNS + INTERNATIONAL_PASSPORT_PATTERNS),
        'bank_card': any(re.search(p, text_lower) for p in BANK_CARD_PATTERNS),
        'id_doc': any(re.search(p, text_lower) for p in ID_DOCUMENT_PATTERNS),
    }
    hit_categories = [k for k, v in categories.items() if v]

    if len(hit_categories) >= 2:
        return {
            'blocked': True,
            'reason': f'sensitive_document:{hit_categories}',
            'detail': f'Local OCR detected sensitive document patterns: {hit_categories}. '
                      f'Hard stop — no Vision API call will be made.'
        }

    if hit_categories:
        return {
            'blocked': True,
            'reason': f'sensitive_document:{hit_categories[0]}',
            'detail': f'Local OCR detected: {hit_categories[0]}. Hard stop.'
        }

    return {'blocked': False}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 preflight.py <image_path>')
        sys.exit(1)

    image_path = sys.argv[1]
    result = classify_document(image_path)

    if result['blocked']:
        print(f"BLOCKED: {result['detail']}", file=sys.stderr)
        print(f"reason: {result['reason']}", file=sys.stderr)
        sys.exit(2)
    else:
        print("CLEAN", file=sys.stderr)
        sys.exit(0)
