/**
 * Created by jetwaves on 17-3-10.
 */
var _ = require('lodash');
var os = require('os');
var fs = require('fs');
var async = require('async');
var http = require('http');
var qs = require('querystring');
var sha1 = require('sha1');
var Promise = require('promise');
var path = require('path');
var JSON = require('json-bigint')({"storeAsString": true});
var cacheman = require('cacheman');
var cache = new cacheman();
var util = require('./lib/util.js');

var express = require('express');
var router = express.Router();

var wechatPayLib = require('./lib/wechat-pay-payment').Payment;        // 来自于  https://github.com/supersheep/wechat-pay
var wechatPay;              // 初始化以后用来执行支付的对象


var fullConfigName = util.findConfigFullName();
console.log('           fullConfigName  = ');  console.dir(fullConfigName);
if(fullConfigName == false){
    throw new Error(' can not find configuration file :  wechat-helper-config.js  ');
}
var wechatConfig = require(fullConfigName);

// =============================== 微信公众号相关参数 =========================================
//              来自配置文件
var WECHAT_TOKEN                    = wechatConfig.WECHAT_TOKEN;
var WECHAT_APP_ID                   = wechatConfig.WECHAT_APP_ID;
var WECHAT_APP_SECRET               = wechatConfig.WECHAT_APP_SECRET;
var WECHAT_REDIRECT_URL             = wechatConfig.WECHAT_REDIRECT_URL;
var WECHAT_PAY_MERCHANT_ID          = wechatConfig.WECHAT_PAY_MERCHANT_ID;
var WECHAT_PAY_SUCCES_NOTIFY_URL    = wechatConfig.WECHAT_PAY_SUCCES_NOTIFY_URL;
var WECHAT_PAY_API_KEY              = wechatConfig.WECHAT_PAY_API_KEY;

//  微信用户在网页授权，获取到state后，从本插件跳转到用户系统的目标URL
//      1. 此时
//          用户的openId                     已经写入                     req.session.user_open_id
//          授权入口链接带的state参数         会变成url参数，拼接在网址上，  发送给目标url
//              state参数格式 (key1:val1;key2val2)
//                                           url参数格式：  ?key1=val1&key2=val2&key3=val3
//                                                                         目标url变成   http://targeturl.com/uri/uri2?key1=val1&key2=val2...
//      2. 插件用户应当去下面的路由中实现自己的业务逻辑，比如根据state参数跳转入不同页面
var WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT = wechatConfig.WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT;

//var USER_GRANT_SCOPE                  = 'snsapi_base';
var USER_GRANT_SCOPE                    = 'snsapi_userinfo';
var WECHAT_GRANT_PARAM_STATE            = 'CustomWechatState';
var WECHAT_SYS_ACCESS_TOKEN_PLACE_HOLDER= 'SystemAccessToken';
var USER_AUTH_CODE_PLACE_HOLDER         = 'USER_AUTH_CODE';
var USER_ACCESS_TOKEN_PLACE_HOLDER      = 'USER_ACCESS_TOKEN';
var USER_OPEN_ID_PLACE_HOLDER           = 'USER_OPEN_ID';
var CACHE_SYSTEM_ACCESS_TOKEN           = 'WECHAT_SYSTEM_ACCESS_TOKEN';
var CACHE_USER_ACCESS_TOKEN             = 'WECHAT_USER_ACCESS_TOKEN';
var CACHE_USER_ACCESS_TOKEN_REFRESH     = 'WECHAT_USER_ACCESS_TOKEN_REFRESH';
var CACHE_WECHAT_JS_TICKET              = 'WECHAT_JS_TICKET';

// =============================== 微信公众号相关参数 end =========================================




// =============================== 微信各种API的网址 =========================================
// --------  获取系统 access token
var WECHAT_URL_TO_GET_SYSTEM_ACCESS_TOKEN = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='
    + WECHAT_APP_ID + '&secret=' + WECHAT_APP_SECRET;
