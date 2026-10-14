/* Relay embed v1. No dependencies, cookies, or global styles. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script?.src) return;
  const source = new URL(script.src);
  const widgetId = source.searchParams.get('id');
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!validId.test(widgetId || '')) return;
  const apiOrigin = source.origin;
  const host = document.createElement('div');
  host.setAttribute('data-relay-widget', widgetId);
  const shadow = host.attachShadow({ mode: 'open' });
  script.insertAdjacentElement('afterend', host);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const stylesheet = el('style');
  stylesheet.textContent = `
    :host{all:initial;display:block;max-width:440px;width:100%;box-sizing:border-box;color:#37333e;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;text-align:left;--relay-accent:#6548c9;--relay-button-text:#fff}
    *,*::before,*::after{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}[hidden]{display:none!important}
    .relay-card{background:#fff;border:1px solid #e8e2ed;border-radius:15px;padding:27px;box-shadow:0 12px 44px #3828410b;width:100%}.relay-title{font-size:23px;line-height:1.25;letter-spacing:-.7px;margin:0 0 10px;color:#3b3246;font-weight:650;overflow-wrap:anywhere}.relay-description{font-size:12px;line-height:1.8;color:#9b8aab;margin:0 0 23px;overflow-wrap:anywhere}.relay-label{display:block;color:#7c6c8b;font-size:11px;font-weight:550;margin:15px 0 7px}.relay-required{color:#b6a4c4;margin-left:3px}.relay-input{display:block;width:100%;border:1px solid #e2dbe9;background:#fff;color:#56465f;border-radius:6px;padding:11px 12px;font-size:13px;outline:none;min-height:41px}.relay-input:focus{border-color:var(--relay-accent);box-shadow:0 0 0 3px #ede7f5}.relay-input:disabled{background:#faf8fc}textarea.relay-input{resize:vertical;min-height:85px}.relay-submit,.relay-launcher{border:0;background:var(--relay-accent);color:var(--relay-button-text);border-radius:7px;padding:12px 16px;font-size:12px;font-weight:600}.relay-submit{display:block;width:100%;margin-top:21px}.relay-launcher{box-shadow:0 5px 20px #37224720;max-width:100%;overflow-wrap:anywhere}.relay-submit:focus-visible,.relay-launcher:focus-visible,.relay-close:focus-visible{outline:3px solid #c4b2e3;outline-offset:3px}.relay-status{font-size:11px;line-height:1.7;color:#846991;margin:12px 0 0;overflow-wrap:anywhere}.relay-status.error{color:#b95555}.relay-status.success{color:#4f8669}.relay-credit{display:flex;align-items:center;justify-content:center;gap:4px;color:#bdb1c6;font-size:9px;margin:18px 0 0}.relay-credit strong{font-size:11px;font-weight:600;color:#a99ab5}.relay-trap{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important}.relay-loading{font-size:11px;color:#9c8aa7;padding:15px 0}.relay-frame{position:relative}.relay-frame.floating{position:fixed;right:24px;bottom:24px;width:min(380px,calc(100vw - 32px));z-index:2147483000;max-height:calc(100vh - 48px);overflow:auto;padding:3px}.floating .relay-card{box-shadow:0 12px 60px #39264730}.relay-frame.collapsible{display:flex;align-items:flex-end;flex-direction:column;gap:12px}.relay-frame.collapsible .relay-card{padding-top:31px}.relay-close{position:absolute;right:14px;top:10px;border:0;background:transparent;color:#b4a3c0;font-size:22px;line-height:1;padding:4px;z-index:1}.relay-error{border:1px solid #e9e1ed;background:#fcfafc;border-radius:9px;padding:18px;color:#9b839e;font-size:11px}.relay-heading{position:relative}.relay-frame:not(.collapsible) .relay-launcher{display:none}
    @media(max-width:500px){.relay-card{padding:23px}.relay-title{font-size:21px}.relay-frame.floating{right:13px;bottom:13px;max-height:calc(100vh - 26px)}}
  `;
  const loading = el('p', 'relay-loading', 'Getting ready to say hello…');
  loading.setAttribute('role', 'status');
  shadow.append(stylesheet, loading);

  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function readableText(hex) {
    const rgb = hex.slice(1).match(/.{2}/g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#211a28' : '#ffffff';
  }
  async function timedFetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(url, { ...options, credentials: 'omit', signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  function render(config) {
    loading.remove();
    const accent = /^#[0-9a-f]{6}$/i.test(config.display?.accent || '') ? config.display.accent : '#6548c9';
    host.style.setProperty('--relay-accent', accent);
    host.style.setProperty('--relay-button-text', readableText(accent));
    const isFloating = config.display?.position === 'bottom-right';
    const collapsible = config.type === 'popover' || isFloating;
    const frame = el('div', `relay-frame${isFloating ? ' floating' : ''}${collapsible ? ' collapsible' : ''}`);
    const card = el('section', 'relay-card');
    const instance = uuid();
    const title = el('h2', 'relay-title', config.title || 'Say hello');
    title.id = `relay-title-${instance}`;
    card.setAttribute('aria-labelledby', title.id);
    card.append(title);
    if (config.description) card.append(el('p', 'relay-description', config.description));
    const form = el('form');
    const fields = [];
    for (const [index, field] of config.fields.entries()) {
      if (!['text', 'email', 'textarea'].includes(field.type)) continue;
      const label = el('label', 'relay-label', field.label);
      const id = `relay-${instance}-${index}`;
      label.htmlFor = id;
      if (field.required) {
        const required = el('span', 'relay-required', '*');
        required.setAttribute('aria-hidden', 'true');
        label.append(required);
      }
      const input = el(field.type === 'textarea' ? 'textarea' : 'input', 'relay-input');
      if (field.type !== 'textarea') input.type = field.type;
      else input.rows = 3;
      input.id = id;
      input.name = field.name;
      input.required = Boolean(field.required);
      input.maxLength = field.type === 'textarea' ? 4000 : 254;
      if (field.type === 'email') {
        input.autocomplete = 'email';
        input.inputMode = 'email';
      } else if (/^(full_)?name$/.test(field.name)) input.autocomplete = 'name';
      else input.autocomplete = 'off';
      fields.push({ name: field.name, input });
      form.append(label, input);
    }
    const trapWrapper = el('div', 'relay-trap');
    trapWrapper.setAttribute('aria-hidden', 'true');
    const trapLabel = el('label', '', 'Website — leave this empty');
    const trap = el('input');
    trap.type = 'text';
    trap.name = 'website';
    trap.autocomplete = 'off';
    trap.tabIndex = -1;
    trap.maxLength = 200;
    trapLabel.append(trap);
    trapWrapper.append(trapLabel);
    form.append(trapWrapper);
    const button = el('button', 'relay-submit', config.button_text || 'Send message');
    button.type = 'submit';
    const status = el('p', 'relay-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.id = `relay-status-${instance}`;
    form.setAttribute('aria-describedby', status.id);
    form.append(button, status);
    const credit = el('p', 'relay-credit', 'Made possible by ');
    credit.append(el('strong', '', 'relay.'));
    card.append(form, credit);
    let key = uuid();
    let pending = false;
    form.addEventListener('input', () => {
      if (!pending) {
        key = uuid();
        status.textContent = '';
        status.className = 'relay-status';
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      const payload = { widget_id: widgetId, fields: Object.fromEntries(fields.map(({ name, input }) => [name, input.value.trim()])), website: trap.value };
      button.disabled = true;
      fields.forEach(({ input }) => { input.disabled = true; });
      button.textContent = 'Sending…';
      form.setAttribute('aria-busy', 'true');
      status.className = 'relay-status';
      status.textContent = 'Sending your message securely…';
      try {
        const response = await timedFetch(`${apiOrigin}/submissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            throw new Error(Number.isFinite(seconds) && seconds > 0 ? `A little too fast. Please wait ${seconds} seconds and try again.` : 'A little too fast. Please wait a minute and try again.');
          }
          throw new Error(data.error?.message || 'We couldn’t send that message. Please check your details and try again.');
        }
        status.textContent = 'You’re all set. Thanks for reaching out!';
        status.className = 'relay-status success';
        form.reset();
        key = uuid();
      } catch (error) {
        // Keep the same key after an ambiguous failure: retry cannot create a duplicate.
        status.className = 'relay-status error';
        status.textContent = error.name === 'AbortError' || error instanceof TypeError
          ? 'We couldn’t confirm delivery. Your details are saved here — try again safely.'
          : error.message;
      } finally {
        pending = false;
        button.disabled = false;
        fields.forEach(({ input }) => { input.disabled = false; });
        button.textContent = config.button_text || 'Send message';
        form.removeAttribute('aria-busy');
      }
    });
    frame.append(card);
    if (collapsible) {
      card.hidden = true;
      const close = el('button', 'relay-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close contact form');
      const launcher = el('button', 'relay-launcher', config.title || 'Say hello');
      launcher.type = 'button';
      launcher.setAttribute('aria-expanded', 'false');
      card.id = `relay-card-${instance}`;
      launcher.setAttribute('aria-controls', card.id);
      launcher.addEventListener('click', () => {
        card.hidden = !card.hidden;
        launcher.setAttribute('aria-expanded', String(!card.hidden));
        if (!card.hidden) fields[0]?.input.focus();
      });
      const closeCard = () => {
        card.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        launcher.focus();
      };
      close.addEventListener('click', closeCard);
      frame.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !card.hidden) { event.preventDefault(); closeCard(); }
      });
      card.prepend(close);
      frame.append(launcher);
    }
    shadow.append(frame);
  }

  timedFetch(`${apiOrigin}/widgets/${encodeURIComponent(widgetId)}/config`)
    .then(async (response) => {
      if (!response.ok) throw new Error('This form is not available right now. Please try again later.');
      const config = await response.json();
      if (!Array.isArray(config.fields)) throw new Error('This form could not be loaded.');
      render(config);
    })
    .catch(() => {
      loading.remove();
      const error = el('p', 'relay-error', 'This form is not available right now. Please try again later.');
      error.setAttribute('role', 'status');
      shadow.append(error);
    });
})();
