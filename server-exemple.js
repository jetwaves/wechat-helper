/**
 * Created by jetwaves on 17-3-13.
 */
var express = require('express');
var app = express();


var wxHelper = require('./index.js');
var router = express.Router();


app.get('/', function(req, res){
    res.send('hello world');
});


router.get('/wx/api', wxHelper);
router.post('/wx/api', wxHelper);

router.get('/shop', shop);
router.post('/shop', shop);
function shop(req,res,next){
    res.send('user open_id = ' + req.session.user_open_id);     // 当获取到用户信息跳转过来这里的时候，用户的openid已经存入session了
}


app.listen(3000);
