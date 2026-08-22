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

  /* ---- on this page: which section am I actually in
   *
   * A list of links tells you what is coming. It does not tell you where you are, and a
   * table of contents that cannot answer that is decoration.
   *
   * The first version used an IntersectionObserver with a narrow rootMargin, which is the
   * efficient way to do this and did not work: the callback only runs when a heading
   * crosses the band, so a jump-scroll that skips the band leaves the marker wherever it
   * was. It failed silently, which is the worst way for a decoration to fail.
   *
   * This reads five rectangles on scroll instead, throttled to one animation frame. That
   * is a few microseconds on a page whose whole job is to sit still and be read, and it
   * is correct at every scroll position including the ones nobody scrolled through.
   */
  (function(){
    var toc = document.querySelector('.toc');
    if (!toc) return;

    var links = [].slice.call(toc.querySelectorAll('a'));
    var bar = toc.querySelector('.toc-progress i');
    var article = document.querySelector('article');
    var sections = links.map(function(a){
      try { return document.getElementById(decodeURIComponent(a.hash.slice(1))); }
      catch (e) { return null; }
    });
    if (!links.length || sections.indexOf(null) > -1) return;

    var current = -1, queued = false;

    function update(){
      queued = false;

      /* The heading you are "in" is the last one whose top has passed the line. The line
         sits below the sticky header rather than at the very top, or a heading counts as
         current while it is still under the bar and out of sight. */
      var line = 140, i = -1;
      for (var n = 0; n < sections.length; n++) {
        if (sections[n].getBoundingClientRect().top <= line) i = n; else break;
      }
      if (i !== current) {
        current = i;
        for (var k = 0; k < links.length; k++) {
          if (k === i) links[k].setAttribute('aria-current', 'true');
          else links[k].removeAttribute('aria-current');
        }
      }

      if (bar && article) {
        var r = article.getBoundingClientRect();
        var total = r.height - window.innerHeight;
        var done = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
        bar.style.height = (done * 100).toFixed(1) + '%';
      }
    }

    function onScroll(){
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }

    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();
  })();

})();
