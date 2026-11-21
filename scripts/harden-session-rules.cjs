'use strict';
// Reproducible local rules update. Does not publish or change Firebase data.
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../API ANIMES E CHAT/database.rules.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const active="!root.child('revokedSessions').child(auth.uid).child(auth.token.auth_time + '').exists() && root.child('users').child(auth.uid).child('banned').val() !== true && root.child('users').child(auth.uid).child('blocked').val() !== true";
function walk(node){
  for(const [key,value] of Object.entries(node)){
    if(value&&typeof value==='object')walk(value);
    else if((key==='.read'||key==='.write')&&typeof value==='string'&&value.includes('auth != null')&&!value.includes('revokedSessions'))node[key]=value.replace('auth != null','auth != null && ('+active+')');
  }
}
walk(data.rules);
data.rules.users['.read']="auth != null && auth.token.email_verified === true && ("+active+") && root.child('admins').child(auth.uid).val() === true";
data.rules.revokedSessions={
  '$uid':{
    '.read':"auth != null && auth.uid === $uid && auth.token.email_verified === true",
    '$authTime':{
      '.write':"auth != null && auth.uid === $uid && auth.token.email_verified === true && ("+active+") && newData.val() === true && $authTime.matches(/^[0-9]+$/)",
      '.validate':'newData.val() === true'
    }
  }
};
data.rules.users.$uid.devices={'$device':{
  'authTime':{'.validate':"newData.isNumber() && ((data.exists() && newData.val() === data.val()) || (!data.exists() && newData.val() === auth.token.auth_time))"}
}};
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
