# 在 EdgePress 中安装和使用 RepoRelay

RepoRelay 提供 GitHub App 后端，EdgePress 提供评论区域、隐私选择、头像、表情包面板和删除本人评论的界面。代码可以独立开源部署；每位部署者使用自己的 App 和回调地址。

## 1. 安装

使用 Node.js 22.12 或以上版本。在 EdgePress 项目目录执行并提交 lockfile：

```sh
npm install github:jsw-teams/RepoRelay#202610.3
```

使用支持页面 `comments` 区块和表情包面板的 EdgePress 版本（202610.4 或更新）。源码安装时同样固定标签或提交。

## 2. 创建自己的 GitHub App

GitHub Settings → Developer settings → GitHub Apps → New GitHub App：

- Homepage URL：你自己的站点，例如 `https://blog.example.com`。
- Redirect URI：`https://blog.example.com/api/comments/callback`。关闭通配符。
- 关闭 Webhook、Device Flow 和安装时请求用户授权。读者在网站主动登录时授权。
- Repository permissions：Metadata Read、Issues Read and write、Contents Read and write。
- 仅安装到评论存储仓库，仓库需开启 Issues 并至少有一次提交。
- 记录 App ID 和 Client ID；生成 Client Secret 和完整 PEM 私钥。

开源源码仓库与评论存储仓库可以不同。私有仓库需要由你的 App 安装令牌访问，不向浏览器公开令牌。

## 3. Worker 配置

在现有 `wrangler.jsonc` 合并以下配置。保留站点原有路由、入口和其他功能。`assets.directory` 指向构建输出。

```jsonc
{
  "name": "my-blog",
  "main": "worker.js",
  "compatibility_date": "2026-10-03",
  "vars": {
    "REPORELAY_REPOSITORY": "YOUR_ACCOUNT/YOUR_COMMENT_REPOSITORY",
    "REPORELAY_SITE_ORIGIN": "https://blog.example.com",
    "REPORELAY_GITHUB_APP_ID": "YOUR_APP_ID",
    "REPORELAY_GITHUB_APP_CLIENT_ID": "YOUR_CLIENT_ID"
  },
  "assets": {
    "directory": "dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "durable_objects": {
    "bindings": [{"name":"REPORELAY_THREADS","class_name":"CommentCoordinator"}]
  },
  "migrations": [{"tag":"reporelay-threads","new_sqlite_classes":["CommentCoordinator"]}]
}
```

已执行过此 Durable Object migration 的项目保留原条目，不重复创建或改名。服务端入口：

```js
import {handleCommentRequest} from '@jsw-teams/reporelay';
export {CommentCoordinator} from '@jsw-teams/reporelay';
export default {
  async fetch(request, env) {
    const comments = await handleCommentRequest(request, env);
    if (comments) return comments;
    // 在此保留应用原有的其他 API 路由。
    return env.ASSETS.fetch(request);
  }
};
```

使用 Cloudflare Worker → Settings → Variables and Secrets，或以下命令，保存两个 Secret：

```sh
npx wrangler secret put REPORELAY_GITHUB_APP_PRIVATE_KEY
npx wrangler secret put REPORELAY_GITHUB_APP_CLIENT_SECRET
```

私钥粘贴完整 PEM（包括头尾和换行）。无需填写安装 ID、机器人登录名或自行生成签名 Secret；RepoRelay 自动发现安装，并在 Durable Object 中持久保存签名密钥。已有显式签名 Secret 保持原值，避免正式评论失去验证能力。

## 4. 在 config.yml 开启可选评论

启用可信构建插件 `plugins/consent/index.js`（在 `edgepress.config.mjs` 的 `plugins` 中）。在 `config.yml` 原有 consent 配置内合并：

