(function(root){
  function timestamp(value){const number=Number(value);return Number.isFinite(number)&&number>0?number:0;}
  function activityAt(conversation){const messages=Array.isArray(conversation?.messages)?conversation.messages:[];const activity=messages.reduce((latest,message)=>Math.max(latest,timestamp(message?.createdAt)),0);return activity||timestamp(conversation?.updatedAt)||timestamp(conversation?.createdAt);}
  function sort(conversations){return (Array.isArray(conversations)?conversations:[]).map((item,index)=>({item,index})).sort((a,b)=>activityAt(b.item)-activityAt(a.item)||timestamp(b.item?.createdAt)-timestamp(a.item?.createdAt)||a.index-b.index).map(entry=>entry.item);}
  const api={timestamp,activityAt,sort};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.TriadConversationOrder=api;
})(typeof window!=='undefined'?window:globalThis);
