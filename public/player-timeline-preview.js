/* Prévia da timeline: imagens por tempo ou decodificação em vídeo separado. */
(function(root,factory){
    var api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    if(root&&root.document)root.RabbitHubTimelinePreview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
    function seconds(value){
        var parts=String(value||'').trim().replace(',','.').split(':').map(Number);
        if(!parts.length||parts.some(function(part){return !Number.isFinite(part)||part<0;}))return NaN;
        return parts.reduce(function(total,part){return total*60+part;},0);
    }
    function imageCue(raw,start,end,base){
        var value=String(raw||'').trim().split(/\s+/)[0];
        start=typeof start==='number'?start:seconds(start);
        end=typeof end==='number'?end:seconds(end);
        if(!value||!(end>start))return null;
        var match=value.match(/#xywh=(\d+),(\d+),(\d+),(\d+)$/i);
        if(match)value=value.slice(0,match.index);
        var url;
        try{url=new URL(value,base);}catch(e){return null;}
        if(!/^https?:$/.test(url.protocol)||url.username||url.password)return null;
        return {start:start,end:end,url:url.href,rect:match?match.slice(1).map(Number):null};
    }
    function parseVtt(text,base){
        var cues=[];
        String(text||'').replace(/\r/g,'').split(/\n\s*\n/).forEach(function(block){
            var lines=block.trim().split('\n');
            var index=lines.findIndex(function(line){return line.indexOf('-->')!==-1;});
            if(index<0||!lines[index+1])return;
            var times=lines[index].split('-->');
            if(times.length!==2)return;
            var start=seconds(times[0]),end=seconds(times[1].trim().split(/\s+/)[0]);
            if(!Number.isFinite(start)||!Number.isFinite(end))return;
            var cue=imageCue(lines[index+1],start,end,base);
            if(cue)cues.push(cue);
        });
        return cues.sort(function(a,b){return a.start-b.start;});
    }
    function findCue(cues,time){
        var low=0,high=cues.length-1;
        while(low<=high){
            var middle=(low+high)>>1,cue=cues[middle];
            if(time<cue.start)high=middle-1;
            else if(time>=cue.end)low=middle+1;
            else return cue;
        }
        return null;
    }
    function create(options){
        var main=options.video,preview=options.preview,frame=options.frame,canvas=options.canvas;
        var context=canvas.getContext('2d',{willReadFrequently:true});
        var image=document.createElement('img');
        image.alt='';image.setAttribute('aria-hidden','true');image.hidden=true;
        image.style.cssText='position:absolute;left:0;top:0;max-width:none;pointer-events:none;';
        frame.appendChild(image);
        var source=null,cues=[],mode='none',aux=null,requested=NaN,seekTimer=0,idleTimer=0,loadTimer=0;
        var generation=0,queued=NaN,active=false,abort=null,vttTimer=0;
        var displayedCue=null,loadingCue=null;
        function blank(){
            frame.classList.remove('has-frame');preview.classList.add('dk-time-only');
            image.hidden=true;canvas.style.display='none';
        }
        function releaseAux(){
            clearTimeout(seekTimer);clearTimeout(loadTimer);clearTimeout(idleTimer);
            seekTimer=loadTimer=idleTimer=0;
            if(aux){aux.onloadedmetadata=aux.onseeked=aux.onloadeddata=aux.onerror=null;
                try{aux.pause();aux.removeAttribute('src');aux.load();}catch(e){}aux=null;}
        }
        function failAux(){mode='none';releaseAux();blank();}
        function showCue(cue,token){
            if(!cue){blank();return;}
            loadingCue=cue;
            var picture=new Image();
            picture.onload=function(){
                if(token!==generation||!active||mode!=='cues')return;
                var rect=cue.rect,width=frame.clientWidth,height=frame.clientHeight;
                if(rect&&rect[2]>0&&rect[3]>0){
                    var scale=Math.max(width/rect[2],height/rect[3]);
                    image.style.width=(picture.naturalWidth*scale)+'px';
                    image.style.height=(picture.naturalHeight*scale)+'px';
                    image.style.left=(-rect[0]*scale)+'px';image.style.top=(-rect[1]*scale)+'px';
                    image.style.objectFit='fill';
                }else{
                    image.style.width='100%';image.style.height='100%';
                    image.style.left='0';image.style.top='0';image.style.objectFit='cover';
                }
                image.src=picture.src;image.hidden=false;canvas.style.display='none';
                displayedCue=cue;loadingCue=null;
                frame.classList.add('has-frame');preview.classList.remove('dk-time-only');
            };
            picture.onerror=function(){if(token===generation){loadingCue=null;blank();}};
            picture.src=cue.url;
        }
        function drawAux(){
            if(!aux||!active||!Number.isFinite(requested)||aux.readyState<2)return;
            if(Math.abs(aux.currentTime-requested)>0.55){scheduleSeek();return;}
            try{
                context.drawImage(aux,0,0,canvas.width,canvas.height);
                // drawImage pode funcionar em canvas contaminado; esta leitura confirma CORS.
                context.getImageData(0,0,1,1);
                image.hidden=true;canvas.style.display='block';
                frame.classList.add('has-frame');preview.classList.remove('dk-time-only');
            }catch(e){canvas.width=canvas.width;context=canvas.getContext('2d',{willReadFrequently:true});failAux();}
        }
        function scheduleSeek(){
            if(mode!=='video'||!aux||aux.readyState<1||!Number.isFinite(requested))return;
            if(seekTimer||aux.seeking)return;
            seekTimer=setTimeout(function(){
                seekTimer=0;
                if(!aux||!active||mode!=='video'||aux.seeking)return;
                var duration=Number(aux.duration)||Number(main.duration)||0;
                if(!Number.isFinite(duration)||duration<=0){failAux();return;}
                var target=Math.max(0,Math.min(requested,duration-0.05));
                try{
                    if(Math.abs(aux.currentTime-target)<0.12){drawAux();return;}
                    aux.currentTime=target;
                    clearTimeout(loadTimer);
                    loadTimer=setTimeout(function(){if(aux&&aux.seeking)failAux();},4500);
                }catch(e){failAux();}
            },120);
        }
        function ensureAux(){
            if(aux||mode!=='video'||!source)return;
            aux=document.createElement('video');
            aux.preload='metadata';aux.muted=true;aux.playsInline=true;aux.crossOrigin='anonymous';
            aux.onloadedmetadata=function(){clearTimeout(loadTimer);scheduleSeek();};
            aux.onseeked=function(){clearTimeout(loadTimer);drawAux();};
            aux.onloadeddata=function(){if(!aux.seeking)drawAux();};
            aux.onerror=failAux;
            loadTimer=setTimeout(function(){if(aux&&aux.readyState<1)failAux();},7000);
            aux.src=source.url;
        }
        function previewAt(time){
            active=true;requested=Math.max(0,Number(time)||0);
            if(mode==='cues'){
                var cue=findCue(cues,requested);
                if(cue&&(cue===displayedCue||cue===loadingCue))return;
                generation++;displayedCue=null;loadingCue=null;blank();showCue(cue,generation);
            }
            else if(mode==='video'){
                generation++;blank();ensureAux();scheduleSeek();
            }
            else if(mode==='loading-vtt')queued=requested;
        }
        function hide(){
            active=false;generation++;displayedCue=null;loadingCue=null;clearTimeout(seekTimer);seekTimer=0;blank();
            clearTimeout(idleTimer);
            idleTimer=setTimeout(releaseAux,15000);
        }
        function setSource(next){
            generation++;active=false;requested=NaN;queued=NaN;
            displayedCue=null;loadingCue=null;clearTimeout(vttTimer);
            if(abort){abort.abort();abort=null;}
            releaseAux();blank();cues=[];source=next||null;
            if(!source||!source.url){mode='none';return;}
            var raw=source.previewThumbnails||source.timelineThumbnails;
            if(Array.isArray(raw)){
                cues=raw.map(function(item){return imageCue(item.url||item.src,item.start,item.end,source.url);}).filter(Boolean)
                    .sort(function(a,b){return a.start-b.start;});
                if(cues.length){mode='cues';return;}
            }
            function videoMode(){
                var type=String(source.type||'');
                var isStreaming=/mpegurl|dash\+xml/i.test(type)||/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(source.url);
                var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
                return !isStreaming&&!(connection&&connection.saveData)?'video':'none';
            }
            var vtt=source.previewVtt||source.thumbnailsVtt;
            if(vtt&&typeof fetch==='function'){
                var vttUrl;
                try{vttUrl=new URL(vtt,location.href);if(!/^https?:$/.test(vttUrl.protocol))throw Error();}
                catch(e){vttUrl=null;}
                if(vttUrl){
                    mode='loading-vtt';abort=new AbortController();
                    var current=source,signal=abort.signal;
                    vttTimer=setTimeout(function(){if(source===current&&abort)abort.abort();},6000);
                    fetch(vttUrl.href,{signal:signal,credentials:'same-origin'}).then(function(response){
                        if(!response.ok)throw Error('VTT '+response.status);
                        return response.text();
                    }).then(function(text){
                        if(source!==current)return;
                        clearTimeout(vttTimer);
                        cues=parseVtt(text,vttUrl.href);
                        mode=cues.length?'cues':videoMode();
                        if(active&&Number.isFinite(queued))previewAt(queued);
                    }).catch(function(){
                        if(source!==current)return;
                        clearTimeout(vttTimer);mode=videoMode();
                        if(active&&Number.isFinite(queued))previewAt(queued);
                    });
                    return;
                }
            }
            mode=videoMode();
        }
        function dispose(){clearTimeout(vttTimer);if(abort)abort.abort();releaseAux();blank();image.remove();source=null;mode='none';}
        blank();
        return {setSource:setSource,previewAt:previewAt,hide:hide,dispose:dispose};
    }
    return {create:create,parseVtt:parseVtt,findCue:findCue};
});
