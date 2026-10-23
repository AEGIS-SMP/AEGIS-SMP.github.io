/* Главная новость «Микроволновка»: кнопки «Поделиться» (24.09.2026).
   Делимся не главной, а event.html: у неё превью с постером ивента, а открывший
   ссылку сразу попадает на главную к ролику. Адрес берём от текущего домена —
   сайт живёт то на www, то на голом aegis-smp.com. */
(function () {
  var box = document.querySelector('.event-share');
  if (!box) return;
  var url = location.origin + '/event';
  var text = 'Ивент «Микроволновка» на AEGIS SMP: 57 игроков против пяти великанов — смотри ролик';
  var tg = box.querySelector('[data-share-tg]');
  var vk = box.querySelector('[data-share-vk]');
  if (tg) tg.href = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
  if (vk) vk.href = 'https://vk.com/share.php?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text);

  var btn = box.querySelector('[data-share]');
  var label = box.querySelector('[data-share-label]');
  var timer = 0;
  function flash(msg) {
    if (!label) return;
    label.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { label.textContent = 'Поделиться'; }, 2200);
  }
  function copy() {
    var done = function () { flash('Ссылка скопирована'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
    function fallback() {
      try {
        var t = document.createElement('textarea');
        t.value = url;
        t.setAttribute('readonly', '');
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        t.remove();
        done();
      } catch (e) { prompt('Скопируй ссылку:', url); }
    }
  }
  if (btn) btn.addEventListener('click', function () {
    // На телефоне — системное меню «Поделиться» (мессенджеры, соцсети); где его нет — копируем ссылку.
    if (navigator.share) {
      navigator.share({ title: 'Ивент «Микроволновка» — AEGIS SMP', text: text, url: url })
        .catch(function (e) { if (!e || e.name !== 'AbortError') copy(); });
    } else copy();
  });
})();
