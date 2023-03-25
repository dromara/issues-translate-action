import * as core from '@actions/core'
import GoogleTranslate from '@tomsun28/google-translate-api'

export async function translate(text: string): Promise<string | undefined> {
  try {
    const resp = await GoogleTranslate(text, {to: 'en'})
    return resp.text !== text ? resp.text : ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    core.error(err)
    core.setFailed(err.message)
  }
}
