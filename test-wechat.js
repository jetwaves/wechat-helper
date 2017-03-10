/**
 * Created by jetwaves on 17-3-10.
 */

require('./lib/common.js');
var util = require('./lib/util.js');



var fullConfigName = util.findConfigFullName();
console.log('           fullConfigName  = ');  console.dir(fullConfigName);
if(fullConfigName == false){
    throw new Error(' can not find configuration file :  wechat-helper-config.js  ');
}


