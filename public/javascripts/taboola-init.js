// Taboola Ad Initialization (qqw-poppins)
(function() {
  'use strict';

  function isTaboolaEnabled() {
    return typeof window.TABOOLA_ENABLED !== 'undefined' &&
           window.TABOOLA_ENABLED === 'true';
  }

  var taboolaScriptLoaded = false;

  function loadTaboolaScript() {
    if (taboolaScriptLoaded) return;
    var loaderUrl = (window.TABOOLA_LOADER_URL || '//cdn.taboola.com/libtrc/abrimosinfo/loader.js');
    !function (e, f, u, i) {
      if (!document.getElementById(i)) {
        e.async = 1;
        e.src = u;
        e.id = i;
        f.parentNode.insertBefore(e, f);
      }
    }(document.createElement('script'),
    document.getElementsByTagName('script')[0],
    loaderUrl,
    'tb_loader_script');
    taboolaScriptLoaded = true;
  }

  function setupTaboolaContainer() {
    var container = document.getElementById('ad-container-taboola-below-article-thumbnails');
    if (container) {
      var gamDiv = container.querySelector('.gpt-ad');
      if (gamDiv) {
        gamDiv.className = 'taboola-below-article-thumbnails';
        gamDiv.id = 'taboola-below-article-thumbnails';
      }
      return true;
    }
    if (document.getElementById('taboola-below-article-thumbnails')) return true;
    return false;
  }

  function initializeTaboola() {
    if (!isTaboolaEnabled() || !setupTaboolaContainer()) return;
    var adContainer = document.getElementById('taboola-below-article-thumbnails');
    if (!adContainer) return;
    loadTaboolaScript();
    window._taboola = window._taboola || [];
    window._taboola.push({article: 'auto'});
    window._taboola.push({
      mode: 'alternating-thumbnails-a',
      container: 'taboola-below-article-thumbnails',
      placement: 'Below Article Thumbnails',
      target_type: 'mix'
    });
    var section = document.getElementById('taboola-advertising-section');
    var wrap = document.getElementById('ad-container-taboola-below-article-thumbnails');
    if (section) section.style.display = 'block';
    if (wrap) wrap.style.display = 'block';
    setTimeout(function() {
      window._taboola = window._taboola || [];
      window._taboola.push({flush: true});
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTaboola);
  } else {
    initializeTaboola();
  }
})();
