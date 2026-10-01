/* Reusable Price Market listbox dropdown. Keep the native select as the form value source. */
(() => {
  function createPmDropdown(select, config) {
    const { root, trigger, listbox, value } = config;
    const required = config.required ?? select.required;
    let activeIndex = Math.max(0, select.selectedIndex);
    let typeAhead = '';
    let typeAheadTimer;

    root.dataset.selectId = select.id;
    root.dataset.required = String(required);
    if (required) select.removeAttribute('required');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', listbox.id);
    trigger.setAttribute('aria-autocomplete', 'none');

    const options = [...select.options].map((option, index) => {
      const node = document.createElement('div');
      node.className = 'pm-dropdown-option';
      node.id = listbox.id + '-option-' + index;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.dataset.value = option.value;
      node.textContent = option.textContent.trim();
      listbox.append(node);
      return node;
    });

    let error = null;
    if (required) {
      error = document.createElement('span');
      error.className = 'pm-dropdown-error';
      error.id = root.id + '-error';
      error.setAttribute('role', 'alert');
      error.textContent = config.requiredMessage || 'Choose an option to continue.';
      error.hidden = true;
      root.append(error);
      trigger.setAttribute('aria-required', 'true');
      trigger.setAttribute('aria-describedby', error.id);
    }

    const isOpen = () => root.dataset.open === 'true';
    const selectedIndex = () => Math.max(0, select.selectedIndex);

    function updateActiveDescendant() {
      options.forEach((option, index) => option.classList.toggle('is-active', isOpen() && index === activeIndex));
      if (isOpen()) trigger.setAttribute('aria-activedescendant', options[activeIndex].id);
      else trigger.removeAttribute('aria-activedescendant');
    }

    function sync() {
      const selected = selectedIndex();
      value.textContent = select.options[selected].textContent.trim();
      options.forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
      if (!isOpen()) activeIndex = selected;
      if (error) {
        const invalid = root.dataset.validationAttempted === 'true' && !select.value;
        error.hidden = !invalid;
        trigger.setAttribute('aria-invalid', String(invalid));
      }
      updateActiveDescendant();
    }

    function open(index = selectedIndex()) {
      activeIndex = index;
      root.dataset.open = 'true';
      trigger.setAttribute('aria-expanded', 'true');
      listbox.setAttribute('aria-hidden', 'false');
      updateActiveDescendant();
    }

    function close(restoreFocus = false) {
      if (!isOpen()) return;
      root.dataset.open = 'false';
      trigger.setAttribute('aria-expanded', 'false');
      listbox.setAttribute('aria-hidden', 'true');
      updateActiveDescendant();
      if (restoreFocus) trigger.focus();
    }

    function moveActive(direction) {
      activeIndex = (activeIndex + direction + options.length) % options.length;
      updateActiveDescendant();
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function choose(index) {
      select.value = select.options[index].value;
      sync();
      close(true);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    trigger.addEventListener('click', () => isOpen() ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape' && isOpen()) { event.preventDefault(); close(true); return; }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (isOpen()) moveActive(1); else open(selectedIndex());
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (isOpen()) moveActive(-1);
        else open((selectedIndex() - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Home' && isOpen()) { event.preventDefault(); activeIndex = 0; updateActiveDescendant(); return; }
      if (event.key === 'End' && isOpen()) { event.preventDefault(); activeIndex = options.length - 1; updateActiveDescendant(); return; }
      if ((event.key === 'Enter' || event.key === ' ') && isOpen()) { event.preventDefault(); choose(activeIndex); return; }
      if ((event.key === 'Enter' || event.key === ' ') && !isOpen()) { event.preventDefault(); open(); return; }
      if (event.key.length === 1 && event.key !== ' ') {
        typeAhead += event.key.toLocaleLowerCase();
        clearTimeout(typeAheadTimer);
        typeAheadTimer = setTimeout(() => { typeAhead = ''; }, 700);
        const match = [...select.options].findIndex(option => option.textContent.trim().toLocaleLowerCase().startsWith(typeAhead));
        if (match >= 0) {
          if (!isOpen()) open(match);
          activeIndex = match;
          updateActiveDescendant();
        }
      }
    });

    options.forEach((option, index) => {
      option.addEventListener('pointerenter', () => { activeIndex = index; updateActiveDescendant(); });
      option.addEventListener('click', () => choose(index));
    });
    document.addEventListener('pointerdown', event => {
      if (!root.contains(event.target)) close();
    });
    select.addEventListener('change', sync);
    if (select.form) {
      select.form.addEventListener('reset', () => setTimeout(() => {
        delete root.dataset.validationAttempted;
        sync();
      }, 0));
    }
    sync();
    return { sync, open: () => open(), close: () => close() };
  }

  function validatePmDropdowns(form) {
    const roots = form.querySelectorAll('[data-pm-dropdown][data-required="true"]');
    for (const root of roots) {
      const select = document.getElementById(root.dataset.selectId);
      if (select && select.value) continue;
      const trigger = root.querySelector('[role="combobox"]');
      const error = root.querySelector('.pm-dropdown-error');
      root.dataset.validationAttempted = 'true';
      trigger.setAttribute('aria-invalid', 'true');
      if (error) error.hidden = false;
      trigger.focus();
      return false;
    }
    return true;
  }

  function initPmDropdowns(container = document) {
    const instances = window.pmDropdownInstances || (window.pmDropdownInstances = {});
    container.querySelectorAll('[data-pm-dropdown][data-select-id]').forEach(root => {
      if (root.dataset.pmDropdownInitialized === 'true') return;
      const select = document.getElementById(root.dataset.selectId);
      const trigger = root.querySelector('.pm-dropdown-trigger');
      const listbox = root.querySelector('[role="listbox"]');
      const value = root.querySelector('.pm-dropdown-value');
      if (!select || !trigger || !listbox || !value) return;
      instances[root.id] = createPmDropdown(select, { root, trigger, listbox, value });
      root.dataset.pmDropdownInitialized = 'true';
    });
    return instances;
  }

  window.createPmDropdown = createPmDropdown;
  window.initPmDropdowns = initPmDropdowns;
  window.validatePmDropdowns = validatePmDropdowns;
})();
