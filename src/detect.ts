const franc = require('franc-min')

export function detectIsEnglish(body: string | null): boolean {
  if (body === null) {
    return true
  }

  const normalized = body.trim()
  if (normalized === '') {
    return true
  }

  // Non-Latin scripts (CJK, Hangul, Arabic, Indic, Cyrillic, Greek, etc.)
  // are not English, even when the rest of the text is English-heavy.
  if (
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff\u0750-\u077f\u0e00-\u0e7f\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0b00-\u0b7f\u0c00-\u0c7f\u0d00-\u0d7f\u0f00-\u0fff\u1100-\u11ff\u3130-\u318f\u0370-\u03ff\u0400-\u04ff\u0500-\u052f]/u.test(
      normalized
    )
  ) {
    return false
  }

  const detectResult = franc(normalized)
  if (
    detectResult === 'und' ||
    detectResult === undefined ||
    detectResult === null
  ) {
    return false
  }
  return detectResult === 'eng'
}
