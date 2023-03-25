import * as core from '@actions/core'
import * as github from '@actions/github'

interface CreateIssueCommentParameters {
  issue_number: number
  body: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function createIssueComment({
  issue_number,
  body,
  octokit
}: CreateIssueCommentParameters): Promise<void> {
  const {owner, repo} = github.context.repo
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number,
    body
  })

  const issue_url = github.context.payload.issue?.html_url
  core.info(
    `complete to push translate issue comment: ${body} in ${issue_url} `
  )
}
