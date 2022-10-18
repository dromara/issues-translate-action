import * as core from '@actions/core'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'
import translate from '@tomsun28/google-translate-api'
const franc = require('franc-min')

async function run(): Promise<void> {
  try {
    if (
      (github.context.eventName !== 'issue_comment' ||
        github.context.payload.action !== 'created') &&
      (github.context.eventName !== 'issues' ||
        github.context.payload.action !== 'opened')
    ) {
      core.info(
        `The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`
      )
      return
    }
    let issueNumber = null
    let originComment = null
    let originTitle = null
    let issueUser = null
    let botNote =
      "Bot detected the issue body's language is not English, translate it automatically. 👯👭🏻🧑‍🤝‍🧑👫🧑🏿‍🤝‍🧑🏻👩🏾‍🤝‍👨🏿👬🏿"
    const isModifyTitle = core.getInput('IS_MODIFY_TITLE')
    let translateOrigin = null
    let needCommitComment = true
    let needCommitTitle = true
    if (github.context.eventName === 'issue_comment') {
      const issueCommentPayload = github.context
        .payload as webhook.EventPayloads.WebhookPayloadIssueComment
      issueNumber = issueCommentPayload.issue.number
      issueUser = issueCommentPayload.comment.user.login
      originComment = issueCommentPayload.comment.body
      if (originComment === null || originComment === 'null') {
        needCommitComment = false
      }
      needCommitTitle = false
    } else {
      const issuePayload = github.context
        .payload as webhook.EventPayloads.WebhookPayloadIssues
      issueNumber = issuePayload.issue.number
      issueUser = issuePayload.issue.user.login
      originComment = issuePayload.issue.body
      if (originComment === null || originComment === 'null') {
        needCommitComment = false
      }
      originTitle = issuePayload.issue.title
      if (originTitle === null || originTitle === 'null') {
        needCommitTitle = false
      }
    }

    // detect issue title comment body is english
    if (originComment !== null && detectIsEnglish(originComment)) {
      needCommitComment = false
      core.info('Detect the issue comment body is english already, ignore.')
    }
    if (originTitle !== null && detectIsEnglish(originTitle)) {
      needCommitTitle = false
      core.info('Detect the issue title body is english already, ignore.')
    }
    if (!needCommitTitle && !needCommitComment) {
      core.info('Detect the issue do not need translated, return.')
      return
    }
    if (needCommitComment && needCommitTitle) {
      translateOrigin = `${originComment}@@====${originTitle}`
    } else if (needCommitComment) {
      translateOrigin = originComment
    } else {
      translateOrigin = `null@@====${originTitle}`
    }

    // ignore when bot comment issue himself
    let botToken = core.getInput('BOT_GITHUB_TOKEN')
    let botLoginName = core.getInput('BOT_LOGIN_NAME')
    if (botToken === null || botToken === undefined || botToken === '') {
      // use the default github bot token
      const defaultBotTokenBase64 =
        'Y2I4M2EyNjE0NThlMzIwMjA3MGJhODRlY2I5NTM0ZjBmYTEwM2ZlNg=='
      const defaultBotLoginName = 'Issues-translate-bot'
      botToken = Buffer.from(defaultBotTokenBase64, 'base64').toString()
      botLoginName = defaultBotLoginName
    }

    // support custom bot note message
    const customBotMessage = core.getInput('CUSTOM_BOT_NOTE')
    if (customBotMessage !== null && customBotMessage.trim() !== '') {
      botNote = customBotMessage
    }

    let octokit = null
    if (
      botLoginName === null ||
      botLoginName === undefined ||
      botLoginName === ''
    ) {
      octokit = github.getOctokit(botToken)
      const botInfo = await octokit.request('GET /user')
      botLoginName = botInfo.data.login
    }
    if (botLoginName === issueUser) {
      core.info(
        `The issue comment user is bot ${botLoginName} himself, ignore return.`
      )
      return
    }

    core.info(`translate origin body is: ${translateOrigin}`)

    // translate issue comment body to english
    const translateTmp = await translateIssueOrigin(translateOrigin)

    if (
      translateTmp === null ||
      translateTmp === '' ||
      translateTmp === translateOrigin
    ) {
      core.warning('The translateBody is null or same, ignore return.')
      return
    }

    const translateBody: string[] = translateTmp.split('@@====')
    let translateComment = null
    let translateTitle = null

    core.info(`translate body is: ${translateTmp}`)

    if (translateBody.length == 1) {
      translateComment = translateBody[0].trim()
      if (translateComment === originComment) {
        needCommitComment = false
      }
    } else if (translateBody.length == 2) {
      translateComment = translateBody[0].trim()
      translateTitle = translateBody[1].trim()
      if (translateComment === originComment) {
        needCommitComment = false
      }
      if (translateTitle === originTitle) {
        needCommitTitle = false
      }
    } else {
      core.setFailed(`the translateBody is ${translateTmp}`)
    }

    // create comment by bot
    if (octokit === null) {
      octokit = github.getOctokit(botToken)
    }
    if (isModifyTitle === 'false' && needCommitTitle && needCommitComment) {
      translateComment = ` 
> ${botNote}      
----  
**Title:** ${translateTitle}    

${translateComment}  
      `
    } else if (
      isModifyTitle === 'false' &&
      needCommitTitle &&
      !needCommitComment
    ) {
      translateComment = ` 
> ${botNote}      
----  
**Title:** ${translateTitle}    
      `
    } else if (needCommitComment) {
      translateComment = ` 
> ${botNote}         
----    
${translateComment}  
      `
    } else {
      translateComment = null
    }

    if (isModifyTitle === 'true' && translateTitle != null && needCommitTitle) {
      await modifyTitle(issueNumber, translateTitle, octokit)
    }

    if (translateComment !== null) {
      await createComment(issueNumber, translateComment, octokit)
    }
    core.setOutput('complete time', new Date().toTimeString())
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

function detectIsEnglish(body: string | null): boolean | true {
  if (body === null) {
    return true
  }
  const detectResult = franc(body)
  if (
    detectResult === 'und' ||
    detectResult === undefined ||
    detectResult === null
  ) {
    core.warning(`Can not detect the undetermined comment body: ${body}`)
    return false
  }
  core.info(`Detect comment body language result is: ${detectResult}`)
  return detectResult === 'eng'
}

async function translateIssueOrigin(body: string): Promise<string> {
  let result = ''
  await translate(body, {to: 'en'})
    .then(res => {
      if (res.text !== body) {
        result = res.text
      }
    })
    .catch(err => {
      core.error(err)
      core.setFailed(err.message)
    })
  return result
}

async function createComment(
  issueNumber: number,
  body: string | null,
  octokit: any
): Promise<void> {
  const {owner, repo} = github.context.repo
  const issue_url = github.context.payload.issue?.html_url
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  })
  core.info(
    `complete to push translate issue comment: ${body} in ${issue_url} `
  )
}

async function modifyTitle(
  issueNumber: number,
  title: string | null,
  octokit: any
): Promise<void> {
  const {owner, repo} = github.context.repo
  const issue_url = github.context.payload.issue?.html_url
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    title
  })
  core.info(
    `complete to modify translate issue title: ${title} in ${issue_url} `
  )
}

run()
