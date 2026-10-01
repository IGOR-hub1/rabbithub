/* RabbitHub • cliente seguro dos recursos Gemini servidos por /api/ai. */
(function(){
  'use strict';
  var PREFIX='rh_ai_cache_v1_';
  function readJSON(key,fallback){try{var value=JSON.parse(localStorage.getItem(key)||'null');return value==null?fallback:value;}catch(e){return fallback;}}
  function hash(value){
    var text=String(value||''),number=2166136261;
    for(var i=0;i<text.length;i++){number^=text.charCodeAt(i);number=Math.imul(number,16777619);}
    return (number>>>0).toString(36);
  }
  function cached(mode,input,maxAge){
    var key=PREFIX+mode+'_'+hash(JSON.stringify(input)),value=readJSON(key,null);
    if(value&&Date.now()-Number(value.ts||0)<maxAge)return {key:key,value:value.data};
    return {key:key,value:null};
  }
  function request(mode,input,maxAge){
    var saved=cached(mode,input,maxAge);
    if(saved.value)return Promise.resolve(Object.assign({cached:true},saved.value));
    return fetch('/api/ai/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input||{})})
      .then(function(response){return response.json().catch(function(){return {};}).then(function(body){if(!response.ok||!body.ok)throw new Error(body.error||'IA indisponível.');return body.result||{};});})
      .then(function(result){try{localStorage.setItem(saved.key,JSON.stringify({ts:Date.now(),data:result}));}catch(e){}return result;});
  }
  function episode(input){
    input=input||{};
    var compact={animeTitle:String(input.animeTitle||'').slice(0,180),episodeTitle:String(input.episodeTitle||'').slice(0,140),episodeNumber:Number(input.episodeNumber)||0,season:Number(input.season)||0,duration:Math.round(Number(input.duration)||0),description:String(input.description||'').slice(0,500)};
    return request('episode',compact,30*24*60*60*1000);
  }
  function anime(input){
    input=input||{};
    var compact={animeTitle:String(input.animeTitle||'').slice(0,180),total:Number(input.total)||0,episodes:(input.episodes||[]).slice(0,320).map(function(item,index){return {index:Number(item.index)>=0?Number(item.index):index,number:Number(item.number)||index+1,title:String(item.title||'').slice(0,100)};})};
    return request('anime',compact,30*24*60*60*1000);
  }
  function recommendations(input){
    input=input||{};
    return request('recommendations',{watched:(input.watched||[]).slice(0,30),watchlist:(input.watchlist||[]).slice(0,30)},7*24*60*60*1000);
  }
  window.RabbitHubAI={analyzeEpisode:episode,analyzeAnime:anime,recommendations:recommendations};
})();
