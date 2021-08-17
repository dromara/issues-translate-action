
# Issues Translate Action  

将非英文issue实时翻译成英文issue的action。     


## 快速使用    

> 使用默认的机器人账户 @Issues-translate-bot  

#### 创建一个github action     
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
      - uses: tomsun28/issues-translate-action@v2.6
        with:
          IS_MODIFY_TITLE: false
          # 非必须，决定是否需要修改issue标题内容   
          # 若是true，则机器人账户@Issues-translate-bot必须拥有修改此仓库issue权限。可以通过邀请@Issues-translate-bot加入仓库协作者实现。
          CUSTOM_BOT_NOTE: Bot detected the issue body's language is not English, translate it automatically. 👯👭🏻🧑‍🤝‍🧑👫🧑🏿‍🤝‍🧑🏻👩🏾‍🤝‍👨🏿👬🏿
          # 非必须，自定义机器人翻译的前缀开始内容。  
````


## 高级自定义       

> 通过配置BOT_GITHUB_TOKEN使用自定义的机器人账户   
> 

1. 创建一个github账户作为您的机器人账户   

2. 使用此账户生成对应的token作为BOT_GITHUB_TOKEN      

3. 将BOT_GITHUB_TOKEN = ${token} 作为Secrets BOT_GITHUB_TOKEN = ${token} 配置到您的仓库中

4. 创建一个下面的github action(在仓库的 .github/workflows/ 下创建 issue-translator.yml 如下)         

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
      - uses: tomsun28/issues-translate-action@v2.6
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.BOT_GITHUB_TOKEN }} 
          # 非必须，填写您的机器人github账户token
          BOT_LOGIN_NAME: Issues-translate-bot    
          # 非必须，建议不填写，机器人名称会根据token获取到，若填写，请一定与token对应的github账户名相同
````


## 其它       

1. 如何邀请@Issues-translate-bot加入仓库协作者    
Project -> Settings -> Manage access -> Invite a collaborator   
在[issues-translate-action](https://github.com/tomsun28/issues-translate-action)创建一个issue告知，之后@Issues-translate-bot会加入您的仓库        

## DEMO  

![action-sample](dist/action-sample.png)   

**Have Fun!**  





