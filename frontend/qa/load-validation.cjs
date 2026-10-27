// Run the original browser UMD file as CommonJS without changing the frozen login assets.
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
module.exports=vm.runInThisContext('(function(module){'+fs.readFileSync(path.join(__dirname,'../dist/validation.js'),'utf8')+';return module.exports;})')({exports:{}});