// --------  获取网页用户授权，并执行跳转
var WECHAT_URL_TO_GET_USER_GRANT_AND_REDIRECT = 'http://open.weixin.qq.com/connect/oauth2/authorize?appid='
    + WECHAT_APP_ID + '&redirect_uri=' + encodeURI(WECHAT_REDIRECT_URL)
    +'&response_type=code&scope=' + USER_GRANT_SCOPE + '&state='
    + WECHAT_GRANT_PARAM_STATE + '#wechat_redirect';

var WECHAT_URL_TO_GET_USER_ACCESS_TOKEN = 'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' + WECHAT_APP_ID
    + '&secret=' + WECHAT_APP_SECRET + '&code=USER_AUTH_CODE&grant_type=authorization_code';

var WECHAT_URL_TO_GET_USER_DETAIL = 'https://api.weixin.qq.com/sns/userinfo?access_token=USER_ACCESS_TOKEN&openid=USER_OPEN_ID&lang=zh_CN';

var WECHAT_URL_TO_GET_JS_TICKET = "https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token="+ WECHAT_SYS_ACCESS_TOKEN_PLACE_HOLDER + "&type=jsapi";

//
// =============================== 微信各种API的网址 end =========================================


// 对外提供服务的方法
router.getAccessTokenFromWechatWithQ    = getAccessTokenFromWechatWithQ;
router.getUserInfoWithQ                 = getUserInfoWithQ;
router.makeEntryUrlWithState            = makeEntryUrlWithState;
router.getUserDetailInfo                = getUserDetailInfo;

//初始化的时候就先把系统的access token取回来
if(wechatConfig != undefined){
    getAccessTokenFromWechatWithQ();
}



// 对网页HTTP请求的响应
router.get('/', respondToWxApi);        // 回应微信启用开发者模式，更改接口URL时候的消息和回应
function respondToWxApi(req,res,next){
    var signature = req.query.signature;
    var timestamp = req.query.timestamp;
    var nonce = req.query.nonce;
    var echostr = req.query.echostr;
    var arr = new Array();
    arr.push(WECHAT_TOKEN);
    arr.push(timestamp);
    arr.push(nonce);
    arr.sort();
    var strCalculatedSig = arr.join('');
    strCalculatedSig = sha1(strCalculatedSig);
    if(strCalculatedSig === signature){
        res.send(echostr);
    } else {
        res.send('fail');
    }
}

// 微信授权后跳转过来的目标页面，可以获取code
router.get('/shop', shop);
function shop(req,res,next){
    var authCode = req.query.code;
    var stateParam = req.query.state;
    if(!authCode) res.status(401).end();        // 如果没有code则返回401

    router.getUserInfoWithQ(authCode).then(function(userInfo){
        console.log('           userInfo  = ');  console.dir(userInfo);
        // TODO: 授权后应当把微信用户token 和refresh保存入数据库，建立openid和 token之间的关系
        req.session.user_open_id = userInfo.openid;
        // 如果要获取微信用户详细信息，则跳转要写到下面的回调里面去
        var userAccessToken = userInfo.access_token;
        console.log('   ---- LOG: ' + __filename + os.EOL + '        userAccessToken  = ');  console.dir(userAccessToken);
        console.log('   ---- LOG: ' + __filename + os.EOL + '        userInfo.openid  = ');  console.dir(userInfo.openid);
        router.getUserDetailInfo(userInfo.openid, userAccessToken).then(function(info){
            // TODO: 1. 获取微信用户详细信息后，应当写入数据库
            //      TODO: 调用API写微信用户信息入数据库


            // TODO：2. 拼接用户系统URL和参数，带着参数跳转回用户系统（用户系统：调用wxHelper的系统）
            //      见 wechat_config : WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT
            stateParam = parseStateParam(stateParam);
            var targetUserUrl = WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT;
            if(targetUserUrl.indexOf('?') > 0){       // 用户系统的目标URL本来就带着参数的情况
                targetUserUrl = targetUserUrl + '&' + stateParam;
            } else {                // 用户系统的目标URL不带参数的情况
                targetUserUrl = targetUserUrl + '?' + stateParam;
            }
            console.log('   ---- LOG: ' + __filename + os.EOL + '        WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT  = ');  console.dir(WECHAT_TARGET_SITE_URL_AFTER_USER_GRANT);
            res.redirect(targetUserUrl);
            return;
            //res.send(info);       // DEBUG: 返回用户身份信息到网页
            //res.redirect('/')
        });
        //res.send(val);
    }).catch(function(err){
        console.log('           getUserInfoWithQ   err  = ');  console.dir(err);
        res.send(err)
    });
    //res.json({code : authCode, state: stateParam});
}

