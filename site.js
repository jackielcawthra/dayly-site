/* Everything the site needs at runtime. No dependencies, no requests.
   Kept small on purpose — the pages are readable with JavaScript off. */
(function(){
  'use strict';

  /* ---- analytics: one thin layer, so swapping GA for anything else is one edit */
  window.dataLayer = window.dataLayer || [];
  function track(name, params){
    window.dataLayer.push(Object.assign({ event: name }, params || {}));
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }
  window.daylyTrack = track;

  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-cta]');
    if (el) track('cta_click', { cta: el.getAttribute('data-cta'), href: el.getAttribute('href') || '', page: location.pathname });
    var aff = e.target.closest('[data-affiliate]');
    if (aff) track('affiliate_click', { product: aff.getAttribute('data-affiliate'), page: location.pathname });
  });

  /* ---- sticky CTA: appears once the reader is invested, never on arrival */
  var s = document.getElementById('scta');
  if (s){
    var dismissed = false;
    try { dismissed = localStorage.getItem('dayly.scta') === '1'; } catch(err){}
    if (dismissed) s.remove();
    else {
      var shown = false;
      var onScroll = function(){
        var h = document.documentElement;
        var pct = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
        if (!shown && pct > 0.32){ shown = true; s.hidden = false; s.classList.add('show'); track('sticky_cta_shown', { page: location.pathname }); }
      };
      addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  /* ---- article engagement: fires once at a quarter of the way down and at the end */
  if (document.querySelector('article.prose, .prose')){
    var marks = { 25:false, 50:false, 75:false, 100:false };
    addEventListener('scroll', function(){
      var h = document.documentElement;
      var pct = Math.round(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) * 100);
      [25,50,75,100].forEach(function(m){
        if (pct >= m && !marks[m]){ marks[m] = true; track('article_progress', { depth: m, page: location.pathname }); }
      });
    }, { passive: true });
  }

  /* ---- newsletter forms: no backend yet, so the promise is kept honestly */
  document.querySelectorAll('form[data-capture]').forEach(function(f){
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var email = (f.querySelector('input[type=email]') || {}).value || '';
      if (!email) return;
      track('newsletter_signup', { list: f.getAttribute('data-capture'), page: location.pathname });
      try { localStorage.setItem('dayly.email', email); } catch(err){}
      f.innerHTML = '<p style="font-size:16px"><strong>Check your inbox.</strong> The starter kit is on its way to ' +
        email.replace(/[<>&]/g,'') + '. It is eight templates, one email, no drip of nonsense.</p>';
    });
  });

  /* ---- copy-to-clipboard for generated lists */
  document.querySelectorAll('[data-copy]').forEach(function(b){
    b.addEventListener('click', function(){
      var src = document.querySelector(b.getAttribute('data-copy'));
      if (!src) return;
      var text = src.innerText.replace(/\n{3,}/g,'\n\n');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function(){
        var old = b.textContent; b.textContent = 'Copied'; setTimeout(function(){ b.textContent = old; }, 1600);
      }).catch(function(){});
    });
  });
})();
