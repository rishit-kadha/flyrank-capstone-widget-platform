'use strict';

(() => {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  let token = '';
  try { token = sessionStorage.getItem('relay-session') || ''; } catch { /* Memory-only works too. */ }
  let widgets = [];
  let editingId = null;
  let leadOffset = 0;
  const pageSize = 20;
  const typeLabels = { signup: 'Email signup', contact: 'Contact form', popover: 'CTA popover' };
  const titles = { overview: 'Overview', widgets: 'Widgets', leads: 'Submissions', delivery: 'Delivery & reliability' };

  function saveToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem('relay-session', value);
      else sessionStorage.removeItem('relay-session');
    } catch { /* The session remains usable without browser storage. */ }
  }

  function notice(message, isError = false) {
    const node = $('#notice');
    node.textContent = message;
    node.classList.toggle('error', isError);
    node.hidden = !message;
  }

  function showLogin() {
    saveToken('');
    $$('.dialog[open]').forEach((dialog) => dialog.close());
    $('#login-dialog').showModal();
    $('#account-name').textContent = 'Not signed in';
    $('#account-initial').textContent = '?';
  }

  async function api(path, options = {}) {
    const headers = { ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch {
      throw new Error('Could not reach Relay. Check that the API server is running, then retry.');
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login') showLogin();
      const details = Array.isArray(data.error?.details) ? data.error.details.slice(0, 3).map((item) => `${item.path || 'Input'}: ${item.message}`).join(' ') : '';
      const error = new Error(`${data.error?.message || `Request failed (${response.status}).`}${details ? ` — ${details}` : ''}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const safely = (fn) => async (...args) => {
    try { await fn(...args); } catch (error) { notice(error.message, true); }
  };
  function identity(data) {
    const user = data?.user || data || {};
    $('#account-name').textContent = user.email || 'Workspace owner';
    $('#account-initial').textContent = (user.email || 'W').slice(0, 1).toUpperCase();
  }
  function view(name) {
    if (!titles[name]) return;
    $$('.view').forEach((section) => { section.hidden = section.id !== `view-${name}`; });
    $$('[data-view]').forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('#breadcrumb').textContent = titles[name];
    document.title = `${titles[name]} · Relay`;
  }

  function empty(parent, message) {
    parent.replaceChildren(el('div', 'empty-state', message));
  }
  function normalizeWidget(widget) { return { ...widget, ...(widget.config || {}), id: widget.id }; }
  function formattedDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function widgetName(id) { return widgets.find((widget) => widget.id === id)?.title || 'Widget'; }

  function widgetCard(widget) {
    const card = el('article', 'widget-card');
    const preview = el('div', `widget-preview ${widget.type}`);
    preview.setAttribute('aria-hidden', 'true');
    const mini = el('div', 'mini-widget');
    mini.append(el('strong', '', widget.title), el('p', '', widget.description || 'A warm welcome for your visitors.'));
    (widget.fields || []).slice(0, 2).forEach((field) => mini.append(el('div', 'mini-input', field.label)));
    const miniButton = el('div', 'mini-button', widget.button_text || 'Submit');
    if (/^#[0-9a-f]{6}$/i.test(widget.display?.accent || '')) miniButton.style.backgroundColor = widget.display.accent;
    mini.append(miniButton);
    preview.append(mini);
    const details = el('div', 'widget-details');
    const title = el('div', 'widget-title-row');
    title.append(el('h3', '', widget.title), el('span', `status ${widget.active === false ? 'inactive' : ''}`, widget.active === false ? 'Inactive' : 'Active'));
    const actions = el('div', 'widget-actions');
    const edit = el('button', '', 'Edit widget');
    edit.addEventListener('click', () => editWidget(widget));
    const embed = el('button', 'embed-action', '〈/〉 Embed');
    embed.addEventListener('click', safely(() => showEmbed(widget.id)));
    const demo = el('a', '', 'Preview ↗');
    demo.href = `http://localhost:5500/?widget=${encodeURIComponent(widget.id)}`;
    demo.target = '_blank';
    demo.rel = 'noopener noreferrer';
    const remove = el('button', 'delete-action', 'Delete');
    remove.setAttribute('aria-label', `Delete ${widget.title}`);
    remove.addEventListener('click', safely(async () => {
      if (!window.confirm(`Delete “${widget.title}”? Its embed will stop accepting submissions. This cannot be undone.`)) return;
      remove.disabled = true;
      try {
        await api(`/api/widgets/${widget.id}`, { method: 'DELETE' });
        notice('Widget deleted.');
        await refresh();
      } finally { remove.disabled = false; }
    }));
    actions.append(edit, embed, demo, remove);
    details.append(title, el('p', 'widget-type', `${typeLabels[widget.type] || widget.type} · ${(widget.fields || []).length} fields`), actions);
    card.append(preview, details);
    return card;
  }

  async function loadWidgets() {
    const data = await api('/api/widgets');
    widgets = (Array.isArray(data) ? data : data.items || data.widgets || []).map(normalizeWidget);
    $('#widget-count').textContent = widgets.length;
    $('#metric-widgets').textContent = widgets.filter((widget) => widget.active !== false).length;
    for (const [selector, items] of [['#overview-widgets', widgets.slice(0, 3)], ['#all-widgets', widgets]]) {
      const parent = $(selector);
      parent.replaceChildren(...items.map(widgetCard));
      if (!items.length) empty(parent, 'Your first hello is one widget away. Create a widget to get started.');
    }
    const filter = $('#lead-filter');
    const previous = filter.value;
    filter.replaceChildren(new Option('All widgets', ''));
    widgets.forEach((widget) => filter.add(new Option(widget.title, widget.id)));
    if (widgets.some((widget) => widget.id === previous)) filter.value = previous;
  }

  async function loadDashboard() {
    const data = await api('/api/dashboard');
    $('#metric-total').textContent = Number(data.total || 0).toLocaleString();
    $('#metric-sent').textContent = Number(data.jobs?.sent || 0).toLocaleString();
    $('#metric-pending').textContent = (Number(data.jobs?.pending || 0) + Number(data.jobs?.processing || 0)).toLocaleString();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      const row = (data.by_day || []).find((item) => String(item.date).slice(0, 10) === key);
      return { date, count: Number(row?.count || 0) };
    });
    const max = Math.max(1, ...days.map((day) => day.count));
    const chart = $('#activity-chart');
    chart.replaceChildren(...days.map((day) => {
      const column = el('div', 'chart-column');
      const track = el('div', 'chart-track');
      const bar = el('div', 'chart-bar');
      bar.style.height = `${Math.max(2, day.count / max * 90)}%`;
      bar.append(el('span', 'chart-value', day.count));
      track.append(bar);
      column.append(track, el('span', 'chart-label', day.date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })));
      return column;
    }));
    chart.setAttribute('aria-label', `Daily submissions, UTC: ${days.map((day) => `${day.date.toISOString().slice(0, 10)}: ${day.count}`).join('; ')}`);
    const countries = data.by_country || [];
    const countryMax = Math.max(1, ...countries.map((country) => Number(country.count)));
    const countryList = $('#country-list');
    countryList.replaceChildren(...countries.slice(0, 4).map((country) => {
      const row = el('div', 'country-row');
      const track = el('span', 'country-bar');
      const bar = el('span');
      bar.style.width = `${Number(country.count) / countryMax * 100}%`;
      track.append(bar);
      row.append(el('span', 'country-dot'), el('strong', '', country.country || 'Unknown'), track, el('small', '', country.count));
      return row;
    }));
    if (!countries.length) countryList.append(el('p', 'data-note', 'The map starts with your first submission.'));
  }

  function appendTableEmpty(body, columns, message) {
    const row = el('tr');
    const cell = el('td', '', message);
    cell.colSpan = columns;
    cell.style.textAlign = 'center';
    cell.style.padding = '40px 20px';
    row.append(cell);
    body.append(row);
  }
  async function loadLeads() {
    const search = new URLSearchParams({ limit: pageSize, offset: leadOffset });
    if ($('#lead-filter').value) search.set('widget_id', $('#lead-filter').value);
    const data = await api(`/api/submissions?${search}`);
    const items = data.items || [];
    const body = $('#leads-body');
    body.replaceChildren(...items.map((lead) => {
      const row = el('tr');
      const fields = lead.fields || {};
      const email = fields.email || Object.entries(fields).find(([key]) => /email/i.test(key))?.[1] || '';
      const name = fields.name || fields.full_name || email || 'New visitor';
      const visitor = el('td');
      visitor.append(el('strong', '', name));
      if (email && email !== name) visitor.append(el('small', '', email));
      const location = el('td', '', [lead.geo?.city, lead.geo?.country].filter(Boolean).join(', ') || 'Unknown');
      if (lead.geo?.provider) location.append(el('small', '', lead.geo.provider));
      const detail = el('button', 'text-button', 'View →');
      detail.setAttribute('aria-label', `View submission from ${name}`);
      detail.addEventListener('click', safely(() => showDetail(lead.id)));
      const action = el('td');
      action.append(detail);
      row.append(visitor, el('td', '', lead.widget_title || widgetName(lead.widget_id)), location, el('td', '', formattedDate(lead.created_at)), action);
      return row;
    }));
    if (!items.length) appendTableEmpty(body, 5, 'No submissions yet. Open the demo site and send your first hello.');
    const total = Number(data.total || 0);
    $('#lead-total').textContent = total ? `${leadOffset + 1}–${leadOffset + items.length} of ${total} submissions` : '0 submissions';
    $('#leads-prev').disabled = leadOffset === 0;
    $('#leads-next').disabled = leadOffset + items.length >= total;
  }

  async function showDetail(id) {
    const data = await api(`/api/submissions/${id}`);
    const lead = data.submission || data;
    const list = $('#detail-content');
    list.replaceChildren();
    const entries = [
      ['Widget', lead.widget_title || widgetName(lead.widget_id)],
      ...Object.entries(lead.fields || {}),
      ['Received', formattedDate(lead.created_at)],
      ['Location', [lead.geo?.city, lead.geo?.country].filter(Boolean).join(', ') || 'Unknown'],
      ['Geo provider', lead.geo?.provider || 'Unavailable'],
      ['Submission ID', lead.id],
    ];
    entries.forEach(([key, value]) => list.append(el('dt', '', key), el('dd', '', typeof value === 'string' ? value : JSON.stringify(value))));
    $('#detail-dialog').showModal();
  }

  async function loadJobs() {
    const data = await api('/api/jobs');
    const body = $('#jobs-body');
    const items = data.items || [];
    body.replaceChildren(...items.map((job) => {
      const row = el('tr');
      const status = el('td');
      const statusName = ['pending', 'processing', 'sent', 'failed'].includes(job.status) ? job.status : 'unknown';
      status.append(el('span', `status ${statusName}`, statusName));
      row.append(el('td', '', String(job.id).slice(0, 8)), status, el('td', '', job.attempts ?? 0), el('td', '', formattedDate(job.created_at)), el('td', '', job.last_error || '—'));
      return row;
    }));
    if (!items.length) appendTableEmpty(body, 5, 'No notification jobs yet. A successful submission creates one automatically.');
  }

  async function loadFailures() {
    const form = $('#failures-form');
    try {
      const data = await api('/api/demo/failures');
      ['geo_a_down', 'geo_b_down', 'notification_fail'].forEach((name) => { form.elements[name].checked = Boolean(data[name]); });
      [...form.elements].forEach((input) => { input.disabled = false; });
      $('#failures-message').textContent = 'Controls affect only your current workspace. Restore providers after each experiment.';
    } catch (error) {
      if ([403, 404].includes(error.status)) {
        [...form.elements].forEach((input) => { input.disabled = true; });
        $('#failures-message').textContent = 'Demo controls are disabled on this server.';
      } else throw error;
    }
  }

  async function refresh() {
    $('#refresh').disabled = true;
    try {
      await loadWidgets();
      const results = await Promise.allSettled([loadDashboard(), loadLeads(), loadJobs(), loadFailures()]);
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason.message);
      if (errors.length) notice([...new Set(errors)].join(' '), true);
    } finally { $('#refresh').disabled = false; }
  }

  function fieldRow(field = {}) {
    const row = el('div', 'field-row');
    for (const [name, label, placeholder] of [['name', 'Field name', 'full_name'], ['label', 'Label', 'Full name']]) {
      const wrapper = el('label', '', label);
      const input = el('input');
      input.name = `field_${name}`;
      input.value = field[name] || '';
      input.placeholder = placeholder;
      input.required = true;
      input.maxLength = name === 'name' ? 40 : 80;
      if (name === 'name') { input.pattern = '[a-z][a-z0-9_]*'; input.title = 'Start with a lowercase letter. Use lowercase letters, numbers, and underscores.'; }
      wrapper.append(input);
      row.append(wrapper);
    }
    const typeLabel = el('label', '', 'Type');
    const type = el('select');
    type.name = 'field_type';
    ['text', 'email', 'textarea'].forEach((value) => type.add(new Option(value, value)));
    type.value = field.type || 'text';
    typeLabel.append(type);
    const required = el('label', 'toggle-label', 'Required');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'field_required';
    checkbox.checked = field.required !== false;
    required.prepend(checkbox);
    const remove = el('button', 'icon-button', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove field');
    remove.addEventListener('click', () => row.remove());
    row.append(typeLabel, required, remove);
    return row;
  }

  function editWidget(widget = null) {
    editingId = widget?.id || null;
    const form = $('#widget-form');
    form.reset();
    $('#widget-error').textContent = '';
    $('#widget-dialog-title').textContent = widget ? 'Edit widget' : 'Create a widget';
    form.elements.title.value = widget?.title || '';
    form.elements.type.value = widget?.type || 'signup';
    form.elements.description.value = widget?.description || '';
    form.elements.button_text.value = widget?.button_text || 'Join the list';
    form.elements.accent.value = widget?.display?.accent || '#6548c9';
    form.elements.position.value = widget?.display?.position || 'inline';
    form.elements.active.checked = widget?.active !== false;
    const fields = widget?.fields || [{ name: 'email', label: 'Email address', type: 'email', required: true }];
    $('#field-rows').replaceChildren(...fields.map(fieldRow));
    $('#widget-dialog').showModal();
  }

  async function showEmbed(id) {
    const data = await api(`/api/widgets/${id}/embed`);
    $('#embed-snippet').value = data.snippet;
    $('#copy-status').textContent = '';
    $('#embed-dialog').showModal();
  }

  $('#login-dialog').addEventListener('cancel', (event) => event.preventDefault());
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button[type=submit]', form);
    button.disabled = true;
    $('#login-error').textContent = '';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email: form.elements.email.value, password: form.elements.password.value } });
      saveToken(data.access_token);
      form.elements.password.value = '';
      identity(data);
      $('#login-dialog').close();
      notice('');
      await refresh();
    } catch (error) { $('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#logout').addEventListener('click', safely(async () => {
    if (token) await api('/api/auth/logout', { method: 'POST' });
    showLogin();
  }));
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => view(button.dataset.view)));
  $$('[data-goto]').forEach((button) => button.addEventListener('click', () => view(button.dataset.goto)));
  $$('[data-create]').forEach((button) => button.addEventListener('click', () => editWidget()));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
  $('#refresh').addEventListener('click', safely(refresh));
  $('#add-field').addEventListener('click', () => {
    if ($$('.field-row').length >= 8) { $('#widget-error').textContent = 'A widget can have up to eight fields.'; return; }
    $('#widget-error').textContent = '';
    $('#field-rows').append(fieldRow());
  });
  $('#lead-filter').addEventListener('change', safely(async () => { leadOffset = 0; await loadLeads(); }));
  $('#leads-prev').addEventListener('click', safely(async () => { leadOffset = Math.max(0, leadOffset - pageSize); await loadLeads(); }));
  $('#leads-next').addEventListener('click', safely(async () => { leadOffset += pageSize; await loadLeads(); }));
  $('#copy-snippet').addEventListener('click', async () => {
    const code = $('#embed-snippet');
    try {
      await navigator.clipboard.writeText(code.value);
      $('#copy-status').textContent = 'Copied. Your widget is ready for its new home.';
    } catch {
      code.focus();
      code.select();
      $('#copy-status').textContent = 'Code selected. Press Ctrl+C (or ⌘C) to copy it.';
    }
  });
  $('#widget-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button[type=submit]', form);
    const fields = $$('.field-row', form).map((row) => ({
      name: $('[name=field_name]', row).value.trim(),
      label: $('[name=field_label]', row).value.trim(),
      type: $('[name=field_type]', row).value,
      required: $('[name=field_required]', row).checked,
    }));
    if (!fields.length) { $('#widget-error').textContent = 'Add at least one field.'; return; }
    if (new Set(fields.map((field) => field.name)).size !== fields.length) { $('#widget-error').textContent = 'Each field needs a unique name.'; return; }
    if (fields.some((field) => ['website', 'widget_id', '__proto__', 'constructor', 'prototype'].includes(field.name))) { $('#widget-error').textContent = 'That field name is reserved. Choose another identifier.'; return; }
    button.disabled = true;
    $('#widget-error').textContent = '';
    try {
      await api(editingId ? `/api/widgets/${editingId}` : '/api/widgets', {
        method: editingId ? 'PATCH' : 'POST',
        body: {
          type: form.elements.type.value, title: form.elements.title.value.trim(), description: form.elements.description.value.trim(),
          button_text: form.elements.button_text.value.trim(), fields,
          display: { accent: form.elements.accent.value, position: form.elements.position.value }, active: form.elements.active.checked,
        },
      });
      $('#widget-dialog').close();
      notice(editingId ? 'Widget updated. Public configurations can take up to one minute to refresh.' : 'Widget created. Copy the embed code to welcome your first visitor.');
      await refresh();
    } catch (error) { $('#widget-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#failures-form').addEventListener('submit', safely(async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button', form);
    button.disabled = true;
    try {
      await api('/api/demo/failures', { method: 'PUT', body: Object.fromEntries(['geo_a_down', 'geo_b_down', 'notification_fail'].map((name) => [name, form.elements[name].checked])) });
      $('#failures-message').textContent = 'Simulation saved for this workspace. Open the demo page to test a submission.';
    } finally { button.disabled = false; }
  }));

  safely(async () => {
    if (!token) { showLogin(); return; }
    identity(await api('/api/auth/me'));
    await refresh();
  })();
})();
