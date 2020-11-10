import * as core from '@actions/core'
import {wait} from './wait'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'

async function run(): Promise<void> {
  try {
    core.info(JSON.stringify(github.context))
    if (
      github.context.payload.action &&
      !['created', 'opened'].includes(github.context.payload.action)
    ) {
      core.info(
        `The status of the action is no applicable ${github.context.payload.action}, return`
      )
      return
    }
    if (github.context.eventName === 'issue') {
      const issuePayload = github.context
        .payload as webhook.EventPayloads.WebhookPayloadIssues
      core.info(JSON.stringify(issuePayload))
    } else if (github.context.eventName === 'issue_comment') {
      const issueCommentPayload = github.context
        .payload as webhook.EventPayloads.WebhookPayloadIssueComment
      core.info(JSON.stringify(issueCommentPayload))
    } else {
      core.info(JSON.stringify(github.context.payload))
    }

    const ms: string = core.getInput('milliseconds')
    core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true

    core.debug(new Date().toTimeString())
    await wait(parseInt(ms, 10))
    core.debug(new Date().toTimeString())

    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
