# EdgePress 接入

评论前端和后端全部由本项目负责。EdgePress 与网站只保留静态页面、通用服务插槽和 consent。先独立部署本项目，再填写真实服务地址；网站不安装评论 npm 包，也不配置 GitHub App Secret。

在网站 config.yml 的 plugins.consent.services 注册服务：

```yaml
plugins:
  consent:
    enabled: true
    proposedDate: "2026-10-03"
    effectiveDate: "2026-10-03"
    expiresDays: 180
    services:
      - id: github-comments
        provider: external-widget
        name: iask
        purpose: 经访客选择后加载讨论并允许使用 GitHub 登录评论。
        dataCategories: GitHub 用户 ID、账号、头像、评论及附件，以及服务请求的网络信息。
        recipient: 网站运营者与 GitHub
        retention: 评论保留至删除；会话一天；上传的源文件需另行删除。
        privacyUrl: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
        backendUrl: https://comments.example.com
        moduleUrl: https://comments.example.com/commentnest/widget.js
        placement: posts
```

替换 example 地址，填写真实 `privacy.controller` 及 `privacy.policyUrl`。多语言网站可将服务说明写成覆盖所有已启用语言的映射。`placement: posts` 给文章添加插槽；页面在 front matter 中显式添加：

```yaml
blocks:
  - columns: 1
    cells:
      - - type: service
          integration: github-comments
```

构建生成 `/edgepress/service-contexts.json`，内容为已发布文章及带服务插槽的页面的 `{thread,title}` 数组。不同语言共享稳定的 bundle 标识。服务只从配置的网站来源读取这份 allowlist，拒绝未知或草稿讨论。旧的 `comments` 区块、`plugins.consent.comments`、网站同域 `/api/comments` 和评论包依赖已移除。

其他建站工具也应在明确 consent 后从服务导入 `/commentnest/widget.js`，调用 `mount(root,{backendUrl,thread,title})`，并在构建时发布同格式 allowlist。不要无条件加载 iframe、脚本、preconnect 或 GitHub 请求。变更服务地址或模块地址会使网站已保存的 consent 失效，需要访客重新选择。

服务的 OAuth 回调始终登记在评论服务来源，例如 `https://comments.example.com/api/comments/callback`。网站静态部署平台与评论服务平台可以不同。
