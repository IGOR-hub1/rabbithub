/* RabbitHub: prepara avatares localmente e envia somente a versão reduzida ao Cloudflare R2. */
(function(root){
  'use strict';
  var MAX_SOURCE_BYTES=8*1024*1024;
  var MAX_EDGE=512;

  function loadImage(file){
    return new Promise(function(resolve,reject){
      var url=URL.createObjectURL(file),image=new Image();
      image.onload=function(){resolve({image:image,url:url});};
      image.onerror=function(){URL.revokeObjectURL(url);reject(new Error('Não foi possível abrir esta imagem.'));};
      image.src=url;
    });
  }
  function canvasBlob(canvas,type,quality){
    return new Promise(function(resolve){canvas.toBlob(resolve,type,quality);});
  }
  async function prepare(file){
    if(!file||!/^image\/(?:jpeg|png|webp)$/i.test(file.type||''))throw new Error('Escolha uma imagem JPG, PNG ou WEBP.');
    if(file.size>MAX_SOURCE_BYTES)throw new Error('A imagem original deve ter no máximo 8 MB.');
    var loaded=await loadImage(file);
    try{
      var source=loaded.image,size=Math.min(source.naturalWidth||source.width,source.naturalHeight||source.height);
      if(!size)throw new Error('A imagem selecionada está vazia.');
      var sx=Math.max(0,((source.naturalWidth||source.width)-size)/2);
      var sy=Math.max(0,((source.naturalHeight||source.height)-size)/2);
      var edge=Math.min(MAX_EDGE,size),canvas=document.createElement('canvas');
      canvas.width=edge;canvas.height=edge;
      var context=canvas.getContext('2d',{alpha:false});
      context.fillStyle='#090a0d';context.fillRect(0,0,edge,edge);
      context.drawImage(source,sx,sy,size,size,0,0,edge,edge);
      var blob=await canvasBlob(canvas,'image/webp',.84);
      if(!blob)blob=await canvasBlob(canvas,'image/jpeg',.86);
      if(!blob)throw new Error('Não foi possível preparar esta foto.');
      return {blob:blob,previewUrl:URL.createObjectURL(blob)};
    }finally{URL.revokeObjectURL(loaded.url);}
  }
  async function upload(blob,options){
    options=options||{};
    var response=await fetch('/api/profile-image',{
      method:'POST',
      headers:{
        'Content-Type':blob.type||'image/jpeg',
        'X-RabbitHub-Uid':String(options.uid||'').slice(0,80),
        'X-RabbitHub-Profile':String(options.profileId||'principal').slice(0,80)
      },
      body:blob
    });
    var payload={};try{payload=await response.json();}catch(e){}
    if(!response.ok||!payload.url)throw new Error(payload.error||'Não foi possível enviar a foto.');
    return payload.url;
  }
  root.RabbitHubAvatarUpload={prepare:prepare,upload:upload};
})(window);
