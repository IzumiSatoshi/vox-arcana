// A single control can browse languages by click or narrow them by typing.
export function filterLanguages(languages, query) {
  const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const needle = fold(query.trim());
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  const aliases = { zh: 'mandarin', ja: 'nihongo', ko: 'hangul', hi: 'hindi', pt: 'brazilian portuguese' };
  return Object.entries(languages).filter(([code, name]) => {
    const base = code.split('-')[0];
    return !needle || [code, name, english.of(base), aliases[base] || ''].some(value => fold(value).includes(needle));
  });
}

export function bindLanguagePicker({ input, toggle, list, languages, value, onSelect, normalizeCustom, invalidMessage }) {
  let selected = value, matches = [], active = 0, open = false;
  const label = code => languages[code] || code;
  const display = code => code in languages ? `${label(code)} · ${code}` : code;

  function setValue(code) { selected = code; input.value = display(code); input.setCustomValidity(''); }
  function close(restore = false) {
    open = false; list.hidden = true; input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restore) setValue(selected);
  }
  function choose(code, focus = true) { setValue(code); close(); onSelect(code); if (focus) input.focus(); }
  function exactCode(text) {
    const sought = text.toLocaleLowerCase();
    return Object.entries(languages).find(([code, name]) =>
      [code, name, display(code)].some(value => value.toLocaleLowerCase() === sought))?.[0];
  }
  function finish() {
    if (!open && input.value === display(selected)) return;
    const code = exactCode(input.value) || normalizeCustom?.(input.value);
    if (code) choose(code, false);
    else close(true);
  }
  function render(query = '') {
    matches = filterLanguages(languages, query).map(([code, name]) => ({ code, name }));
    const custom = normalizeCustom?.(query);
    if (custom && !(custom in languages) && !matches.some(item => item.code === custom)) {
      matches.unshift({ code: custom, name: custom });
    }
    active = Math.min(active, Math.max(0, matches.length - 1));
    list.replaceChildren(...matches.map(({ code, name }, index) => {
      const option = document.createElement('button');
      option.type = 'button'; option.role = 'option'; option.id = `${list.id}-option-${index}`;
      option.dataset.code = code; option.textContent = `${name} · ${code}`;
      option.setAttribute('aria-selected', String(code === selected));
      option.addEventListener('click', () => choose(code));
      return option;
    }));
    list.hidden = false; open = true; input.setAttribute('aria-expanded', 'true');
    updateActive();
  }
  function updateActive() {
    const options = [...list.children];
    options.forEach((option, index) => option.classList.toggle('active', index === active));
    if (options[active]) {
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  toggle.addEventListener('click', () => {
    if (open) close(true);
    else { input.focus(); input.value = ''; active = 0; render(); }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('click', () => { if (!open) { input.value = ''; active = 0; render(); } });
  input.addEventListener('input', () => { input.setCustomValidity(''); active = 0; render(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (!open) render();
      else { active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1); updateActive(); }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const exact = exactCode(input.value);
      const custom = normalizeCustom?.(input.value);
      const code = exact || (open && matches[active]?.code) || custom;
      if (code) choose(code);
      else { input.setCustomValidity(invalidMessage()); input.reportValidity(); }
    }
  });
  input.addEventListener('focusout', event => {
    if (event.relatedTarget && (list.contains(event.relatedTarget) || event.relatedTarget === toggle)) return;
    finish();
  });
  document.addEventListener('pointerdown', event => { if (!input.parentElement.contains(event.target)) finish(); });
  setValue(value);
  return { setValue, getValue: () => selected };
}
