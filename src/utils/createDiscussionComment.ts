import * as core from '@actions/core'
import * as github from '@actions/github'


interface UpdateDiscussionParams {
  discussion_number: number
  body?: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function createDiscussionComment({
  discussion_number: discussionId,
  body,
  octokit,
}: UpdateDiscussionParams) {

  const mutation = `mutation($discussionId: ID!, $body: String) {
    addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
      comment {
        body
      }
    }
  }`

  await octokit.graphql({
    query: mutation,
    discussionId,
    body,
  })

  const url = github.context.payload?.discussion?.html_url
  core.info(`complete to push translate discussion comment: ${body} in ${url} `)
}