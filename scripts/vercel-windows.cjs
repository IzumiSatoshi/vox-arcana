// Vercel CLI 59 may pass both Path and PATH to child processes on Windows.
// Normalize only each child environment; system settings are never changed.
const cp = require('node:child_process');
const original=cp.spawn;
cp.spawn=function(command,args,options){
  if(process.platform==='win32' && options?.env){
    options={...options,env:{...options.env}};
    const keys=Object.keys(options.env).filter(k=>k.toLowerCase()==='path');
    const paths=keys.map(k=>options.env[k]); keys.forEach(k=>delete options.env[k]);
    options.env.Path=[...new Set(paths.concat(process.env.Path||process.env.PATH||'').join(';').split(';'))].join(';');
    if(command==='cmd.exe') command=process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  }
  return original.call(this,command,args,options);
};
