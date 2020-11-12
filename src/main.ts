import * as core from '@actions/core'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'
import LanguageDetect from 'languagedetect'
import translate from '@k3rn31p4nic/google-translate-api'

async function run(): Promise<void> {
  try {
    if (
      github.context.eventName !== 'issue_comment' ||
      github.context.payload.action !== 'created'
    ) {
      core.setFailed(
        `The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`
      )
      return
    }
    const issueCommentPayload = github.context
      .payload as webhook.EventPayloads.WebhookPayloadIssueComment
    const issue_number = issueCommentPayload.issue.number
    const issue_origin_comment_body = issueCommentPayload.comment.body

    // detect comment body is english
    if (detectIsEnglish(issue_origin_comment_body)) {
      core.info('the issue comment body is english already, ignore return.')
      return
    }

    // ignore when bot comment issue himself
    const myToken = core.getInput('BOT_GITHUB_TOKEN')
    let octokit = null;
    const issue_user = issueCommentPayload.comment.user.login
    let bot_login_name = core.getInput('BOT_LOGIN_NAME')
    core.info(`bot_login_name1: ${bot_login_name}`)
    if (bot_login_name === null || bot_login_name === undefined || bot_login_name === '') {
      octokit = github.getOctokit(myToken)
      const botInfo = await octokit.request('GET /user')
      core.info(JSON.stringify(botInfo))
      bot_login_name = botInfo.data.login
      core.info(`bot_login_name2: ${bot_login_name}`)
    }
    if (bot_login_name === issue_user) {
      core.info("The issue comment user is bot self, ignore return.")
      return
    }
    

    // translate issue comment body to english
    const issue_translate_comment_body = await translateCommentBody(
      issue_origin_comment_body
    )

    if (issue_translate_comment_body === null 
      || issue_translate_comment_body === '' 
      || issue_translate_comment_body === issue_origin_comment_body) {
      core.warning("The issue_translate_comment_body is null or same, ignore return.")
      return
    }

    // create comment by bot
    core.info(issue_translate_comment_body)
    if (octokit === null) {
      octokit = github.getOctokit(myToken)
    }
    await createComment(issue_number, issue_translate_comment_body, octokit)
    core.setOutput('complete time', new Date().toTimeString())
  } catch (error) {
    core.setFailed(error.message)
  }
}

function detectIsEnglish(body: string): boolean | true {
  const lngDetector = new LanguageDetect()
  const detectResult = lngDetector.detect(body, 1)
  core.info(`detect comment body result is: ${detectResult[0][0]}, sorce: ${detectResult[0][1]}`)
  return detectResult.length === 1 && detectResult[0][0] === 'english'
}

async function translateCommentBody(body: string): Promise<string> {
  let result = ''
  await translate(body, {to: 'en'})
    .then(res => {
      result = res.text
    })
    .catch(err => {
      core.error(err)
      core.setFailed(err.message)
    })
  return result
}

async function createComment(issueId: number, body: string, octokit: any): Promise<void> {
  const {owner, repo} = github.context.repo
  const issue_url = github.context.payload.issue?.html_url
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueId,
    body
  }) 
  core.info(`complete to push translate issue comment: ${body} in ${issue_url}.`)
}

run()
