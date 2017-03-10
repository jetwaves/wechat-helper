// https://github.com/supersheep/wechat-pay

var md5 = require('md5');
var sha1 = require('sha1');
var request = require('request');
var _ = require('underscore');
var xml2js = require('xml2js');
var https = require('https');
var url_mod = require('url');
var os = require('os');

var signTypes = {
  MD5: md5,
  SHA1: sha1
};

var RETURN_CODES = {
  SUCCESS: 'SUCCESS',
  FAIL: 'FAIL'
};

var URLS = {
  UNIFIED_ORDER: 'https://api.mch.weixin.qq.com/pay/unifiedorder',
  ORDER_QUERY: 'https://api.mch.weixin.qq.com/pay/orderquery',
  REFUND: 'https://api.mch.weixin.qq.com/secapi/pay/refund',
  REFUND_QUERY: 'https://api.mch.weixin.qq.com/pay/refundquery',
  DOWNLOAD_BILL: 'https://api.mch.weixin.qq.com/pay/downloadbill',
  SHORT_URL: 'https://api.mch.weixin.qq.com/tools/shorturl',
  CLOSE_ORDER: 'https://api.mch.weixin.qq.com/pay/closeorder'
};

var Payment = function (config) {
  this.appId = config.appId;
  this.partnerKey = config.partnerKey;
  this.mchId = config.mchId;
  this.subMchId = config.subMchId;
  this.notifyUrl = config.notifyUrl;
  this.passphrase = config.passphrase || config.mchId;
  this.pfx = config.pfx;
  return this;
};

Payment.prototype.getBrandWCPayRequestParams = function (order, callback) {
  var self = this;
  var default_params = {
    appId: this.appId,
    timeStamp: this._generateTimeStamp(),
    nonceStr: this._generateNonceStr(),
    signType: 'MD5'
  };

  order = this._extendWithDefault(order, [
    'notify_url'
  ]);

  console.log('   ---- LOG: ' + __filename + os.EOL + '        getBrandWCPayRequestParams   order  = ');  console.dir(order);
  this.unifiedOrder(order, function (err, data) {
      console.log('   ---- LOG: ' + __filename + os.EOL + '        getBrandWCPayRequestParams   err   = ');  console.dir(err);
      console.log('   ---- LOG: ' + __filename + os.EOL + '        getBrandWCPayRequestParams   data  = ');  console.dir(data);
      if (err) {
        return callback(err);
      }

      var params = _.extend(default_params, {
        package: 'prepay_id=' + data.prepay_id
      });
      console.log('   ---- LOG: ' + __filename + os.EOL + '        params  1 = ');  console.dir(params);

      params.paySign = self._getSign(params);

      if(order.trade_type == 'NATIVE'){
        params.code_url = data.code_url;
      }

      params.timestamp = params.timeStamp;
      console.log('   ---- LOG: ' + __filename + os.EOL + '        params 2 = ');  console.dir(params);
      callback(null, params);
  });
};

/**
 * Generate parameters for `WeixinJSBridge.invoke('editAddress', parameters)`.
 *
 * @param  {String}   data.url  Referer URL that call the API. *Note*: Must contain `code` and `state` in querystring.
 * @param  {String}   data.accessToken
 * @param  {Function} callback(err, params)
 *
 * @see https://pay.weixin.qq.com/wiki/doc/api/jsapi.php?chapter=7_9
 */
Payment.prototype.getEditAddressParams = function (data, callback) {
    if (!(data.url && data.accessToken)) {
      var err = new Error('Missing url or accessToken');
      return callback(err);
    }

    var params = {
        appId: this.appId,
        scope: 'jsapi_address',
        signType: 'SHA1',
        timeStamp: this._generateTimeStamp(),
        nonceStr: this._generateNonceStr(),
    };
    var signParams = {
        appid: params.appId,
        url: data.url,
        timestamp: params.timeStamp,
        noncestr: params.nonceStr,
        accesstoken: data.accessToken,
    };
    var string = this._toQueryString(signParams);
    params.addrSign = signTypes[params.signType](string);
    callback(null, params);
};

Payment.prototype._httpRequest = function(url, data, callback){
  request({
    url: url,
    method: 'POST',
    body: data
  }, function (err, response, body) {
    if (err) {
      return callback(err);
    }

    callback(null, body);
  });
};

Payment.prototype._httpsRequest = function(url, data, callback){
  var parsed_url = url_mod.parse(url);
  var req = https.request({
      host: parsed_url.host,
      port: 443,
      path: parsed_url.path,
      pfx: this.pfx,
      passphrase: this.passphrase,
      method: 'POST'
  }, function(res) {
    var content = '';
    res.on('data', function(chunk) {
      content += chunk;
    });
    res.on('end', function(){
      callback(null, content);
    });
  });

  req.on('error', function(e) {
    callback(e);
  });
  req.write(data);
  req.end();
};

