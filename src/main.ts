import * as core from '@actions/core'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'
import translate from '@k3rn31p4nic/google-translate-api'

let franc = require('franc-min')

async function run(): Promise<void> {
  try {
    if (
      (github.context.eventName !== 'issue_comment' && github.context.eventName != 'issues') ||
      (github.context.payload.action !== 'created' && github.context.payload.action !== 'opened')
    ) {
      core.setFailed(
        `The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`
      )
      return
    }
    let issueNumber = null
    let originBody = null 
    let issueUser = null
    if (github.context.eventName === 'issue_comment') {
      const issueCommentPayload = github.context
      .payload as webhook.EventPayloads.WebhookPayloadIssueComment
      issueNumber = issueCommentPayload.issue.number
      issueUser = issueCommentPayload.comment.user.login
      originBody = issueCommentPayload.comment.body
    } else {
      const issuePayload = github.context.payload as webhook.EventPayloads.WebhookPayloadIssues
      issueNumber = issuePayload.issue.number 
      issueUser = issuePayload.issue.user.login
      originBody = 
      `
**Title:** ${issuePayload.issue.title}  

${issuePayload.issue.body}  
      `
    }

    // detect comment body is english
    if (detectIsEnglish(originBody)) {
      core.info('Detect the issue comment body is english already, ignore return.')
      return
    }

    // ignore when bot comment issue himself
    let botToken = core.getInput('BOT_GITHUB_TOKEN')
    let botLoginName = core.getInput('BOT_LOGIN_NAME')
    if (botToken === null || botToken === undefined || botToken === '') {
      // use the default github bot token
      const defaultBotTokenBase64 = 'Y2I4M2EyNjE0NThlMzIwMjA3MGJhODRlY2I5NTM0ZjBmYTEwM2ZlNg=='
      const defaultBotLoginName = 'Issues-translate-bot'
      botToken = Buffer.from(defaultBotTokenBase64, 'base64').toString()
      botLoginName = defaultBotLoginName
    }

    let octokit = null;
    if (botLoginName === null || botLoginName === undefined || botLoginName === '') {
      octokit = github.getOctokit(botToken)
      const botInfo = await octokit.request('GET /user')
      botLoginName = botInfo.data.login
    }
    if (botLoginName === issueUser) {
      core.info(`The issue comment user is bot ${botLoginName} himself, ignore return.`)
      return
    }
    

    // translate issue comment body to english
    const translateBody = await translateCommentBody(
      originBody, issueUser
    )

    if (translateBody === null 
      || translateBody === '' 
      || translateBody === originBody) {
      core.warning("The translateBody is null or same, ignore return.")
      return
    }

    // create comment by bot
    if (octokit === null) {
      octokit = github.getOctokit(botToken)
    }
    await createComment(issueNumber, translateBody, octokit)
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

async function translateCommentBody(body: string, issueUser: string): Promise<string> {
  let result = ''
  await translate(body, {to: 'en'})
    .then(res => {
      result = 
      `
> @${issueUser}  
> Bot detected the issue body's language is not English, translate it automatically. For the convenience of others, please use English next time👯.     
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

async function createComment(issueNumber: number, body: string, octokit: any): Promise<void> {
  const {owner, repo} = github.context.repo
  const issue_url = github.context.payload.issue?.html_url
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  }) 
  core.info(`complete to push translate issue comment: ${body} in ${issue_url} `)
}

run()
