/**
 * Created by jetwaves on 17-3-10.
 */
var tool = {
    findConfigFullName  : findConfigFullName,
    fileExists          : fileExists
};

require('./common.js');

// 在当前目录和最多三层的父目录中，寻找配置文件的完整文件名
function findConfigFullName(){
    var currentFolder = __dirname;
    var baseFolder = currentFolder;
    for(var i=0;i<3;i++){
        var fullNameToTry = path.join(baseFolder, 'wechat-helper-config.js');
        var fileInfo = fileExists(fullNameToTry);
        if(fileInfo != false){
            return fullNameToTry;
        }else {
            baseFolder = path.join(baseFolder, '..');
        }
    }
    return false;
};

function fileExists(fileFullName){
    try{
        var fileInfo = fs.accessSync(fileFullName);
        return fileInfo;
    }catch(err){
        return false;
    }
};


module.exports = tool;