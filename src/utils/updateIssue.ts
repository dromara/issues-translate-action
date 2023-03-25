import * as core from '@actions/core'
import * as github from '@actions/github'

interface UpdateIssueParameters {
  issue_number: number
  comment_id?: number
  title?: string
  body?: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function updateIssue({
  issue_number,
  comment_id,
  title,
  body,
  octokit
}: UpdateIssueParameters): Promise<void> {
  const {owner, repo} = github.context.repo
  if (comment_id && body) {
    await octokit.issues.updateComment({owner, repo, comment_id, body})
  } else if (issue_number && (title || body)) {
    await octokit.issues.update({owner, repo, issue_number, title, body})
  }

  const issue_url = github.context.payload.issue?.html_url
  if (title) {
    core.info(
      `complete to modify translate issue title: ${title} in ${issue_url} `
    )
  }

  if (body) {
    core.info(
      `complete to modify translate issue body: ${body} in ${issue_url} `
    )
  }
}