Payment.prototype._signedQuery = function(url, params, options, callback){
  var self = this;
  var required = options.required || [];
  params = this._extendWithDefault(params, [
    'appid',
    'mch_id',
    'sub_mch_id',
    'nonce_str'
  ]);
  console.log('   ---- LOG: ' + __filename + os.EOL + '   _signedQuery     params 1 = ');  console.dir(params);
  params = _.extend({
    'sign': this._getSign(params)
  }, params);
  console.log('   ---- LOG: ' + __filename + os.EOL + '   _signedQuery     params 2 = ');  console.dir(params);
  if(params.long_url){
    params.long_url = encodeURIComponent(params.long_url);
  }
  console.log('   ---- LOG: ' + __filename + os.EOL + '   _signedQuery     params 3 = ');  console.dir(params);
  for(var key in params){
    if(params[key] !== undefined && params[key] !== null){
      params[key] = params[key].toString();
    }
  }

  var missing = [];
  required.forEach(function(key) {
    var alters = key.split('|');
    for (var i = alters.length - 1; i >= 0; i--) {
      if (params[alters[i]]) {
        return;
      }
    }
    missing.push(key);
  });

  if(missing.length){
    return callback('missing params ' + missing.join(','));
  }

  var request = (options.https ? this._httpsRequest : this._httpRequest).bind(this);
  var xmlToPost = this.buildXml(params);
  console.log('   ---- LOG: ' + __filename + os.EOL + '     _signedQuery   xmlToPost  = ');  console.dir(xmlToPost);
  request(url, this.buildXml(params), function(err, body){
    if(err){
      console.log('   ---- LOG: ' + __filename + os.EOL + '    _signedQuery    err  = ');  console.dir(err);
      return callback(err);
    }
    self.validate(body, callback);
  });

};

Payment.prototype.unifiedOrder = function (params, callback) {
  var requiredData = ['body', 'out_trade_no', 'total_fee', 'spbill_create_ip', 'trade_type'];
  if(params.trade_type == 'JSAPI'){
      requiredData.push('openid');
  }else if (params.trade_type == 'NATIVE'){
      requiredData.push('product_id');
  }
  params.notify_url = params.notify_url || this.notifyUrl;
  this._signedQuery(URLS.UNIFIED_ORDER, params, {
    required:requiredData
  }, callback);
};

Payment.prototype.orderQuery = function(params, callback){
  this._signedQuery(URLS.ORDER_QUERY, params, {
    required: ['transaction_id|out_trade_no']
  }, callback);
};

Payment.prototype.refund = function(params, callback){
  params = this._extendWithDefault(params, [
    'op_user_id'
  ]);

  this._signedQuery(URLS.REFUND, params, {
    https: true,
    required: ['transaction_id|out_trade_no', 'out_refund_no', 'total_fee', 'refund_fee']
  }, callback);
};

Payment.prototype.refundQuery = function(params, callback){
  this._signedQuery(URLS.REFUND_QUERY, params, {
    required: ['transaction_id|out_trade_no|out_refund_no|refund_id']
  }, callback);
};

Payment.prototype.downloadBill = function(params, callback){
  var self = this;
  this._signedQuery(URLS.DOWNLOAD_BILL, params, {
    required: ['bill_date', 'bill_type']
  }, function(err, rawData){
    if(err){
      if(err.name == 'XMLParseError'){
        callback(null,self.parseCsv(rawData));
      }else{
        callback(err);
      }
    }
  });
};

Payment.prototype.shortUrl = function(params, callback){
  this._signedQuery(URLS.SHORT_URL, params, {
    required: ['long_url']
  }, callback);
};

Payment.prototype.closeOrder = function(params, callback) {
  this._signedQuery(URLS.CLOSE_ORDER, params, {
    required: ['out_trade_no']
  }, callback);
};

Payment.prototype.parseCsv = function(text){
  var rows = text.trim().split(/\r?\n/);

  function toArr(rows){
    var titles = rows[0].split(',');
    var bodys = rows.splice(1);
    var data = [];

    bodys.forEach(function(row){
      var rowData = {};
      row.split(',').forEach(function(cell,i){
        rowData[titles[i]] = cell.split('`')[1];
      });
      data.push(rowData);
    });
    return data;
  }

  return {
    list: toArr(rows.slice(0, rows.length - 2)),
    stat: toArr(rows.slice(rows.length - 2, rows.length))[0]
  };
};

