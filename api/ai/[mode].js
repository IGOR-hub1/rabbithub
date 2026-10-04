'use strict';

/* Função Vercel: mantém GEMINI_API_KEY fora do site e do APK. */
const MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
const RATE_WINDOW = 60 * 60 * 1000;
const RATE_MAX = 24;
const RATE = new Map();

function consumeRate(request){
  const forwarded=String(request.headers&&request.headers['x-forwarded-for']||'').split(',')[0].trim();
  const key=(forwarded||request.socket&&request.socket.remoteAddress||'unknown').slice(0,100);
  const now=Date.now();
  if(RATE.size>1000){for(const [ip,value] of RATE){if(now-value.startedAt>=RATE_WINDOW)RATE.delete(ip);}}
  let value=RATE.get(key);
  if(!value||now-value.startedAt>=RATE_WINDOW)value={startedAt:now,count:0};
  if(value.count>=RATE_MAX)return false;
  value.count+=1;RATE.set(key,value);return true;
}

function text(value,max){ return String(value || '').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,max); }
function confidence(value){ return Math.max(0,Math.min(1,Number(value)||0)); }

function schema(mode){
  if(mode==='recommendations')return {type:'object',properties:{recommendations:{type:'array',maxItems:8,items:{type:'object',properties:{title:{type:'string'},reason:{type:'string'}},required:['title','reason']}}},required:['recommendations']};
  if(mode==='anime')return {type:'object',properties:{
    fillerRanges:{type:'array',maxItems:80,items:{type:'object',properties:{start:{type:'number'},end:{type:'number'},confidence:{type:'number'},reason:{type:'string'}},required:['start','end','confidence','reason']}},
    fillers:{type:'array',maxItems:120,items:{type:'object',properties:{index:{type:'number'},number:{type:'number'},confidence:{type:'number'},reason:{type:'string'}},required:['index','number','confidence','reason']}}
  },required:['fillerRanges','fillers']};
  return {type:'object',properties:{filler:{type:'boolean'},fillerConfidence:{type:'number'},fillerReason:{type:'string'},introStart:{type:'number'},introEnd:{type:'number'},creditsStart:{type:'number'},skipConfidence:{type:'number'},skipReason:{type:'string'}},required:['filler','fillerConfidence','fillerReason','introStart','introEnd','creditsStart','skipConfidence','skipReason']};
}

function prompt(mode,input){
  input=input||{};
  if(mode==='recommendations'){
    const watched=(Array.isArray(input.watched)?input.watched:[]).slice(0,30).map(value=>text(value,120)).filter(Boolean);
    const listed=(Array.isArray(input.watchlist)?input.watchlist:[]).slice(0,30).map(value=>text(value,120)).filter(Boolean);
    return 'Você é o recomendador do RabbitHub Animes. Sugira até 8 animes reais que provavelmente existem em catálogos brasileiros. Não repita obras já vistas ou na lista. Use o título mais comum em português ou inglês e uma razão curta, sem spoilers. Histórico: '+JSON.stringify(watched)+'. Minha Lista: '+JSON.stringify(listed)+'.';
  }
  if(mode==='anime'){
    const episodes=(Array.isArray(input.episodes)?input.episodes:[]).slice(0,320).map((episode,index)=>({index:Number.isFinite(Number(episode.index))?Number(episode.index):index,number:Number(episode.number)||index+1,title:text(episode.title,100)}));
    return 'Classifique fillers de anime com cautela. Anime: '+text(input.animeTitle,180)+'. Total informado: '+Math.max(0,Number(input.total)||episodes.length)+'. Episódios disponíveis: '+JSON.stringify(episodes)+'. Retorne faixas numéricas conhecidas e itens isolados. Se não tiver certeza, deixe as listas vazias; nunca invente. Confiança entre 0 e 1.';
  }
  return 'Analise um episódio de anime para recursos de reprodução. Anime: '+text(input.animeTitle,180)+'. Episódio: '+text(input.episodeTitle,140)+'. Número: '+Math.max(0,Number(input.episodeNumber)||0)+'. Temporada: '+Math.max(0,Number(input.season)||0)+'. Duração em segundos: '+Math.max(0,Number(input.duration)||0)+'. Descrição: '+text(input.description,500)+'. Identifique filler somente se houver conhecimento confiável. Estime abertura e encerramento apenas quando o padrão for plausível; caso contrário use zero e baixa confiança. Nunca pule prólogo antes da abertura e nunca marque mais que 110 segundos de abertura. Confianças entre 0 e 1.';
}