function getUserDetailInfo(openId, userAccessToken){
    return new Promise(
        function(resolve, reject){
            console.log('           getUserDetailInfo    userAccessToken  = ');  console.dir(userAccessToken);
            var getUserDetailInfoUrl = WECHAT_URL_TO_GET_USER_DETAIL;
            getUserDetailInfoUrl = getUserDetailInfoUrl.replace(USER_ACCESS_TOKEN_PLACE_HOLDER, userAccessToken);
            getUserDetailInfoUrl = getUserDetailInfoUrl.replace(USER_OPEN_ID_PLACE_HOLDER, openId);
            console.log('           WECHAT_URL_TO_GET_USER_DETAIL  = ');  console.dir(getUserDetailInfoUrl);
            httpsGetFromUrlWithQ(getUserDetailInfoUrl,'').then(function(info){
                /*{ openid: 'oqOr2swlO6ikREFg5cuWO1jx5-V4',
                 nickname: '大强 undefined',
                 sex: 1,
                 language: 'zh_CN',
                 city: '',
                 province: '',
                 country: '法国',
                 headimgurl: 'http://wx.qlogo.cn/mmopen/L2q25MUCEFgyictuZrib5ttHvN86H2dmdRZicnruoVASDL8dQcFib088zTVSppy3p6vuVeYFz3PCIvU5SuIotyBxlSEcia4jcb4QW/0',
                 privilege: []
                 }*/
                info = JSON.parse(info);
                console.log('           getUserDetailInfo   info  = ');  console.dir(info);
                resolve(info);
            }).catch(function(err){
                console.log('           getUserDetailInfo    err  = ');  console.dir(err);
                reject(err);
            });
        });
}


// 使用promise返回系统 accessToken
//      优先使用缓存里面保存的数据
//          缓存没有的时候去微信取
function getAccessTokenFromWechatWithQ(){
    return new Promise(
        function(resolve, reject){
            cache.get(CACHE_SYSTEM_ACCESS_TOKEN).then(function(val){
                if(val == undefined){       // 缓存里面没有，从微信API获取
                    httpsGetFromUrlWithQ(WECHAT_URL_TO_GET_SYSTEM_ACCESS_TOKEN,'').then(function(result){
                        /*result:
                         {
                         access_token: "uxMOZZ3ykzZxmsG2Dk4hN1A0xYrVI9fHMDR89QJKYJNscTdsvxkW4sZFc7Zk9JFcpLKVyhRTPYoGspBcfvusoOUwHX3z58YngOKZL23c1UBnURNjyucanBL0uYhyYcj1NAJfAAAQDM",
                         expires_in: 7200
                         }*/
                        result = JSON.parse(result);
                        var accessToken = result.access_token;
                        cache.set(CACHE_SYSTEM_ACCESS_TOKEN, accessToken, '7190s');  // 这样写存入 cache
                        resolve(accessToken);
                    });
                } else {                    // 缓存里面有，直接返回缓存的值
                    console.log('           val 2 = ');  console.dir(val);
                    resolve(val);
                }
            }).catch(function(err){
                console.log('           getAccessTokenFromWechatWithQ       err  = ');  console.dir(err);
                reject(err);      // 缓存过期的时候不会进入这里
            });
        });
}


