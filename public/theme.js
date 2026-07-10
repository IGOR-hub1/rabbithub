/* =====================================================================
 * DRAKSYON • Sistema de tema (cor principal)
 * ---------------------------------------------------------------------
 * Mantém o tema escuro e permite trocar apenas a cor de destaque.
 * Salva a escolha em localStorage ("dk_theme_color").
 * Ao trocar o tema o site é recarregado para reaplicar tudo.
 * Também troca a logo de acordo com a cor escolhida.
 * ===================================================================== */
(function(){
  var THEMES = {
    blue:   { name:'Azul',    brand:'#254BFF', brand2:'#3A56F6', light:'#5B7FFF', rgb:'37,75,255',  logo:'img/logo-blue.jpg'   },
    purple: { name:'Roxo',    brand:'#7C3AED', brand2:'#8B5CF6', light:'#A78BFA', rgb:'124,58,237', logo:'img/logo-purple.jpg' },
    red:    { name:'Vermelho',brand:'#DC2626', brand2:'#EF4444', light:'#F87171', rgb:'220,38,38',  logo:'img/logo-red.jpg'    },
    green:  { name:'Verde',   brand:'#16A34A', brand2:'#22C55E', light:'#4ADE80', rgb:'22,163,74',  logo:'img/logo-green.jpg'  },
    orange: { name:'Laranja', brand:'#EA580C', brand2:'#F97316', light:'#FB923C', rgb:'234,88,12',  logo:'img/logo-orange.jpg' },
    pink:   { name:'Rosa',    brand:'#DB2777', brand2:'#EC4899', light:'#F472B6', rgb:'219,39,119', logo:'img/logo-pink.jpg'   },
    cyan:   { name:'Ciano',   brand:'#0891B2', brand2:'#06B6D4', light:'#22D3EE', rgb:'8,145,178',  logo:'img/logo-cyan.jpg'   },
    yellow: { name:'Amarelo', brand:'#CA8A04', brand2:'#EAB308', light:'#FACC15', rgb:'202,138,4',  logo:'img/logo-yellow.jpg' }
  };

  function apply(key){
    var t = THEMES[key] || THEMES.blue;
    var r = document.documentElement.style;
    r.setProperty('--brand', t.brand);
    r.setProperty('--brand-2', t.brand2);
    r.setProperty('--brand-light', t.light);
    r.setProperty('--brand-soft',   'rgba(' + t.rgb + ',0.12)');
    r.setProperty('--brand-soft-2', 'rgba(' + t.rgb + ',0.20)');
    r.setProperty('--brand-glow',   'rgba(' + t.rgb + ',0.35)');
    r.setProperty('--grad-brand',      'linear-gradient(90deg,' + t.brand + ',' + t.brand2 + ')');
    r.setProperty('--grad-brand-135',  'linear-gradient(135deg,'+ t.brand + ',' + t.brand2 + ')');
    r.setProperty('--grad-brand-anim', 'linear-gradient(90deg,' + t.brand + ',' + t.brand2 + ',' + t.light + ',' + t.brand2 + ',' + t.brand + ')');
    r.setProperty('--shadow-brand',        '0 8px 24px rgba(' + t.rgb + ',0.35)');
    r.setProperty('--shadow-brand-strong', '0 12px 32px rgba(' + t.rgb + ',0.55)');
    r.setProperty('--dk-logo-url', 'url("' + t.logo + '")');

    // Atualiza todas as imagens marcadas com data-dk-logo
    try {
      var imgs = document.querySelectorAll('img[data-dk-logo]');
      for (var i=0;i<imgs.length;i++) imgs[i].src = t.logo;
    } catch(e){}
  }

  window.DK_THEMES = THEMES;
  window.DK_getTheme = function(){ try { return localStorage.getItem('dk_theme_color') || 'blue'; } catch(e){ return 'blue'; } };
  window.DK_getLogoUrl = function(key){
    var t = THEMES[key || window.DK_getTheme()] || THEMES.blue;
    return t.logo;
  };
  window.DK_setTheme = function(key, opts){
    if (!THEMES[key]) key = 'blue';
    var prev;
    try { prev = localStorage.getItem('dk_theme_color'); } catch(e){}
    try { localStorage.setItem('dk_theme_color', key); } catch(e){}
    apply(key);
    // Se a cor mudou, recarrega para reaplicar tudo de uma vez
    if (prev !== key && !(opts && opts.silent)) {
      setTimeout(function(){ try { location.reload(); } catch(e){} }, 120);
    }
  };

  // Aplica imediatamente (o script está no <head>)
  apply(window.DK_getTheme());

  // Reaplica também quando o DOM estiver pronto (para trocar <img data-dk-logo>)
  document.addEventListener('DOMContentLoaded', function(){ apply(window.DK_getTheme()); });
})();
