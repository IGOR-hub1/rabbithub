/* X-Bunny Animes - processamento e persistencia resiliente de fotos de perfil. */
(function(){
  'use strict';

  var ACCEPTED_TYPES = ['image/jpeg','image/png','image/webp'];
  var MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  var MAX_OUTPUT_BYTES = 320 * 1024;
  var DEFAULT_SIZE = 420;

  function photoError(message,code){
    var error = new Error(message);
    error.code = code || 'profile-photo/error';
    return error;
  }

  function validate(file){
    if (!file || typeof file.size !== 'number') throw photoError('Escolha uma imagem do seu dispositivo.','profile-photo/missing');
    if (ACCEPTED_TYPES.indexOf(String(file.type || '').toLowerCase()) < 0) throw photoError('Use uma imagem JPG, PNG ou WEBP.','profile-photo/type');
    if (!file.size || file.size > MAX_SOURCE_BYTES) throw photoError('A imagem original precisa ter no maximo 8 MB.','profile-photo/size');
    return file;
  }

  function loadImage(file){
    if (window.createImageBitmap) {
      return createImageBitmap(file,{imageOrientation:'from-image'}).catch(function(){ return loadImageElement(file); });
    }
    return loadImageElement(file);
  }

  function loadImageElement(file){
    return new Promise(function(resolve,reject){
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function(){ URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = function(){ URL.revokeObjectURL(objectUrl); reject(photoError('Nao foi possivel abrir essa imagem.','profile-photo/decode')); };
      image.src = objectUrl;
    });
  }

  function canvasBlob(canvas,type,quality){
    return new Promise(function(resolve){ canvas.toBlob(resolve,type,quality); });
  }

  async function encode(canvas){
    var type = 'image/webp';
    var qualities = [.86,.78,.7,.62];
    var blob = null;
    for (var index=0;index<qualities.length;index++) {
      blob = await canvasBlob(canvas,type,qualities[index]);
      if (!blob) {
        type = 'image/jpeg';
        blob = await canvasBlob(canvas,type,qualities[index]);
      }
      if (blob && blob.size <= MAX_OUTPUT_BYTES) break;
    }
    if (!blob) throw photoError('Seu navegador nao conseguiu preparar a imagem.','profile-photo/encode');
    return blob;
  }

  function toDataUrl(blob){
    return new Promise(function(resolve,reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result || '')); };
      reader.onerror = function(){ reject(photoError('Nao foi possivel salvar a imagem neste dispositivo.','profile-photo/read')); };
      reader.readAsDataURL(blob);
    });
  }

  async function process(file,options){
    validate(file);
    options = options || {};
    var image = await loadImage(file);
    var sourceWidth = Number(image.naturalWidth || image.width || 0);
    var sourceHeight = Number(image.naturalHeight || image.height || 0);
    if (!sourceWidth || !sourceHeight) throw photoError('A imagem escolhida esta vazia ou corrompida.','profile-photo/dimensions');
    var size = Math.max(160,Math.min(640,Number(options.size) || DEFAULT_SIZE));
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var context = canvas.getContext('2d',{alpha:false});
    if (!context) throw photoError('Nao foi possivel preparar a foto.','profile-photo/canvas');
    context.fillStyle = '#111318'; context.fillRect(0,0,size,size);
    var crop = Math.min(sourceWidth,sourceHeight);
    var sourceX = Math.max(0,(sourceWidth-crop)/2);
    var sourceY = Math.max(0,(sourceHeight-crop)/2);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image,sourceX,sourceY,crop,crop,0,0,size,size);
    if (typeof image.close === 'function') image.close();
    var blob = await encode(canvas);
    return {blob:blob,dataUrl:await toDataUrl(blob),width:size,height:size,sourceBytes:file.size};
  }

  async function upload(user,file,profileId,options){
    options = options || {};
    var prepared = options.prepared || await process(file,options);
    var endpoint = options.endpoint || '/api/profile-photo';
    var serverError = null;
    if (user && typeof user.getIdToken === 'function' && options.localOnly !== true) {
      try {
        var token = await user.getIdToken();
        var response = await fetch(endpoint,{
          method:'POST',
          headers:{
            'Authorization':'Bearer ' + token,
            'Content-Type':prepared.blob.type || 'image/webp',
            'X-Profile-Id':String(profileId || 'principal')
          },
          body:prepared.blob
        });
        var text = await response.text();
        var result = {};
        try { result = text ? JSON.parse(text) : {}; } catch(ignore){}
        if (response.ok && result.ok && /^https:\/\//i.test(String(result.url || ''))) {
          return {url:String(result.url),storage:'remote',prepared:prepared};
        }
        serverError = new Error(result.error || ('Falha no armazenamento remoto (HTTP ' + response.status + ').'));
      } catch(error) { serverError = error; }
    }
    return {url:prepared.dataUrl,storage:'account',prepared:prepared,serverError:serverError};
  }

  function isEmbedded(value){ return /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(value || '')); }

  window.RabbitHubProfilePhoto = {
    acceptedTypes:ACCEPTED_TYPES.slice(),
    maxSourceBytes:MAX_SOURCE_BYTES,
    maxOutputBytes:MAX_OUTPUT_BYTES,
    validate:validate,
    process:process,
    upload:upload,
    isEmbedded:isEmbedded
  };
})();