function getUserInfoWithQ(authCode){
    var urlToGetUserAccessToken = WECHAT_URL_TO_GET_USER_ACCESS_TOKEN;
    urlToGetUserAccessToken = urlToGetUserAccessToken.replace(USER_AUTH_CODE_PLACE_HOLDER, authCode);
    return new Promise(
        function(resolve, reject){
            httpsGetFromUrlWithQ(urlToGetUserAccessToken,'').then(function(result){
                /*{
                 access_token   : "SetZOcrLVpi22ZxWBzPz_RJFdYpKTnn4f99JrH0LGiX1iD91VxzRScqUsLpKrGt_sUyARXcz_3Xo4p8ARHBywklqXnqZdjh-DudPPrHWHvA",
                 expires_in     : 7200,
                 refresh_token  : "z5KCV3GZMUQf6KPpGg1rXH8tnSrx7ohtrV7wP7qJtahp9b04susxM9HMSq_ht07-iuHKNWBMI_GuTAOQOnxzYuMY0oacQMq6Dl1Z6EqS4H4",
                 openid         : "oqOr2swlO6ikREFg5cuWO1jx5-V4",
                 scope          : "snsapi_userinfo"
                 }*/
                console.log('           getUserInfoWithQ    result  = ');  console.dir(result);
                result = JSON.parse(result);
                //cache.set(CACHE_USER_ACCESS_TOKEN, result.access_token, '7190s');             // 这样写存入 cache
                //cache.set(CACHE_USER_ACCESS_TOKEN_REFRESH, result.refresh_token, '7190s');    // 这样写存入 cache
                resolve(result);
            });
        });
}


// 获取网页引用微信jsSDK的ticket
router.get('/getJsTicket', getJsTicket);
function getJsTicket(req,res,next){
    // console.log('       .getJsTicket()     req.body = '); console.dir(req.body);

}


function getJsTicketFromWechatWithQ(){
    return new Promise(
        function(resolve, reject){
            cache.get(CACHE_WECHAT_JS_TICKET).then(function(ticket){
                if(ticket == undefined){       // 缓存里面没有，从微信API获取
                    getAccessTokenFromWechatWithQ().then(function(sysAccessToken){
                        var jsTicketUrl = WECHAT_URL_TO_GET_JS_TICKET.replace(WECHAT_SYS_ACCESS_TOKEN_PLACE_HOLDER, sysAccessToken);
                        httpsGetFromUrlWithQ(jsTicketUrl,'').then(function(getJsTicketResult){
                            /*{ "errcode":0,
                             "errmsg":"ok",
                             "ticket":"bxLdikRXVbTPdHSM05e5u5sUoXNKdvsdshFKA",
                             "expires_in":7200       }*/
                            getJsTicketResult = JSON.parse(getJsTicketResult);
                            var newTicket = getJsTicketResult.ticket;
                            cache.set(CACHE_WECHAT_JS_TICKET, newTicket, '7190s');  // 这样写存入 cache
                            resolve(newTicket);
                        });
                    });
                } else {                    // 缓存里面有，直接返回缓存的值
                    console.log('           js Ticket from cache = ');  console.dir(ticket);
                    resolve(ticket);
                }
            }).catch(function(err){
                console.log('           getJsTicketFromWechatWithQ       err  = ');  console.dir(err);
                reject(err);      // 缓存过期的时候不会进入这里
            });
        });
}



