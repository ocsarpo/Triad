(function (root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TriadVersion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function parts(value){return String(value||'').replace(/^v/iu,'').split(/[.+-]/u).slice(0,3).map(part=>Number.parseInt(part,10)||0);}
  function isNewer(latest,current){const left=parts(latest),right=parts(current);for(let index=0;index<3;index+=1){if(left[index]>right[index])return true;if(left[index]<right[index])return false;}return false;}
  return {parts,isNewer};
});
