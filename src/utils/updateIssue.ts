import * as core from '@actions/core'
import * as github from '@actions/github'
import { updateDiscussion } from './updateDiscussion'

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
  if (discussion_number) {
    return updateDiscussion({
      discussion_number,
      comment_id,
      title,
      body,
      octokit,
    });
  }

  const {owner, repo} = github.context.repo

  if (issue_number) {
    if (comment_id && body) {
      await octokit.issues.updateComment({owner, repo, comment_id, body})
    } else if (title || body) {
      await octokit.issues.update({owner, repo, issue_number, title, body})
    }
  }

  const url = github.context.payload.issue?.html_url
  if (title) {
    core.info(`complete to modify translate issue title: ${title} in ${url} `)
  }

  if (body) {
    core.info(`complete to modify translate issue body: ${body} in ${url} `)
  }
}