router.get('/testPayPage', testPayPage);
router.post('/testPayPage', testPayPage);
function testPayPage(req,res,next){
    if(!wechatPay) initWechatPay();
    var ts = wechatPay._generateTimeStamp();
    var nonceStr = wechatPay._generateNonceStr();
    var data = {
        wechatPayConfig : {
            appId       : WECHAT_APP_ID,
            timestamp   : ts,
            nonceStr    : nonceStr,
            signature   : 'null'
        },
        wechatPayParam : {
            pay_timestamp       : 'null',
            pay_nonceStr        : 'null',
            pay_package         : 'null',
            pay_signType        : 'null',
            pay_sign            : 'null'
        }
    };
    async.waterfall(
        [function(callback){
            getJsTicketFromWechatWithQ().then(function(jsTicket){
                callback(null, jsTicket);
            });
        },
            function(jsTicket, callback){
                //var configToSign = {
                //    noncestr        : nonceStr,
                //    jsapi_ticket    : jsTicket,
                //    timestamp       : ts,
                //    url             : 'http://wxtest.huaguosun.com/wx/api/testPayPage'
                //};
                var configToSign = {
                    noncestr        : nonceStr,
                    jsapi_ticket    : jsTicket,
                    timestamp       : ts,
                    url             : 'http://wxtest.huaguosun.com/wx/api/testPayPage'
                };
                console.log('   ---- LOG: ' + __filename + os.EOL + '        configToSign   = ');  console.dir(configToSign);
                var configSign = wechatPay._getConfigSign(configToSign,'SHA1');
                console.log('   ---- LOG: ' + __filename + os.EOL + '        configSign     = ');  console.dir(configSign);
                data.wechatPayConfig.signature = configSign;
                callback(null,null);
            },
            function(result, callback){
                // 去取prepayId
                var orderDetail = {
                    appid               : WECHAT_APP_ID,
                    mch_id              : WECHAT_PAY_MERCHANT_ID,
                    nonce_str           : nonceStr,
                    body                : '一分钱测一次划算不？',
                    out_trade_no        : nonceStr,
                    total_fee           : 1,
                    spbill_create_ip    : '111.111.111.111',
                    notify_url          : WECHAT_PAY_SUCCES_NOTIFY_URL,
                    trade_type          : 'JSAPI',
                    openid              : req.session.user_open_id,
                };
                console.log('   ---- LOG: ' + __filename + os.EOL + '        orderDetail  = ');  console.dir(orderDetail);
                wechatPay.unifiedOrder(orderDetail, function(prepayErr, prepayOrderData){
                    console.log('   ---- LOG: ' + __filename + os.EOL + '        prepayErr        1  = ');  console.dir(prepayErr);
                    console.log('   ---- LOG: ' + __filename + os.EOL + '        prepayOrderData  1  = ');  console.dir(prepayOrderData);
                    // ========== 以下是 unifiedOrder 接口的正确返回值，其中包含 prepay_id
                    //{ return_code: 'SUCCESS',
                    //    return_msg: 'OK',
                    //    appid: 'wxaxxxxxxxxxx',
                    //    mch_id: '11111111',
                    //    nonce_str: 'zzzzzzzzzzzzzz',
                    //    sign: 'B117C2D4278Cxxxxxxxxxxxxxx',
                    //    result_code: 'SUCCESS',
                    //    prepay_id: 'wx2017030315111111155111111111111',
                    //    trade_type: 'JSAPI' }
                    callback(null, prepayOrderData.prepay_id);
                });
            },
            function(prepay_id){
                console.log('   ---- LOG: ' + __filename + os.EOL + '        prepay_id  = ');  console.dir(prepay_id);
                data.wechatPayParam.pay_timestamp        = ts;
                data.wechatPayParam.pay_nonceStr         = nonceStr;
                data.wechatPayParam.pay_package          = 'prepay_id=' + prepay_id;
                data.wechatPayParam.pay_signType         = 'MD5';

                var payParamsToSign = {
                    appId           : WECHAT_APP_ID,
                    timeStamp       : ts,
                    nonceStr        : nonceStr,
                    package         : 'prepay_id=' + prepay_id,
                    signType        : 'MD5'
                };
                var paySign = wechatPay._getSign(payParamsToSign);
                data.wechatPayParam.pay_sign             = paySign;
                console.log('   ---- LOG: ' + __filename + os.EOL + '    ===== BEFORE PAYMENT ======    data  = ');  console.dir(data);
                res.render('Order/testPayPage.html', data);
                //res.json(prepayOrderData);
            }],
        function(err,result){
            console.log('   .()       error !!.   err = ');console.dir(err);
            console.log('       result = ');        console.dir(result);
            res.json(err);
        }
    );

}



