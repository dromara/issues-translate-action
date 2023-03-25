import * as core from '@actions/core'
import * as github from '@actions/github'
import {createIssueComment, updateIssue, isEnglish, translate} from './utils'

const TRANSLATE_TITLE_DIVING = ` || `
const TRANSLATE_DIVIDING_LINE = `<!--This is a translation content dividing line, the content below is generated by machine, please do not modify the content below-->`
const DEFAULT_BOT_MESSAGE = `Bot detected the issue body's language is not English, translate it automatically. 👯👭🏻🧑‍🤝‍🧑👫🧑🏿‍🤝‍🧑🏻👩🏾‍🤝‍👨🏿👬🏿`
const DEFAULT_BOT_TOKEN = process.env.GITHUB_TOKEN

async function run(): Promise<void> {
  try {
    const {
      context: {
        eventName,
        payload: {issue, discussion, comment}
      }
    } = github

    core.info(JSON.stringify(github.context))

    const isModifyTitle = core.getInput('IS_MODIFY_TITLE')
    const shouldAppendContent = core.getInput('APPEND_TRANSLATION')
    const originTitle = issue?.title?.split(TRANSLATE_TITLE_DIVING)?.[0]
    const originComment = (eventName.endsWith('_comment')
      ? comment?.body
      : discussion?.body || issue?.body
    )?.split(TRANSLATE_DIVIDING_LINE)?.[0]

    const botNote =
      core.getInput('CUSTOM_BOT_NOTE')?.trim() || DEFAULT_BOT_MESSAGE

    if (!issue?.number) {
      return
    }

    let needCommitComment =
      originComment && originComment !== 'null' && !isEnglish(originComment)

    let needCommitTitle =
      ['issues', 'discussion'].includes(eventName) &&
      originTitle &&
      originTitle !== 'null' &&
      !isEnglish(originTitle)

    let translateOrigin = null

    if (originComment && originComment !== 'null' && !needCommitComment) {
      core.info('Detect the issue comment body is english already, ignore.')
    }
    if (originTitle && originTitle !== null && !needCommitTitle) {
      core.info('Detect the issue title body is english already, ignore.')
    }

    if (!needCommitTitle && !needCommitComment) {
      return core.info('Detect the issue do not need translated, return.')
    }

    if (needCommitComment && needCommitTitle) {
      translateOrigin = `${originComment}@@====${originTitle}`
    } else if (needCommitComment) {
      translateOrigin = originComment
    } else {
      translateOrigin = `null@@====${originTitle}`
    }

    // ignore when bot comment issue himself
    const botToken = core.getInput('BOT_GITHUB_TOKEN') || DEFAULT_BOT_TOKEN
    if (!botToken) {
      return core.info(`GITHUB_TOKEN is requried!`)
    }
    const octokit = github.getOctokit(botToken)

    core.info(`translate origin body is: ${translateOrigin}`)

    // translate issue comment body to english
    const translateTmp = await translate(translateOrigin)
    if (!translateTmp || translateTmp === translateOrigin) {
      return core.warning('The translateBody is null or same, ignore return.')
    }

    const translateBody: string[] = translateTmp.split('@@====')
    let translateComment = translateBody[0].trim()
    const translateTitle = translateBody?.[1]?.trim()

    core.info(`translate body is: ${translateTmp}`)

    if (translateComment === originComment) {
      needCommitComment = false
    }
    if (translateTitle === originTitle) {
      needCommitTitle = false
    }

    if (shouldAppendContent) {
      if (needCommitTitle && translateTitle) {
        const title = [originTitle, translateTitle].join(TRANSLATE_TITLE_DIVING)
        await updateIssue({
          issue_number: issue.number,
          title,
          octokit
        })
      }

      if (needCommitComment) {
        // eslint-disable-next-line no-shadow
        const comment = `${originComment}
${TRANSLATE_DIVIDING_LINE}
---
${translateComment}
`
        await updateIssue({
          issue_number: issue.number,
          comment_id: github.context.payload.comment?.id,
          body: comment,
          octokit
        })
      }
    } else {
      translateComment = `
> ${botNote}
----
${
  isModifyTitle === 'false' && needCommitComment
    ? `**Title:** ${translateTitle}`
    : ''
}

${translateComment}`
      if (isModifyTitle === 'true' && translateTitle && needCommitTitle) {
        await updateIssue({
          issue_number: issue.number,
          title: translateTitle,
          octokit
        })
      }

      if (needCommitComment && translateComment) {
        await createIssueComment({
          issue_number: issue.number,
          body: translateComment,
          octokit
        })
      }
    }

    core.setOutput('complete time', new Date().toTimeString())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
