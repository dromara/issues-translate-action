# Issues Translate Action  

The action for translating Non-English issues content to English.   

[中文文档](README_CN.md)   

## Usage  

A GitHub token is required on every run. Pass `secrets.GITHUB_TOKEN` or a custom bot secret. This action does not include a built-in bot credential.

`BOT_GITHUB_TOKEN` can be omitted only when `github-token` is set. That input defaults to `${{ github.token }}`, which is the workflow `GITHUB_TOKEN`.

#### Create a workflow from this action   

> Create file issue-translator.yml in .github/workflows/     

````
name: 'issue-translator'
on: 
  issue_comment: 
    types: [created]
  issues: 
    types: [opened]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: usthe/issues-translate-action@v2.7
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Required unless github-token is set. secrets.GITHUB_TOKEN comments as github-actions[bot].
          # Equivalent: github-token: ${{ github.token }}
          IS_MODIFY_TITLE: false
          # Optional, default false. Decide whether to modify the issue title.
          # If true, the token must be allowed to edit issues in this repository.
          CUSTOM_BOT_NOTE: Bot detected the issue body's language is not English, translate it automatically. 👯👭🏻🧑‍🤝‍🧑👫🧑🏿‍🤝‍🧑🏻👩🏾‍🤝‍👨🏿👬🏿
          # Optional. Customize the translation robot prefix message.
````


## Advanced Custom   

> Use your own bot account by passing its token as BOT_GITHUB_TOKEN.  
> Store the token in repository secrets. Never commit a token.

1. Create a new GitHub account as your bot  

2. Generate a token for that account and store it as a repository secret named BOT_GITHUB_TOKEN  

3. Create a workflow from this action (Create file issue-translator.yml in .github/workflows/)    

````
name: 'issue-translator'
on: 
  issue_comment: 
    types: [created]
  issues: 
    types: [opened]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: usthe/issues-translate-action@v2.7
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.BOT_GITHUB_TOKEN }} 
          # Required for a custom bot. The token must be allowed to comment on issues in this repository.
          BOT_LOGIN_NAME: your-bot-login    
          # Optional. When omitted, the action reads the login from the token.
          # If set, the login must match the account that owns the token.
````

## DEMO  

![action-sample](dist/action-sample.png)   

## Who Use the Action?  

1. [hertzbeat](https://github.com/dromara/hertzbeat) **Create By Us** - A real-time monitoring system with custom-monitor and agentless.
2. [sureness](https://github.com/dromara/sureness) **Create By Us** - A simple and efficient security framework that focus on protection of API.
3. [go-zero](https://github.com/zeromicro/go-zero) - A cloud-native Go microservices framework with cli tool for productivity.
4. [dashy](https://github.com/Lissy93/dashy) - A self-hostable personal dashboard built for you.
5. [wails](https://github.com/wailsapp/wails) - Create beautiful applications using Go
6. [seata-go](https://github.com/seata/seata-go) - Go Implementation For Seata
7. [rainbond](https://github.com/goodrain/rainbond) - Cloud native multi cloud application management platform
8. [adempiere](https://github.com/adempiere/adempiere) - ADempiere Business Suite done the Bazaar way in an open and unabated fashion.
9. [carbon](https://github.com/golang-module/carbon) - A simple, semantic and developer-friendly golang package for datetime
10. [tabby](https://github.com/Eugeny/tabby) - A terminal for a more modern age
11. [gorse](https://github.com/gorse-io/gorse) - An open source recommender system service written in Go

**Have Fun!**  


## Contributors ✨ 

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center"><a href="http://hertzbeat.com"><img src="https://avatars.githubusercontent.com/u/24788200?v=4?s=100" width="100px;" alt="tomsun28"/><br /><sub><b>tomsun28</b></sub></a><br /><a href="https://github.com/usthe/issues-translate-action/commits?author=tomsun28" title="Code">💻</a> <a href="#content-tomsun28" title="Content">🖋</a></td>
      <td align="center"><a href="https://allcontributors.org"><img src="https://avatars.githubusercontent.com/u/46410174?v=4?s=100" width="100px;" alt="All Contributors"/><br /><sub><b>All Contributors</b></sub></a><br /><a href="https://github.com/usthe/issues-translate-action/commits?author=all-contributors" title="Documentation">📖</a></td>
      <td align="center"><a href="https://dev.to/chenquan"><img src="https://avatars.githubusercontent.com/u/20548053?v=4?s=100" width="100px;" alt="chen quan"/><br /><sub><b>chen quan</b></sub></a><br /><a href="https://github.com/usthe/issues-translate-action/commits?author=chenquan" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
