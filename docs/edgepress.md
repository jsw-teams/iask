# CommentNest · 评巢：安装与接入 EdgePress

CommentNest 负责评论界面、样式、翻译、GitHub 登录、头像、表情包、上传和删除本人评论。EdgePress 只提供文章或页面信息、后端 URL，以及加载前的隐私选择。网站主题不会影响评论内部布局。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jsw-teams/CommentNest)

按钮将开源仓库复制到你的 GitHub 账户并创建 Worker。填写自己的站点、服务地址及 App 信息；创建和安装 GitHub App 仍由你在 GitHub 完成。示例域名不能作为正式配置。

## 创建自己的 GitHub App

在你的 GitHub 账户或组织创建 App。名称自定，Homepage URL 填自己的项目或网站地址。Redirect URI 填评论服务的精确地址，例如 `https://comments.example.com/api/comments/callback`。关闭通配符回调、Webhook 和 Device Flow。访客点击登录后才授权公开身份，安装时无需强制所有访客授权。

仓库权限：Metadata 只读，Issues 读写，Contents 读写。安装到评论存储仓库，启用 Issues，保留至少一个提交。生成 Client Secret 和 PEM 私钥。安装 ID、机器人用户名和签名随机字符串无需手工填写。

## 配置 Worker

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| 变量 | `COMMENTNEST_SITE_ORIGIN` | 评论服务的精确 HTTPS 来源地址 |
| 变量 | `COMMENTNEST_WEBSITE_ORIGIN` | 加载评论的网站的精确 HTTPS 来源地址 |
| 变量 | `COMMENTNEST_REPOSITORY` | 自己的 `owner/repository` |
| 变量 | `COMMENTNEST_GITHUB_APP_ID` | App ID |
| 变量 | `COMMENTNEST_GITHUB_APP_CLIENT_ID` | Client ID |
| Secret | `COMMENTNEST_GITHUB_APP_PRIVATE_KEY` | 完整 PEM 私钥，包含首尾行和真实换行 |
| Secret | `COMMENTNEST_GITHUB_APP_CLIENT_SECRET` | Client Secret |

来源地址只有协议和主机，不带子路径、查询参数或锚点。回调由服务地址生成，不写死为项目作者的域名。模板包含 `COMMENTNEST_THREADS` Durable Object；签名密钥首次使用时生成并保存，升级时必须保留命名空间。

本地开发需要 Node.js 22.12 以上：`npm ci`、`npm test`、`npm run build`。复制 `.dev.vars.example` 为 `.dev.vars`，填写自己的 Secret，此文件不会提交到 Git。部署运行 `npm run deploy`。

## 在 EdgePress 中接入

在 `config.yml` 的已有 consent 下增加评论服务，并填写管理者与隐私政策。下例为单语言配置，多语言站点使用站点的语言键提供披露文案。

```yaml
privacy:
  controller:
    name: Your site operator
    contact: privacy@example.com
  policyUrl: /privacy/
plugins:
  consent:
    enabled: true
    proposedDate: 2026-10-03
    effectiveDate: 2026-10-03
    expiresDays: 180
    comments:
      enabled: true
      services:
        - id: discussion
          provider: commentnest
          backendUrl: https://comments.example.com
          name: CommentNest · 评巢
          purpose: Load discussions and sign in to comment after opting in.
          dataCategories: GitHub identity, avatar, comments and attachments.
          recipient: Your site operator and GitHub, Inc.
          retention: Comments remain until deleted; sessions last one day.
          privacyUrl: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
```

保留其他 consent 分类的已有配置。唯一的服务接入参数是 `backendUrl`；其余字段是隐私披露，不是 App 凭据。使用独立服务时，EdgePress 无需安装评论包，无需复制评论脚本、CSS、语言包或表情包。未选择评论时，不加载 CommentNest 脚本、iframe、API 或图片；关闭后刷新页面以停止加载。

隐私选择默认保存在 localStorage。本地存储受限时，使用必要偏好 Cookie 和 sessionStorage 回退。名称、翻译及界面调整不使选择失效；新增服务、更换后端地址、修改凭据或更新告知日期需要重新选择。用途、数据范围或接收方实质变化时，管理者应同步更新 consent 日期。

## 文章和页面

开启后文章自动显示评论区域。页面按需添加 `comments` 块，每页最多一个；未开启时省略区域。

```yaml
blocks:
  - columns: 1
    cells:
      - - type: comments
```

EdgePress 自动生成 `/edgepress/comment-threads.json`，独立服务从配置的网站地址获取发布清单。文章使用稳定内容目录 ID，页面使用 `page:<内容目录 ID>`，翻译共用讨论，访客不能创建未知线程。

## 多个网站

每个网站部署一个 CommentNest 实例，分别配置网站、服务、仓库及 Durable Object。可以共用自己拥有的 App，但需在 GitHub 登记每个实例的精确回调地址。不同实例的签名和讨论隔离；其他部署者注册自己的 App，不依赖你的 Worker 或域名。

服务可以同域或跨域。跨域登录在服务弹窗中完成，签名会话仅交给同源评论 iframe。GitHub 访问令牌不会交给页面或存入浏览器。浏览器完全禁止服务存储时，当前页面仍可登录，但刷新后可能需要再次登录；登录状态与网站隐私偏好是独立状态。

## 已有同域站点

已有 Worker 持有正式评论及 App Secrets 时，站点部署入口可调用包的 `handleServiceRequest` 并导出 `CommentCoordinator`。框架只配置 URL，站点的组合层托管独立服务。构建后运行 `commentnest assets dist`，资源来自 CommentNest 包，内容目录不维护副本。

保留原 Durable Object、签名密钥及正式格式，无需重发评论。旧测试 Issues 保留隔离，既不显示，也不冒用原作者重新发表。

## 表情包、删除与更新

表情包是可选择的本地图集，和文件上传按钮分开，打开面板后才读取图库。编辑 CommentNest 的 `content/assets/commentnest/stickers/packs.json`，添加有授权的图片或 GIF，并保留授权资料。

登录原账户后可确认删除自己的评论，关闭或锁定讨论仍可删除本人评论。不能删除其他人的评论。附件仅在有效的已发表评论引用时提供访问。删除评论或 Issue 后停止提供访问，不设置长期缓存；底层文件需要另行移除。

## 目录与成本控制

`backend/` 保存全部后端逻辑；`static/commentnest/` 保存界面、样式、翻译和交互；`content/assets/commentnest/stickers/` 是表情资源及目录的唯一来源。EdgePress 在允许评论后按后端 URL 加载组件并提供文章标识，不维护评论编辑器或样式。

保留 DO。未同意时不请求评论，组件不轮询；图库打开后才加载。构建给脚本、样式、图集和表情图片生成内容指纹，可长期缓存；入口脚本 60 秒后重新验证。头像缓存一天，签名密钥在 Worker 内存中复用五分钟并合并并发读取，持久化密钥仍保存在 DO 中。附件响应不公开缓存，文件内容内部缓存五分钟，但每次先检查 Issue 及已签名评论是否仍有效，删除后不能从该缓存继续访问。

缓存会被淘汰且按数据中心分别保存，不能保证所有请求命中，也不是消费上限。请查看账户用量、设置适合计划的 CPU 限制与账单通知；正式升级保留 DO 命名空间、密钥和原始数据。

更新记录见 [CHANGELOG.md](../CHANGELOG.md)，数据规则见 [生命周期说明](lifecycle.md)。后续保留正式评论；格式确实无法继续支持时需要明确迁移路径，未迁移数据保持隔离，不能冒充作者重新发表。
