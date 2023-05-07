import * as core from '@actions/core'
import * as github from '@actions/github'


interface UpdateDiscussionParams {
  discussion_number?: number
  comment_id?: number
  body?: string
  title?: string
  octokit: ReturnType<typeof github.getOctokit>
}

export async function updateDiscussion({
  discussion_number: discussionId,
  comment_id: commentId,
  body,
  title,
  octokit,
}: UpdateDiscussionParams) {

  const mutation = commentId ? `mutation($commentId: ID!, $body: String!) {
    updateDiscussionComment(input: {commentId: $commentId, body: $body}) {
      discussionComment {
        body
      }
    }
  }` : `mutation($discussionId: ID!, $body: String!, $title: String!, ) {
    updateDiscussion(input: {discussionId: $discussionId, title: $title, body: $body}) {
      discussion {
        title
        body
      }
    }
  }`

  await octokit.graphql({
    query: mutation,
    discussionId,
    commentId,
    body,
    title
  })


  const url = github.context.payload?.discussion?.html_url;
  if (title) {
    core.info(`complete to modify translate discussion title: ${title} in ${url} `)
  }

  if (body) {
    core.info(`complete to modify translate discussion body: ${body} in ${url} `)
  }
}