function normalize(mode,raw){
  raw=raw&&typeof raw==='object'?raw:{};
  if(mode==='recommendations')return {recommendations:(Array.isArray(raw.recommendations)?raw.recommendations:[]).slice(0,8).map(item=>({title:text(item&&item.title,140),reason:text(item&&item.reason,220)})).filter(item=>item.title)};
  if(mode==='anime')return {
    fillerRanges:(Array.isArray(raw.fillerRanges)?raw.fillerRanges:[]).slice(0,80).map(item=>({start:Math.max(1,Math.floor(Number(item.start)||0)),end:Math.max(1,Math.floor(Number(item.end)||0)),confidence:confidence(item.confidence),reason:text(item.reason,180)})).filter(item=>item.start<=item.end&&item.confidence>=.55),
    fillers:(Array.isArray(raw.fillers)?raw.fillers:[]).slice(0,120).map(item=>({index:Math.max(0,Math.floor(Number(item.index)||0)),number:Math.max(1,Number(item.number)||0),confidence:confidence(item.confidence),reason:text(item.reason,180)})).filter(item=>item.confidence>=.55)
  };
  return {filler:raw.filler===true,fillerConfidence:confidence(raw.fillerConfidence),fillerReason:text(raw.fillerReason,220),introStart:Math.max(0,Number(raw.introStart)||0),introEnd:Math.max(0,Number(raw.introEnd)||0),creditsStart:Math.max(0,Number(raw.creditsStart)||0),skipConfidence:confidence(raw.skipConfidence),skipReason:text(raw.skipReason,220)};
}

module.exports = async function handler(request,response){
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  if(request.method==='OPTIONS'){response.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');return response.status(204).end();}
  if(request.method!=='POST')return response.status(405).json({ok:false,error:'Use POST.'});
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  if(!apiKey)return response.status(503).json({ok:false,configured:false,error:'Configure GEMINI_API_KEY na Vercel.'});
  const mode=String(request.query&&request.query.mode||'');
  if(!['episode','anime','recommendations'].includes(mode))return response.status(404).json({ok:false,error:'Modo inválido.'});
  let input=request.body||{};
  if(typeof input==='string'){try{input=JSON.parse(input);}catch(error){return response.status(400).json({ok:false,error:'JSON inválido.'});}}
  if(JSON.stringify(input).length>128*1024)return response.status(413).json({ok:false,error:'Solicitação muito grande.'});
  if(!consumeRate(request)){response.setHeader('Retry-After','3600');return response.status(429).json({ok:false,error:'Limite temporário de análises atingido.'});}
  try{
    const upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODEL)+':generateContent',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt(mode,input)}]}],generationConfig:{temperature:.1,responseMimeType:'application/json',responseSchema:schema(mode)}})
    });
    if(!upstream.ok)throw new Error('Gemini HTTP '+upstream.status);
    const envelope=await upstream.json();
    const answer=envelope&&envelope.candidates&&envelope.candidates[0]&&envelope.candidates[0].content&&envelope.candidates[0].content.parts?envelope.candidates[0].content.parts.map(part=>part.text||'').join(''):'';
    if(!answer)throw new Error('Resposta vazia');
    return response.status(200).json({ok:true,model:MODEL,result:normalize(mode,JSON.parse(answer))});
  }catch(error){return response.status(502).json({ok:false,error:'Não foi possível concluir a análise agora.'});}
};
