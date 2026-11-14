(function () {
  let installPrompt = null;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });

  window.showTrudeInstallHelp = async function () {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const text = ios
      ? '<p>In Safari, tap <b>Share</b>, then choose <b>Add to Home Screen</b>.</p>'
      : '<p>In Chrome, open the <b>⋮ menu</b> and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    modal('Install Trude', text + '<p class="auth-footnote">Installation needs Trude to be opened from its secure HTTPS address. The local Wi-Fi test link uses HTTP and cannot install the app.</p>');
  };
})();