```yaml
plugins:
  consent:
    enabled: true
    proposedDate: "2026-10-03"
    effectiveDate: "2026-10-03"
    expiresDays: 180
    comments:
      enabled: true
      services:
        - id: github-comments
          provider: github-comments
          name: GitHub comments
          purpose: Load discussions after opt-in and authorize comments with GitHub.
          dataCategories: GitHub account ID, login, avatar, comments and images.
          recipient: GitHub and your Cloudflare Worker.
          retention: Comments remain until deleted; sessions expire after 24 hours.
          privacyUrl: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
privacy:
  controller:
    name: YOUR_NAME
    contact: YOUR_CONTACT
  policyUrl: /privacy/
site:
  timeZone: Asia/Taipei
```

文章自动显示评论区域。页面需要在 front matter 的 `blocks` 中明确添加：

```yaml
blocks:
  - columns: 1
    cells:
      - - type: comments
```

每个页面最多一个评论区。页面 thread 为 `page:<页面文件夹>`，文章 thread 保持文章文件夹名；同一内容的各语言共享讨论。EdgePress 从正式发布的内容生成 `/edgepress/comment-threads.json`，不接受访客任意指定的 thread。

站点未启用评论时不显示区域，也不加载评论脚本。启用后仍需读者选中评论服务，才加载评论、会话和头像；表情包图集在读者打开面板时加载。GitHub 登录为独立的主动操作。

## 5. 表情包和头像

内置两个本地 Noto Emoji 图片图集，共 24 张 PNG，保留 Apache 2.0 许可证与来源。选择图片后通过与上传附件相同的验证流程，支持仅发图片的评论。上传图片与选择表情包分别提供按钮。

自行扩展 `content/assets/edgepress/stickers/packs.json`，并把有使用权限的 PNG/JPEG/GIF/WebP/AVIF 放在同一资源目录：

```json
{"packs":[{"id":"my-pack","label":{"en":"My stickers","zh-SG":"我的表情包"},"items":[
  {"label":{"en":"Hello","zh-SG":"你好"},"src":"/edgepress/stickers/my-pack/hello.gif"}
]}]}
```

不用第三方 CDN。每包最多展示 100 张图片；每条评论最多四张，每张最多五百万字节。图片选择与上传均需登录，服务端只接受与当前用户、页面绑定的有效上传凭据。

头像以验证过的 GitHub 用户 ID 获取，由同源 `/api/comments/avatar/<id>` 代理，不把访问者 Cookie 或仓库凭据发送给头像服务。头像暂时无法读取时显示首字母。

## 6. 删除和数据生命周期

登录后本人评论显示删除按钮，需要在界面再次确认。服务端校验同源请求、CSRF、GitHub 用户 ID、签名身份和实际 Issue 归属，不能通过显示名称删除他人评论。关闭或锁定讨论后仍可删除本人评论；删除不创建替代 Issue，也不重新发布评论。

删除评论不自动删除已上传图片及 GitHub 历史；公开图片缓存也可能继续存在。隐私政策需如实说明这一点。图片彻底清理需站长另行处理存储与缓存。

正式评论沿用数据格式 1，新增头像和删除能力不重写历史数据。旧测试格式不读取、旧 Issues 保留隔离。未来不兼容变化应提供明确迁移；无法保留真实身份的数据不能冒充作者重新发表，未迁移数据继续隔离。

## 7. 多个网站和部署验证

同一拥有者可复用 App：每个域名独立部署 Worker，分别设置精确 `REPORELAY_SITE_ORIGIN`，并在 GitHub App 登记各自 `/api/comments/callback`。GitHub 最多接受 10 个回调地址；更多站点需要另一个 App。不同站点可使用同一评论仓库，但讨论、会话和签名密钥按来源域名与仓库隔离。更换来源或仓库等同切换项目，应提前安排数据迁移。

`js.gripe` 与 `connect.js.gripe` 各自使用 Worker `web`、`connect`，各自回调，不把第三方实例指向本站。connect 的隐私政策统一链接主站 `https://js.gripe/zh-SG/privacy/`。

```sh
npm run build
npx wrangler deploy
```

检查未选中评论时没有 `/api/comments` 请求，选中后能读取、登录、选择图片、发表和删除本人评论；换一个用户确认不能删除他人评论。已有生产环境保留 Durable Object 和签名密钥。
