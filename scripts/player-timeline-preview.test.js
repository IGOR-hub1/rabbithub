const test=require('node:test');
const assert=require('node:assert/strict');
const timeline=require('../public/player-timeline-preview.js');

function classes(){
    const values=new Set();
    return {add:name=>values.add(name),remove:name=>values.delete(name),contains:name=>values.has(name)};
}
function fixture(tainted){
    const draws=[];
    const frame={classList:classes(),clientWidth:160,clientHeight:90,appendChild(node){this.image=node;}};
    const preview={classList:classes()};
    const canvas={width:320,height:180,style:{},getContext(){return context;}};
    const context={drawImage(video){draws.push(video.currentTime);},getImageData(){if(tainted)throw Error('SecurityError');return [0];}};
    const main={currentTime:25,duration:60};
    return {draws,frame,preview,canvas,main};
}
function installBrowser(){
    const original={document:global.document,Image:global.Image,navigator:global.navigator,location:global.location,fetch:global.fetch};
    const auxiliaries=[];
    class FakeVideo{
        constructor(){this.readyState=0;this.duration=60;this.seeking=false;this._time=0;this._src='';}
        set src(value){this._src=value;setTimeout(()=>{if(!this._src)return;this.readyState=2;this.onloadedmetadata?.();},0);}
        get src(){return this._src;}
        set currentTime(value){this._time=value;this.seeking=true;setTimeout(()=>{this.seeking=false;this.onseeked?.();},0);}
        get currentTime(){return this._time;}
        setAttribute(){}removeAttribute(){this._src='';}load(){}pause(){}
    }
    class FakeImage{
        constructor(){this.naturalWidth=320;this.naturalHeight=90;this.style={};this.hidden=true;}
        set src(value){this._src=value;setTimeout(()=>this.onload?.(),0);}
        get src(){return this._src;}
        setAttribute(){}remove(){}
    }
    global.document={createElement(kind){
        if(kind==='video'){const video=new FakeVideo();auxiliaries.push(video);return video;}
        return new FakeImage();
    }};
    global.Image=FakeImage;
    Object.defineProperty(global,'navigator',{configurable:true,value:{connection:{saveData:false}}});
    global.location={href:'https://example.test/player-animes.html'};
    return {auxiliaries,restore(){
        for(const [name,value] of Object.entries(original)){
            if(value===undefined)delete global[name];
            else Object.defineProperty(global,name,{configurable:true,writable:true,value});
        }
    }};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('preview de MP4 captura tempos anteriores e posteriores sem alterar o vídeo principal',async()=>{
    const browser=installBrowser(),ui=fixture(false);
    try{
        const player=timeline.create({video:ui.main,preview:ui.preview,frame:ui.frame,canvas:ui.canvas});
        player.setSource({url:'https://example.test/episode.mp4',type:'video/mp4'});
        player.previewAt(10);
        await wait(180);
        assert.equal(ui.draws.at(-1),10);
        assert.equal(ui.main.currentTime,25);
        assert.equal(ui.frame.classList.contains('has-frame'),true);
        player.previewAt(40);
        await wait(180);
        assert.equal(ui.draws.at(-1),40);
        assert.equal(ui.main.currentTime,25);
        assert.equal(browser.auxiliaries.length,1);
        player.dispose();
    }finally{browser.restore();}
});

test('WebVTT usa imagens diferentes por posição mesmo em HLS',async()=>{
    const browser=installBrowser(),ui=fixture(false);
    const previousFetch=global.fetch;
    global.fetch=async()=>({ok:true,text:async()=>`WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nsprite.jpg#xywh=0,0,160,90\n\n00:00:30.000 --> 00:01:00.000\nsprite.jpg#xywh=160,0,160,90`});
    try{
        const player=timeline.create({video:ui.main,preview:ui.preview,frame:ui.frame,canvas:ui.canvas});
        player.setSource({url:'https://example.test/episode.m3u8',type:'application/vnd.apple.mpegurl',previewVtt:'https://example.test/thumbs.vtt'});
        await wait(5);
        player.previewAt(10);
        await wait(5);
        assert.equal(ui.frame.image.style.left,'0px');
        player.previewAt(40);
        await wait(5);
        assert.equal(ui.frame.image.style.left,'-160px');
        assert.equal(ui.main.currentTime,25);
        assert.equal(browser.auxiliaries.length,0);
        player.dispose();
    }finally{global.fetch=previousFetch;browser.restore();}
});

test('CORS bloqueado e HLS sem miniaturas exibem somente o tempo',async()=>{
    const browser=installBrowser(),ui=fixture(true);
    try{
        const player=timeline.create({video:ui.main,preview:ui.preview,frame:ui.frame,canvas:ui.canvas});
        player.setSource({url:'https://example.test/episode.mp4',type:'video/mp4'});
        player.previewAt(40);
        await wait(180);
        assert.equal(ui.frame.classList.contains('has-frame'),false);
        assert.equal(ui.preview.classList.contains('dk-time-only'),true);
        player.setSource({url:'https://example.test/episode.m3u8',type:'application/vnd.apple.mpegurl'});
        player.previewAt(10);
        await wait(10);
        assert.equal(ui.frame.classList.contains('has-frame'),false);
        assert.equal(ui.main.currentTime,25);
        player.dispose();
    }finally{browser.restore();}
});
