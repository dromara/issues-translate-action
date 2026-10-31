import {wait} from '../src/wait'
import {detectIsEnglish} from '../src/detect'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

test('throws invalid number', async () => {
  const input = parseInt('foo', 10)
  await expect(wait(input)).rejects.toThrow('milliseconds not a number')
})

test('wait 500 ms', async () => {
  const start = new Date()
  await wait(500)
  const end = new Date()
  var delta = Math.abs(end.getTime() - start.getTime())
  expect(delta).toBeGreaterThan(450)
})

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
    expect(detectIsEnglish('   ')).toBe(true)
    expect(detectIsEnglish(null)).toBe(true)
  })
})

// Runs the compiled action when lib/main.js exists. `npm test` does not
// require a prior build; this smoke check runs after `npm run build`.
const builtMain = path.join(__dirname, '..', 'lib', 'main.js')
const testRuns = fs.existsSync(builtMain) ? test : test.skip
testRuns('test runs', () => {
  process.env['INPUT_MILLISECONDS'] = '500'
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  console.log(
    cp.execFileSync(process.execPath, [builtMain], options).toString()
  )
})
