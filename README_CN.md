# Issues Translate Action  

将非英文issue实时翻译成英文issue的action。     


## 快速使用    

每次运行都必须提供 GitHub token。请传入 `secrets.GITHUB_TOKEN`，或使用自定义机器人 Secret。此 action 不内置任何机器人凭据。

只有在设置了 `github-token` 时，才可以不填 `BOT_GITHUB_TOKEN`。`github-token` 的默认值是 `${{ github.token }}`，也就是工作流的 `GITHUB_TOKEN`。

#### 创建一个 GitHub Action     
> 在仓库的 .github/workflows/ 下创建 issue-translator.yml 如下:   

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
      - uses: usthe/issues-translate-action@v2.8
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # 必填，除非另行设置 github-token。secrets.GITHUB_TOKEN 会以 github-actions[bot] 的身份评论。
          # 等价写法：github-token: ${{ github.token }}
          IS_MODIFY_TITLE: false
          # 非必须，默认 false。决定是否修改 issue 标题。
          # 若为 true，该 token 必须拥有修改本仓库 issue 的权限。
          CUSTOM_BOT_NOTE: Bot detected the issue body's language is not English, translate it automatically. 👯👭🏻🧑‍🤝‍🧑👫🧑🏿‍🤝‍🧑🏻👩🏾‍🤝‍👨🏿👬🏿
          # 非必须，自定义机器人翻译的前缀开始内容。  
````


## 高级自定义       

> 通过 BOT_GITHUB_TOKEN 使用自定义机器人账户。  
> 请把 token 存在仓库 Secrets 中，不要把 token 提交到代码库。

1. 创建一个 GitHub 账户作为您的机器人账户   

2. 为该账户生成 token，并保存为仓库 Secret，名称是 BOT_GITHUB_TOKEN      

3. 创建一个下面的 GitHub Action（在仓库的 .github/workflows/ 下创建 issue-translator.yml 如下）         

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
      - uses: usthe/issues-translate-action@v2.8
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.BOT_GITHUB_TOKEN }} 
          # 使用自定义机器人时必填。该 token 需要有在本仓库评论 issue 的权限。
          BOT_LOGIN_NAME: your-bot-login    
          # 非必须。不填写时，action 会根据 token 读取登录名。
          # 若填写，必须与 token 对应的 GitHub 账户名相同。
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





