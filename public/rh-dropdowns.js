/* X-Bunny Animes \u2022 camada de dropdown reutiliz\u00e1vel.
   Mant\u00e9m o select original como fonte de verdade: qualquer listener de
   change, valida\u00e7\u00e3o e submit que j\u00e1 existia continua funcionando. */
(function () {
  'use strict';

  var active = null;
  var uid = 0;
  var scheduled = false;

  function optionFor(select) {
    return select.options[select.selectedIndex] || select.options[0] || null;
  }

  function isDisabled(option) {
    return !option || option.disabled || (option.parentElement && option.parentElement.disabled);
  }

  function sanitizeClass(value) {
    return String(value || '').replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '');
  }

  function close(instance, restoreFocus) {
    if (!instance || !instance.open) return;
    instance.open = false;
    instance.wrap.classList.remove('is-open');
    instance.trigger.setAttribute('aria-expanded', 'false');
    instance.menu.hidden = true;
    instance.wrap.appendChild(instance.menu);
    instance.menu.removeAttribute('style');
    if (active === instance) active = null;
    if (restoreFocus) instance.trigger.focus();
  }

  function closeActive(restoreFocus) {
    if (active) close(active, restoreFocus);
  }

  function positionMenu(instance) {
    var rect = instance.trigger.getBoundingClientRect();
    var gap = 8;
    var availableBelow = window.innerHeight - rect.bottom - gap;
    var availableAbove = rect.top - gap;
    var showAbove = availableBelow < 150 && availableAbove > availableBelow;
    var maxHeight = Math.max(110, Math.min(300, showAbove ? availableAbove : availableBelow));
    /* O menu acompanha a maior opção em vez de herdar uma largura fixa
       do gatilho. Em telas estreitas o limite da viewport mantém tudo
       visível e o ellipsis é usado somente como último recurso. */
    instance.menu.style.position = 'fixed';
    instance.menu.style.zIndex = '2147483600';
    instance.menu.style.pointerEvents = 'auto';
    instance.menu.style.width = 'max-content';
    instance.menu.style.minWidth = Math.max(118, rect.width) + 'px';
    instance.menu.style.maxWidth = Math.max(118, window.innerWidth - 16) + 'px';
    var menuWidth = Math.min(window.innerWidth - 16, Math.max(118, instance.menu.getBoundingClientRect().width));
    instance.menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)) + 'px';
    instance.menu.style.maxHeight = maxHeight + 'px';
    if (showAbove) {
      instance.menu.style.top = Math.max(8, rect.top - maxHeight - gap) + 'px';
      instance.menu.classList.add('is-above');
    } else {
      instance.menu.style.top = Math.min(window.innerHeight - 8, rect.bottom + gap) + 'px';
      instance.menu.classList.remove('is-above');
    }
  }

  function focusOption(instance, offset) {
    var buttons = Array.prototype.slice.call(instance.menu.querySelectorAll('.rh-select__option:not(:disabled)'));
    if (!buttons.length) return;
    var current = document.activeElement;
    var index = buttons.indexOf(current);
    if (index < 0) index = buttons.findIndex(function (button) { return button.getAttribute('aria-selected') === 'true'; });
    if (index < 0) index = 0;
    if (offset === 'first') index = 0;
    else if (offset === 'last') index = buttons.length - 1;
    else index = (index + offset + buttons.length) % buttons.length;
    buttons[index].focus();
  }

  function open(instance, focusMode) {
    if (instance.select.disabled || !instance.select.options.length) return;
    if (active && active !== instance) close(active, false);
    sync(instance);
    instance.open = true;
    active = instance;
    instance.wrap.classList.add('is-open');
    instance.trigger.setAttribute('aria-expanded', 'true');
    document.body.appendChild(instance.menu);
    instance.menu.hidden = false;
    positionMenu(instance);
    /* Recalculates after it is visible so desktop browsers measure the true
       option width and place the clickable menu above overlays/transforms. */
    window.requestAnimationFrame(function(){
      if (instance.open) positionMenu(instance);
    });
    if (focusMode === 'first') focusOption(instance, 'first');
    if (focusMode === 'last') focusOption(instance, 'last');
    if (focusMode === 'selected') focusOption(instance, 0);
  }

  function emit(element, type) {
    var event;
    try { event = new Event(type, { bubbles: true }); }
    catch (_) {
      event = document.createEvent('Event');
      event.initEvent(type, true, false);
    }
    element.dispatchEvent(event);
  }

  function setValue(instance, option) {
    if (isDisabled(option)) return;
    var previous = instance.select.value;
    var previousIndex = instance.select.selectedIndex;
    // selectedIndex funciona também quando duas opções têm o mesmo
    // value e evita WebViews que não refletem select.value imediatamente.
    instance.select.selectedIndex = option.index;
    option.selected = true;
    close(instance, true);
    if (previous !== instance.select.value || previousIndex !== instance.select.selectedIndex) {
      emit(instance.select, 'input');
      emit(instance.select, 'change');
    }
    sync(instance);
  }

  function emit(element, type) {
    var event;
    try { event = new Event(type, { bubbles: true }); }
    catch (error) {
      event = document.createEvent('Event');
      event.initEvent(type, true, false);
    }
    element.dispatchEvent(event);
  }

  function sync(instance) {
    if (!instance || !instance.select.isConnected) return;
    var select = instance.select;
    var current = optionFor(select);
    instance.trigger.disabled = !!select.disabled || !select.options.length;
    instance.trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Selecionar op\u00e7\u00e3o');
    instance.value.textContent = current ? current.textContent.trim() : 'Nenhuma op\u00e7\u00e3o';
    instance.menu.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (option, index) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'rh-select__option';
      item.id = instance.menu.id + '-option-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', option === current ? 'true' : 'false');
      item.textContent = option.textContent.trim() || 'Sem r\u00f3tulo';
      item.disabled = isDisabled(option);
      item.addEventListener('click', function () { setValue(instance, option); });
      item.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(instance, 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); focusOption(instance, -1); }
        else if (event.key === 'Home') { event.preventDefault(); focusOption(instance, 'first'); }
        else if (event.key === 'End') { event.preventDefault(); focusOption(instance, 'last'); }
        else if (event.key === 'Escape') { event.preventDefault(); close(instance, true); }
      });
      instance.menu.appendChild(item);
    });
  }

  function create(select) {
    if (!select || select.dataset.rhDropdownReady === '1' || select.multiple) return;
    var parent = select.parentNode;
    if (!parent) return;
    var wrap = document.createElement('span');
    var classNames = Array.prototype.slice.call(select.classList);
    wrap.className = 'rh-select';
    classNames.forEach(function (name) {
      var safe = sanitizeClass(name);
      if (safe) wrap.classList.add('rh-select--' + safe);
    });
    var menu = document.createElement('div');
    var trigger = document.createElement('button');
    var value = document.createElement('span');
    var chevron = document.createElement('span');
    var menuId = 'rh-select-menu-' + (++uid);
    var originalTabIndex = select.getAttribute('tabindex');

    select.dataset.rhDropdownReady = '1';
    select.classList.add('rh-native-select');
    select.setAttribute('tabindex', '-1');
    parent.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    parent.classList.add('rh-select-host');

    trigger.type = 'button';
    trigger.className = 'rh-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', menuId);
    value.className = 'rh-select__value';
    chevron.className = 'rh-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(value);
    trigger.appendChild(chevron);
    menu.id = menuId;
    menu.className = 'rh-select__menu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');

    var instance = { select: select, wrap: wrap, trigger: trigger, value: value, menu: menu, open: false, originalTabIndex: originalTabIndex };
    select._rhDropdown = instance;
    sync(instance);

    trigger.addEventListener('click', function () { instance.open ? close(instance, false) : open(instance); });
    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); open(instance, 'selected'); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); open(instance, 'last'); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); instance.open ? close(instance, false) : open(instance, 'selected'); }
      else if (event.key === 'Escape' && instance.open) { event.preventDefault(); close(instance, false); }
    });
    select.addEventListener('change', function () { sync(instance); });
    select.addEventListener('input', function () { sync(instance); });
    select.addEventListener('focus', function () { trigger.focus(); });
    select.form && select.form.addEventListener('reset', function () { window.setTimeout(function () { sync(instance); }, 0); });
    new MutationObserver(function () { sync(instance); }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
  }

  function scan(root) {
    if (!root) return;
    if (root.matches && root.matches('select')) {
      if (root._rhDropdown) sync(root._rhDropdown);
      else create(root);
    }
    if (root.querySelectorAll) root.querySelectorAll('select').forEach(function (select) {
      if (select._rhDropdown) sync(select._rhDropdown);
      else create(select);
    });
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () { scheduled = false; scan(document); });
  }

  document.addEventListener('pointerdown', function (event) {
    if (active && !active.wrap.contains(event.target) && !active.menu.contains(event.target)) close(active, false);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && active) close(active, true);
  });
  window.addEventListener('resize', function () { closeActive(false); });
  window.addEventListener('scroll', function () { closeActive(false); }, true);

  window.RabbitHubDropdowns = {
    refresh: function (root) { scan(root || document); },
    close: closeActive
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleScan);
  else scheduleScan();
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
}());
