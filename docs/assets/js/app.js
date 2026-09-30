/* SYC study site — small progressive enhancements (no dependencies).
   Everything works without JavaScript too: theme = light, cheat sheet = section at the end of the page. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var ui = window.SYC_UI || { copy: 'Copy', copied: 'Copied!', copyFail: 'Copy failed' };

  var store = {
    get: function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set: function (key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
    del: function (key) { try { localStorage.removeItem(key); } catch (e) { /* private mode */ } }
  };

  function each(selector, fn, scope) {
    Array.prototype.forEach.call((scope || doc).querySelectorAll(selector), fn);
  }

  /* ---------- theme ---------- */
  each('[data-theme-toggle]', function (button) {
    button.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('syc-theme', next);
    });
  });

  /* ---------- mobile navigation ---------- */
  each('[data-nav-toggle]', function (button) {
    var nav = doc.getElementById(button.getAttribute('aria-controls'));
    button.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      button.setAttribute('aria-expanded', String(open));
    });
  });

  /* ---------- copy code ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      area.select();
      try { doc.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      doc.body.removeChild(area);
    });
  }

  doc.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-copy]');
    if (!button) return;
    var code = button.closest('.code').querySelector('.code__body');
    var done = function (label, ok) {
      button.textContent = label;
      button.classList.toggle('code__copy--done', ok);
      setTimeout(function () { button.textContent = ui.copy; button.classList.remove('code__copy--done'); }, 1800);
    };
    copyText(code.textContent).then(function () { done(ui.copied, true); }, function () { done(ui.copyFail, false); });
  });

  /* ---------- cheat sheet in a modal ---------- */
  var modal = doc.querySelector('[data-modal]');
  var cheat = doc.querySelector('[data-cheat]');
  if (modal && cheat && typeof modal.showModal === 'function') {
    cheat.classList.add('cheat--in-modal');
    modal.querySelector('[data-modal-body]').appendChild(cheat);
    var openCheat = function (event) {
      if (event) event.preventDefault();
      if (!modal.open) modal.showModal();
    };
    each('[data-cheat-open]', function (link) { link.addEventListener('click', openCheat); });
    each('.fab', function (fab) { fab.classList.add('fab--visible'); });
    modal.querySelector('[data-modal-close]').addEventListener('click', function () { modal.close(); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.close(); });
    if (location.hash === '#cheat') openCheat();
  }

  /* ---------- image lightbox ---------- */
  var lightbox = doc.querySelector('[data-lightbox]');
  if (lightbox && typeof lightbox.showModal === 'function') {
    var bigImage = lightbox.querySelector('[data-lightbox-img]');
    var bigCaption = lightbox.querySelector('[data-lightbox-caption]');
    doc.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('[data-zoom]');
      if (!link) return;
      event.preventDefault();
      var figure = link.closest('.figure');
      var caption = figure && figure.querySelector('.figure__caption');
      bigImage.src = link.getAttribute('href');
      bigImage.alt = link.querySelector('img').alt;
      bigCaption.textContent = caption ? caption.textContent : '';
      lightbox.showModal();
    });
    lightbox.addEventListener('click', function () { lightbox.close(); });
  }

  /* ---------- table of contents: highlight the current section ---------- */
  var tocLinks = {};
  each('.toc__link', function (link) { tocLinks[link.getAttribute('href').slice(1)] = link; });
  var headings = doc.querySelectorAll('.article__h2[id], .cheat--inline[id]');
  if (headings.length && 'IntersectionObserver' in window) {
    var current = null;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var link = tocLinks[entry.target.id];
        if (!link) return;
        if (current) current.classList.remove('toc__link--active');
        link.classList.add('toc__link--active');
        current = link;
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    Array.prototype.forEach.call(headings, function (h) { observer.observe(h); });
  }

  /* ---------- semester schedule: compute dates week by week ---------- */
  each('[data-schedule]', function (box) {
    var locale = box.getAttribute('data-locale') || 'pl';
    var format = function (date) {
      return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };
    var fill = function (kind, value) {
      each('[data-date="' + kind + '"]', function (cell) {
        if (!value) { cell.textContent = ''; return; }
        var parts = value.split('-');
        var date = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        date.setDate(date.getDate() + 7 * (parseInt(cell.getAttribute('data-week'), 10) - 1));
        cell.textContent = format(date);
      }, box);
    };
    each('[data-start]', function (input) {
      var kind = input.getAttribute('data-start');
      var saved = store.get('syc-start-' + kind);
      if (saved) { input.value = saved; fill(kind, saved); }
      input.addEventListener('change', function () {
        if (input.value) store.set('syc-start-' + kind, input.value); else store.del('syc-start-' + kind);
        fill(kind, input.value);
      });
    }, box);
    each('[data-schedule-clear]', function (button) {
      button.addEventListener('click', function () {
        each('[data-start]', function (input) {
          input.value = '';
          store.del('syc-start-' + input.getAttribute('data-start'));
          fill(input.getAttribute('data-start'), '');
        }, box);
      });
    }, box);
  });

  /* ---------- print ---------- */
  each('[data-print]', function (button) {
    button.addEventListener('click', function () { window.print(); });
  });
})();
