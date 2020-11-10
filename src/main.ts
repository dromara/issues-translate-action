import * as core from '@actions/core'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'
import LanguageDetect from 'languagedetect'
import translate from '@k3rn31p4nic/google-translate-api'

async function run(): Promise<void> {
  try {
    if (
      github.context.eventName !== 'issue_comment' ||
      github.context.payload.action ||
      github.context.payload.action !== 'created'
    ) {
      core.setFailed(
        `The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`
      )
      return
    }
    const issueCommentPayload = github.context
      .payload as webhook.EventPayloads.WebhookPayloadIssueComment
    const issue_id = issueCommentPayload.issue.id
    const issue_origin_comment_body = issueCommentPayload.comment.body
    core.info(issue_origin_comment_body)
    let issue_translate_comment_body = null

    // detect comment body is english
    if (detectIsEnglish(issue_origin_comment_body)) {
      core.info('the issue comment body is english already.')
      return
    }

    issue_translate_comment_body = await translateCommentBody(
      issue_origin_comment_body
    )
    core.info(issue_translate_comment_body)
    await createComment(issue_id, issue_translate_comment_body)
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    core.setFailed(error.message)
  }
}

function detectIsEnglish(body: string): boolean | true {
  const lngDetector = new LanguageDetect()
  const detectResult = lngDetector.detect(body, 1)
  return detectResult.length === 1 && detectResult[0][0] === 'english'
}

async function translateCommentBody(body: string): Promise<string> {
  let result = ''
  await translate(body, {to: 'en'})
    .then(res => {
      core.info(res.text)
      result = res.text
    })
    .catch(err => {
      core.error(err)
      core.setFailed(err.message)
    })
  return result
}

async function createComment(issueId: number, body: string): Promise<void> {
  const {owner, repo} = github.context.repo
  const myToken = core.getInput('bot_github_token')
  const octokit = github.getOctokit(myToken)
  await octokit.issues.createComment({
    owner,
    repo,
    ['issue_number']: issueId,
    body
  })
}

run()
