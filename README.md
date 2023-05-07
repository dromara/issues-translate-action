![](./assets/logo.svg)
# GitHub Translate Action

En | [中文](./README_CN.md)

A GitHub Action to translate non-English GitHub issues and GitHub discussions into English automatically.

## Input variables

See [action.yml](./action.yml) for more details.

- `IS_MODIFY_TITLE`: whether to translate the title, the default is no. The default is to directly modify the title. When `APPEND_TRANSLATION` is true, the translation result will be appended to the original title.
- `APPEND_TRANSLATION`: whether to append translation content, the default is no. By default, this Action will append the translated content as a new reply to the issue/discussion. When this item is true, the original content is modified and the translation result is appended, so that no notification is generated and the user is not disturbed.
- `CUSTOM_BOT_NOTE`: When `APPEND_TRANSLATION` is false, a machine translation description tag will be added to the translated content, and you can customize this description.

## Usage

````yml
name: 'translator'
on:
   issues:
     types: [opened, edited]
   issue_comment:
     types: [created, edited]
   discussion:
     types: [created, edited]
   discussion_comment:
     types: [created, edited]

jobs:
   translate:
     permissions:
       issues: write
       discussions: write
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v3
       - uses: lizheming/github-translate-action
         env:
           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
         with:
           IS_MODIFY_TITLE: true
           APPEND_TRANSLATION: true
````

## Thanks

This project is forked from [dromara/issues-translate-action](https://github.com/dromara/issues-translate-action), thanks to the original author for his work. Due to the large modification of the upstream project, such as:

- Add translation support for GitHub discussion
- Added non-intrusive translation actions for additional translation content
- Replace custom GitHub Token process with GitHub Action Token
- Refactored project

It is almost equivalent to a new project, so there is no consideration of merging the changes upstream and using it as a separate project.