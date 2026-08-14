import {DEFAULT_BOT_NOTE, detectIsEnglish, normalizeBotNote} from '../src/main'

describe('normalizeBotNote', () => {
  test('falls back to the default bot note when the value is blank', () => {
    expect(normalizeBotNote('   \n\t  ')).toBe(DEFAULT_BOT_NOTE)
  })

  test('collapses line breaks and repeated whitespace into a single space', () => {
    expect(normalizeBotNote('  Hello\n\nworld   from\tgithub  ')).toBe(
      'Hello world from github'
    )
  })
})

describe('detectIsEnglish', () => {
  test('detects English text as English', () => {
    expect(detectIsEnglish('This issue is ready for review')).toBe(true)
  })

  test('detects non-English text as not English', () => {
    expect(detectIsEnglish('这是一个测试问题')).toBe(false)
  })
})