Payment.prototype.buildXml = function (obj) {
  var builder = new xml2js.Builder({
    allowSurrogateChars: true
  });
  var xml = builder.buildObject({
    xml:obj
  });
  return xml;
};

Payment.prototype.validate = function (xml, callback) {
  var self = this;
  console.log('   ---- LOG: ' + __filename + os.EOL + '        validate    xml  = ');  console.dir(xml);
  xml2js.parseString(xml, {
    trim: true,
    explicitArray: false
  }, function (err, json) {
        var error = null,
          data;
        if (err) {
          error = new Error();
          err.name = 'XMLParseError';
          return callback(err, xml);
        }
        console.log('   ---- LOG: ' + __filename + os.EOL + '        validate    data 1 = ');  console.dir(data);
        console.log('   ---- LOG: ' + __filename + os.EOL + '        validate    json  = ');  console.dir(json);
        data = json ? json.xml : {};

        if (data.return_code == RETURN_CODES.FAIL) {
          error = new Error(data.return_msg);
          error.name = 'ProtocolError';
        } else if (data.result_code == RETURN_CODES.FAIL) {
          error = new Error(data.err_code);
          error.name = 'BusinessError';
        } else if (self.appId !== data.appid) {
          error = new Error();
          error.name = 'InvalidAppId';
        } else if (self.mchId !== data.mch_id) {
          error = new Error();
          error.name = 'InvalidMchId';
        } else if (self.subMchId && self.subMchId !== data.sub_mch_id) {
          error = new Error();
          error.name = 'InvalidSubMchId';
        } else if (self._getSign(data) !== data.sign) {
          error = new Error();
          error.name = 'InvalidSignature';
        }
    console.log('   ---- LOG: ' + __filename + os.EOL + '        validate    data 2 = ');  console.dir(data);
        callback(error, data);
  });
};

/**
 * 使用默认值扩展对象
 * @param  {Object} obj
 * @param  {Array} keysNeedExtend
 * @return {Object} extendedObject
 */
Payment.prototype._extendWithDefault = function (obj, keysNeedExtend) {
  var defaults = {
    appid: this.appId,
    mch_id: this.mchId,
    sub_mch_id: this.subMchId,
    nonce_str: this._generateNonceStr(),
    notify_url: this.notifyUrl,
    op_user_id: this.mchId
  };
  var extendObject = {};
  keysNeedExtend.forEach(function (k) {
    if (defaults[k]) {
      extendObject[k] = defaults[k];
    }
  });
  return _.extend(extendObject, obj);
};

Payment.prototype._getSign = function (pkg, signType) {
  pkg = _.clone(pkg);
  delete pkg.sign;
  signType = signType || 'MD5';
  var string1 = this._toQueryString(pkg);
  var stringSignTemp = string1 + '&key=' + this.partnerKey;
  console.log('   ---- LOG: ' + __filename + os.EOL + '       _getSign       stringSignTemp  = ');  console.dir(stringSignTemp);
  var signValue = signTypes[signType](stringSignTemp).toUpperCase();
  return signValue;
};

Payment.prototype._getConfigSign = function (pkg, signType) {
  console.log('   ---- LOG: ' + __filename + os.EOL + '      _getConfigSign  pkg  = ');  console.dir(pkg);
  pkg = _.clone(pkg);
  delete pkg.sign;
  signType = signType || 'MD5';
  var string1 = this._toQueryString(pkg);
  console.log('   ---- LOG: ' + __filename + os.EOL + '      _getConfigSign  string1        = ');  console.dir(string1);
  var stringSignTemp = string1;
  console.log('   ---- LOG: ' + __filename + os.EOL + '      _getConfigSign  stringSignTemp = ');  console.dir(stringSignTemp);
  var signValue = signTypes[signType](stringSignTemp).toUpperCase();
  console.log('   ---- LOG: ' + __filename + os.EOL + '      _getConfigSign  signValue      = ');  console.dir(signValue);
  return signValue;
};

Payment.prototype._toQueryString = function (object) {
  return Object.keys(object).filter(function (key) {
    return object[key] !== undefined && object[key] !== '';
  }).sort().map(function (key) {
    return key + '=' + object[key];
  }).join('&');
};

Payment.prototype._generateTimeStamp = function () {
  return parseInt(+new Date() / 1000, 10) + '';
};

/**
 * [_generateNonceStr description]
 * @param  {[type]} length [description]
 * @return {[type]}        [description]
 */
Payment.prototype._generateNonceStr = function (length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var maxPos = chars.length;
  var noceStr = '';
  var i;
  for (i = 0; i < (length || 32); i++) {
    noceStr += chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return noceStr;
};

exports.Payment = Payment;