router.post('/getNotify', getNotify);
function getNotify(req,res,next){
    if(!wechatPay) initWechatPay();
    util.getRawBody(req, function (err, rawBody) {
        console.log('   ---- LOG: ' + __filename + os.EOL + '        rawBody 1 = ');  console.dir(rawBody);
        if (err) {
            //err.name = 'BadMessage' + err.name;
            //return self.fail(err, res);
            res.sendStatus(403);
        }
        wechatPay.validate(rawBody, function(err, message){
            //========= 以下是rawBody 的XML内容 ==========
            //<xml><appid><![CDATA[wxa7xxxxxxxxx]]></appid>
            //<bank_type><![CDATA[CFT]]></bank_type>
            //<cash_fee><![CDATA[1]]></cash_fee>
            //<fee_type><![CDATA[CNY]]></fee_type>
            //<is_subscribe><![CDATA[Y]]></is_subscribe>
            //<mch_id><![CDATA[111111111]]></mch_id>
            //<nonce_str><![CDATA[j0Js2Zxxxxxxxxxxxxxre5vQ0x]]></nonce_str>
            //<openid><![CDATA[oxw7LjvKB_19QxxxxxxxxxxxxxGTcI]]></openid>
            //<out_trade_no><![CDATA[j0Js2ZTqmKxxxxxxxxxx5vQ0x]]></out_trade_no>
            //<result_code><![CDATA[SUCCESS]]></result_code>
            //<return_code><![CDATA[SUCCESS]]></return_code>
            //<sign><![CDATA[698108D50xxxxxxxxxxx8BF9816D0]]></sign>
            //<time_end><![CDATA[20170303161111]]></time_end>
            //<total_fee>1</total_fee>
            //<trade_type><![CDATA[JSAPI]]></trade_type>
            //<transaction_id><![CDATA[4010122001201703031111111112]]></transaction_id>
            //</xml>
            console.log('   ---- LOG: ' + __filename + os.EOL + '        rawBody 2  = ');  console.dir(rawBody);
            //  ======== 以下是XML转为 json后的message 内容
            //{ appid: 'wxa71fzzzzzzzzz',
            //  bank_type: 'CFT',
            //  cash_fee: '1',
            //  fee_type: 'CNY',
            //  is_subscribe: 'Y',
            //  mch_id: '1111111111',
            //  nonce_str: '25hKU7Nf1111111111nq81w',
            //  openid: 'oxw7LjvKB_19Qpxxxxxxxxxxx',
            //  out_trade_no: '25hKU7Nf1111111111nq81w',
            //  result_code: 'SUCCESS',
            //  return_code: 'SUCCESS',
            //  sign: '405FF53BBD3771AB591111111111',
            //  time_end: '20170303171111',
            //  total_fee: '1',
            //  trade_type: 'JSAPI',
            //  transaction_id: '4010122001201703032076984224' }
            console.log('   ---- LOG: ' + __filename + os.EOL + '        message    = ');  console.dir(message);
            res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>');
        });
    });
}



router.get('/makePayConfig', makePayConfig);
router.post('/makePayConfig', makePayConfig);
function makePayConfig(req,res,next){
    initWechatPay();
    var order = {
        body: '吮指原味鸡 * 1',
        attach: '{"部位":"三角"}',
        out_trade_no: 'kfc' + (+new Date),
        total_fee: 10 * 100,
        spbill_create_ip: '123.12.12.123',
        openid: req.session.user_open_id,
        trade_type: 'JSAPI'
    };
    console.log('   ---- LOG: ' + __filename + os.EOL + '        makePayConfig   order  = ');  console.dir(order);
    wechatPay.getBrandWCPayRequestParams(order, function(err, payargs){
        console.log('   ---- LOG: ' + __filename + os.EOL + '        err        = ');  console.dir(err);
        console.log('   ---- LOG: ' + __filename + os.EOL + '        payargs    = ');  console.dir(payargs);
        res.json(payargs);
    });

}


function initWechatPay(){
    var initConfig = {
        partnerKey: WECHAT_PAY_API_KEY,
        appId: WECHAT_APP_ID,
        mchId: WECHAT_PAY_MERCHANT_ID,
        notifyUrl: WECHAT_PAY_SUCCES_NOTIFY_URL,
        //key: WECHAT_PAY_API_KEY
        //pfx: fs.readFileSync("<location-of-your-apiclient-cert.p12>")
    };
    console.log('   ---- LOG: ' + __filename + os.EOL + '        initConfig  = ');  console.dir(initConfig);
    wechatPay = new wechatPayLib(initConfig);
}






//              state参数格式 (key1:val1;key2val2)
//                                           url参数格式：  ?key1=val1&key2=val2&key3=val3
function parseStateParam(state){
    state = state.replace(/:/g,'=');
    state = state.replace(/;/g,'&');
    return state;
}

