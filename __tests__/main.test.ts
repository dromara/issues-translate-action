import {detectIsEnglish} from '../src/main'

describe('detectIsEnglish', () => {
  test('detects mixed-language issue bodies as non-English', () => {
    const body = '请帮助修复这个问题，项目支持 http/https 访问。'
    expect(detectIsEnglish(body)).toBe(false)
  })

  test('accepts English-only issue text', () => {
    expect(detectIsEnglish('Please help me fix this issue.')).toBe(true)
  })

  test('treats empty or missing values as English', () => {
    expect(detectIsEnglish('')).toBe(true)
    expect(detectIsEnglish(null)).toBe(true)
  })
})
