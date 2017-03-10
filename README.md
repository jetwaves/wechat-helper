# wechat-helper
a wechat helper for wechat authentication and wechat pay integration in nodejs expressjs

--
提示：

这个模块目前的建议用法是作为expressjs的中间件来使用。
把 vhost.hostname.com/wx/api 路径下的所有请求交给 index.js 中定义的  wechat-helper 来处理。
类似于
var wechat-helper = require('wechat-helper');
app.all('/wx/api', wechat-helper);


目前能够做的：
1. 响应启用微信开发者模式的URL访问   =>   vhost.hostname.com/wx/api
2. 生成微信内分享或点击后，跳转去公众号，授权并获取信息的URL的小工具  vhost.hostname.com/wx/api/makeQRUrl
3. 用户从2中URL跳转到公众号并授权后，接收code并获取用户信息          vhost.hostname.com/wx/api/shop
3.1.  这里可以配置  WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT 来在从中间件跳转回自己的路由。
3.2.  用户的accessToken和用户详细信息可以成功取得，存储和应用方式由调用者自行决定和实现
3.2.1    位置在 ：  router.getUserDetailInfo().then(info)   的info里面
3.3   授权完成后，用户的基本信息  openId 存在了  req.session.user_open_id 里面，在调用者自己的系统里面可以很方便的取得
4. 获取系统AccessToken，并存入了内存缓存 CACHE_SYSTEM_ACCESS_TOKEN
4.1.   系统AccessToken 是程序代码访问某些微信API时候需要的token
4.2.   各种token都存入了缓存，过期时间都是7190秒，缓存失效后 wechat-helper 模块会自动刷新这些token，保证缓存中总有可用的token
4.3.   需要使用其他方式缓存比如mongodb或redis保存token的，自个去用cacheman的插件配置一下
5. 获取 JsApiTicket，并存入内存缓存 CACHE_WECHAT_JS_TICKET
5.1.   JsApiTicket 是网页端使用ajax调用微信API必备的鉴权token
6. 使用一个假订单信息访问微信API并生成 prepayId
7. 使用网页而配置和支付配置渲染一个测试页面，并且在测试页面唤起微信支付，支付一分钱
7.1.    测试页面路由              vhost.hostname.com/wx/api/testPayPage
7.2.    测试页面模板(ejs 模板)    view/testPayPage.html
8. 支付成功后接收微信服务器的信息回调
8.1.     回调路由                  vhost.hostname.com/wx/api/getNotify
8.2.     回调失败后的处理，以及回调成功之后的业务逻辑由调用者自行实现


注意：
1. wechat-helper需要一个配置文件  wechat-helper-config.js，内容参照 wechat-helper-config.exemple.js
1.1.   这个文件所在位置 必须 存在于 wechat-helper的index.js 所在目录的三级以内的上层目录中
1.2.   想把配置文件放在别的地方或者需要更深的查找层数就自个去改代码   lib/util.js    findConfigFullName()
2.

