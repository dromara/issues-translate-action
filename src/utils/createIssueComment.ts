import * as core from '@actions/core'
import * as github from '@actions/github'

interface CreateIssueCommentParameters {
  discussion_number?: number
  issue_number?: number
  body: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function createIssueComment({
  discussion_number,
  issue_number,
  body,
  octokit
}: CreateIssueCommentParameters): Promise<void> {
  const {owner, repo} = github.context.repo
  // if (discussion_number) {
  //   await octokit.discussion.createComment({
  //     owner,
  //     repo,
  //     discussion_number,
  //     body
  //   })
  // }

  if (issue_number) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number,
      body
    })
  }

  const type = discussion_number ? 'discussion' : 'issue'
  const url = github.context.payload[type]?.html_url
  core.info(`complete to push translate ${type} comment: ${body} in ${url} `)
}
