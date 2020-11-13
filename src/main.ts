import * as core from '@actions/core'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'
import translate from '@k3rn31p4nic/google-translate-api'

let franc = require('franc-min')

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
      core.info('Detect the issue comment body is english already, ignore return.')
      return
    }

    // ignore when bot comment issue himself
    let myToken = core.getInput('BOT_GITHUB_TOKEN')
    let bot_login_name = core.getInput('BOT_LOGIN_NAME')
    if (myToken === null || myToken === undefined || myToken === '') {
      // use the default github bot token
      const myTokenBase64 = 'Y2I4M2EyNjE0NThlMzIwMjA3MGJhODRlY2I5NTM0ZjBmYTEwM2ZlNg=='
      myToken = Buffer.from(myTokenBase64, 'base64').toString()
      bot_login_name = 'Issues-translate-bot'
    }

    let octokit = null;
    const issue_user = issueCommentPayload.comment.user.login
    if (bot_login_name === null || bot_login_name === undefined || bot_login_name === '') {
      octokit = github.getOctokit(myToken)
      const botInfo = await octokit.request('GET /user')
      bot_login_name = botInfo.data.login
    }
    if (bot_login_name === issue_user) {
      core.info(`The issue comment user is bot ${bot_login_name} himself, ignore return.`)
      return
    }
    

    // translate issue comment body to english
    const issue_translate_comment_body = await translateCommentBody(
      issue_origin_comment_body, issue_user
    )

    if (issue_translate_comment_body === null 
      || issue_translate_comment_body === '' 
      || issue_translate_comment_body === issue_origin_comment_body) {
      core.warning("The issue_translate_comment_body is null or same, ignore return.")
      return
    }

    // create comment by bot
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
  const detectResult = franc(body)
  if (detectResult === 'und' 
  || detectResult === undefined 
  || detectResult === null) {
    core.warning(`Can not detect the undetermined comment body: ${body}`)
    return false
  }
  core.info(`Detect comment body language result is: ${detectResult}`)
  return detectResult === 'eng'
}

async function translateCommentBody(body: string, issue_user: string): Promise<string> {
  let result = ''
  await translate(body, {to: 'en'})
    .then(res => {
      result = 
      `
> @${issue_user}  
> Bot detected the comment body's language is not English, translate it automatically. For the convenience of others, please use English next time👯.     
----  

${res.text}  
      `
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
  core.info(`complete to push translate issue comment: ${body} in ${issue_url} `)
}

run()
