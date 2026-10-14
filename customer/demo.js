'use strict';

// The host page knows only a public widget ID and a script URL; no credentials.
(() => {
  const requestedId = new URLSearchParams(window.location.search).get('widget');
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const id = validId.test(requestedId || '') ? requestedId : '11111111-1111-4111-8111-111111111111';
  const script = document.createElement('script');
  script.src = `http://localhost:4000/widget.v1.js?id=${encodeURIComponent(id)}`;
  script.async = true;
  script.addEventListener('error', () => {
    const message = document.createElement('p');
    message.className = 'widget-load-error';
    message.textContent = 'Start the Relay API on localhost:4000, then reload this page to see the form.';
    document.getElementById('widget-mount').append(message);
  });
  document.getElementById('widget-mount').append(script);
})();
