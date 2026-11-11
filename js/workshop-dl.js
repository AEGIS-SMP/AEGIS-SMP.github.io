/* Кнопка «Скачать Мастерскую» на главной (#workshop) и в donate.html#workshop.
   В разметке стоит прямая ссылка на архив из релиза ws (AEGIS-SMP/launcher на GitHub), поэтому
   кнопка работает и без этого скрипта. Скрипт, когда кнопка подходит к экрану, спрашивает у GitHub
   список файлов релиза и ставит на кнопку самый свежий архив AEGIS-Workshop-win-<sha256>.zip,
   а в подпись [data-ws-size] — его размер: новый выпуск Мастерской подхватывается без правки сайта.
   GitHub не ответил или ответил не то — остается ссылка из разметки. */
(function () {
  'use strict';
  var links = document.querySelectorAll('a[data-ws-dl]');
  if (!links.length || !window.fetch) return;

  var API = 'https://api.github.com/repos/AEGIS-SMP/launcher/releases/tags/ws';
  var BASE = 'https://github.com/AEGIS-SMP/launcher/releases/download/ws/';
  var NAME = /^AEGIS-Workshop-win-[0-9a-f]{64}\.zip$/;
  var started = false;

  function newest(assets) {
    var best = null;
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a || a.state !== 'uploaded' || !NAME.test(String(a.name))) continue;
      if (a.browser_download_url !== BASE + a.name) continue;
      if (!best || String(a.created_at) > String(best.created_at)) best = a;
    }
    return best;
  }

  function apply(a) {
    var i;
    for (i = 0; i < links.length; i++) links[i].href = a.browser_download_url;
    if (a.size > 0) {
      var text = Math.max(1, Math.round(a.size / 1048576)) + ' МБ';
      var out = document.querySelectorAll('[data-ws-size]');
      for (i = 0; i < out.length; i++) out[i].textContent = text;
    }
  }

  function load() {
    if (started) return;
    started = true;
    fetch(API).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (rel) {
      var a = rel && rel.assets ? newest(rel.assets) : null;
      if (a) apply(a);
    }).catch(function () {});
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); load(); return; }
      }
    }, { rootMargin: '600px 0px' });
    for (var k = 0; k < links.length; k++) io.observe(links[k]);
  } else {
    load();
  }
})();
