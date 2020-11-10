import * as core from '@actions/core'
import {wait} from './wait'
import * as github from '@actions/github'
import * as webhook from '@octokit/webhooks'

async function run(): Promise<void> {
  try {

    console.log(github.context)
    if (github.context.payload.action && !['created', 'opened'].includes(github.context.payload.action)) {
      console.log(`The status of the action is no applicable ${github.context.payload.action}, return`)
      return
    }
    if (github.context.eventName == "issue") {
      const issuePayload = github.context.payload as webhook.EventPayloads.WebhookPayloadIssues;
      console.log(issuePayload)
    } else if (github.context.eventName == "issue_comment") {
      const issueCommentPayload = github.context.payload as webhook.EventPayloads.WebhookPayloadIssueComment;
      console.log(issueCommentPayload)
    } else {
      console.log(github.context.payload)
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