function makeEntryUrlWithState(state){
    console.log('   ---- LOG: ' + __filename + os.EOL + '        state  = ');  console.dir(state);
    if(state){
        WECHAT_URL_TO_GET_USER_GRANT_AND_REDIRECT = WECHAT_URL_TO_GET_USER_GRANT_AND_REDIRECT.replace(WECHAT_GRANT_PARAM_STATE, state);
    }
    return WECHAT_URL_TO_GET_USER_GRANT_AND_REDIRECT;
}



router.get('/makeQRUrl', makeQRUrl);
function makeQRUrl(req,res,next){
    // console.log('       .makeQRUrl()     req.body = '); console.dir(req.body);
    var s = req.query.s;    // 参数1
    var p = req.query.p;    // 参数2
    var f = req.query.f;    // 参数3
    var arr = new Array();
    if(s) arr.push('s:'+s);
    if(p) arr.push('p:'+p);
    if(f) arr.push('f:'+f);
    var arrRet = arr.join(';');
    console.log('           arrRet  = ');  console.dir(arrRet);
    var ret = makeEntryUrlWithState(arrRet);
    console.log('           ret  = ');  console.dir(ret);
    var intro = '参数写法 makeQRUrl?s=参数1&p=参数2&f=参数3' + os.EOL + os.EOL;
    res.send(intro + ret);
}






// ===== 以下是开发阶段需要使用的，仅做测试用途 =====
router.get('/makeEntryUrl', makeEntryUrl);      // 生成微信用户授权入口URL
function makeEntryUrl(req,res,next){
    // console.log('       .makeEntryUrl()     req.body = '); console.dir(req.body);
    res.send(makeEntryUrlWithState());
}


router.get('/accessToken', getSystemAccessToken);        // 对网页服务，直接访问微信服务器，返回accessToken
function getSystemAccessToken(req,res,next){
    console.log('           accessToken 000 ');
    router.getAccessTokenFromWechatWithQ().then(function(token){
        console.log('           token  = ');  console.dir(token);
        res.send(token);
    }).catch(function(err){
        res.send(err);
    });
}

router.get('/userAccessToken', userAccessToken);        // 对网页服务，直接访问微信服务器，返回当前缓存中的网页accessToken
function userAccessToken(req,res,next){
    cache.get(CACHE_USER_ACCESS_TOKEN).then(function(val){
        res.send(val);      // 当缓存过期，这里的val = undefined
    }).catch(function(err){
        res.send(err);      // 缓存过期的时候不会进入这里
    });
}


router.get('/userOpenId', accessToken);             // 对网页服务，直接访问微信服务器，返回当前用户的openid
function accessToken(req,res,next){
    res.send(req.session.user_open_id);
}


/* 这里证明access_token 已经存入session  或 cache */
router.get('/accessTokenInCache', accessTokenInCache);        //    对网页服务，返回缓存中的accessToken
function accessTokenInCache(req,res,next){
    // 这样写从session读取
    //      res.send(req.session.WECHAT_SYSTEM_ACCESS_TOKEN);
    // 这样写，从cache读取。
    cache.get('WECHAT_SYSTEM_ACCESS_TOKEN').then(function(val){
        res.send(val);      // 当缓存过期，这里的val = undefined
    }).catch(function(err){
        res.send(err);      // 缓存过期的时候不会进入这里
    });
}




//=============================
function httpsGetFromUrlWithQ(targetUrl,headers){
    return new Promise(
        function(resolve,reject){
            var urlElements = url.parse(targetUrl);
            var options = { hostname: urlElements.hostname, port: urlElements.port,
                path: urlElements.path,         method: 'GET',  headers: headers    };
            var req = https.request(options, function (httpRes) {
                var body = "";
                httpRes.setEncoding('utf8');
                if (httpRes.statusCode == 200) {
                    httpRes.on('data', function (data) { body += data; })
                        .on('end', function () {
                            return resolve(body);
                        });
                }
                else {
                    httpRes.on('data', function (data) { body += data; })
                        .on('end', function () {
                            return resolve(body);
                        });
                }
            });
            req.end();  return ;
        }
    );
}

module.exports = router;