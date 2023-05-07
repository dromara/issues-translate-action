![](./assets/logo.svg)
# GitHub Translate Action  

将非英文的 GitHub issue 和 GitHub discussion 自动翻译成英文的 GitHub Action。

## 配置项

查看 [action.yml](./action.yml) 了解更多详细信息。

- `IS_MODIFY_TITLE`: 是否翻译标题，默认为否。默认是直接修改标题，在 `APPEND_TRANSLATION` 为真的情况下会在原始标题后追加翻译结果。
- `APPEND_TRANSLATION`: 是否追加翻译内容，默认为否。该 Action 默认会将翻译内容以新回复的形式追加到 issue/discussion 中。当该项为真时，则是修改原始内容追加翻译结果，这样不产生通知不打扰用户。
- `CUSTOM_BOT_NOTE`: 在 `APPEND_TRANSLATION` 为假时，翻译内容会增加一段机器翻译描述标记，你可以自定义这段描述内容。

## 使用示例

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

## 鸣谢

本项目 Fork 自[dromara/issues-translate-action](https://github.com/dromara/issues-translate-action)，非常感谢原作者的工作。由于对原项目的改造比较巨大，包括但不限于：

- 增加 GitHub discussion 的翻译支持
- 增加追加翻译内容无侵扰翻译动作
- 使用 GitHub Action Token 替换自定义 Token 流程
- 重构项目拆分代码

几乎相当于一个新的项目了，所以没有考虑将修改合并到上游而是作为独立项目使用。

