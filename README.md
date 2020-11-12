
# Issues Translate Action  

The action for translating non-English issues comment content to English.   


## Usage  

#### Create a workflow from this action   

````
name: 'issue-comment-translator'
on: # only support issue_comment
  issue_comment:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: tomsun28/issues-translate-action@v1
        with:
          BOT_GITHUB_TOKEN: ${{ secrets.BOT_GITHUB_TOKEN }} # required, input your bot github token
          # BOT_LOGIN_NAME: nameValue - not required, suggest not input, action will get name from BOT_GITHUB_TOKEN
          

````

####  Create an issues comment and test    


**Have Fun!**  





