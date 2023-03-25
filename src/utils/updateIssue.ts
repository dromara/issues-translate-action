import * as core from '@actions/core'
import * as github from '@actions/github'

interface UpdateIssueParameters {
  discussion_number?: number
  issue_number?: number
  comment_id?: number
  title?: string
  body?: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function updateIssue({
  discussion_number,
  issue_number,
  comment_id,
  title,
  body,
  octokit
}: UpdateIssueParameters): Promise<void> {
  const {owner, repo} = github.context.repo
  if (discussion_number) {
    if (comment_id && body) {
      await octokit.discussion.updateComment({owner, repo, comment_id, body})
    } else if (title || body) {
      await octokit.discussion.update({
        owner,
        repo,
        discussion_number,
        title,
        body
      })
    }
  }

  if (issue_number) {
    if (comment_id && body) {
      await octokit.issues.updateComment({owner, repo, comment_id, body})
    } else if (title || body) {
      await octokit.issues.update({owner, repo, issue_number, title, body})
    }
  }

  const type = discussion_number ? 'discussion' : 'issue'
  const url = github.context.payload[type]?.html_url
  if (title) {
    core.info(`complete to modify translate ${type} title: ${title} in ${url} `)
  }

  if (body) {
    core.info(`complete to modify translate ${type} body: ${body} in ${url} `)
  }
}
