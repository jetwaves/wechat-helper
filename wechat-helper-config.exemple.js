var wechatConfig = {
    // 以下是微信公众号相关参数
    WECHAT_TOKEN                            : 'TOKEN****************',          // 公众号后台设置
    WECHAT_APP_ID                           : 'wxa__APP_ID',                    // 公众号后台设置
    WECHAT_APP_SECRET                       : 'aaa__APP_SECRET',                // 公众号后台设置
    WECHAT_REDIRECT_URL                     : 'http://wxtest.yourDomain.com/wx/api/shop',           // 打开微信连接后跳转去的网页URL(用于获取code)
    WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT : 'http://wxtest.yourDomain.com/wx/api/testPayPage',    // 获取code以后跳转去的网页URL

    // 以下是微信支付相关参数
    WECHAT_PAY_MERCHANT_ID                  : '1231331902',
    WECHAT_PAY_SUCCES_NOTIFY_URL            : 'http://wxtest.yourDomain.com/wx/api/getNotify',      // 自己配置的回调网址
    WECHAT_PAY_API_KEY                      : 'WECHAT_PAY_API_KEY'                                  // 去微信商户后台找
};


module.exports = wechatConfig;