// Autofill bridge for web pages (untrusted, sandboxed, context-isolated).
// It talks to the main process over IPC and uses saved logins to fill forms.
// It NEVER exposes passwords to page scripts: nothing is put on window, the
// vault data stays inside this isolated world and only lands in the form
// fields the user is signing into (the same origin it was saved for).

const { ipcRenderer } = require('electron');

// Set a value the way a real keystroke would, so React/Vue/etc. notice.
function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function visible(el) {
  return !!el && el.offsetParent !== null && !el.disabled && !el.readOnly;
}

function passwordFields() {
  return [...document.querySelectorAll('input[type=password]')].filter(visible);
}

// The username field is the nearest preceding text/email/tel input.
function usernameFor(passEl) {
  const scope = passEl.form || document;
  const inputs = [...scope.querySelectorAll('input')];
  const idx = inputs.indexOf(passEl);
  for (let i = idx - 1; i >= 0; i--) {
    const t = (inputs[i].type || 'text').toLowerCase();
    if (['text', 'email', 'tel', ''].includes(t) && visible(inputs[i])) return inputs[i];
  }
  // Fall back to the first non-password visible input.
  return inputs.find((el) => el !== passEl && el.type !== 'password' && visible(el)) || null;
}

let filled = false;
async function tryFill() {
  if (filled) return;
  const pwds = passwordFields();
  if (!pwds.length) return;
  let logins;
  try {
    logins = await ipcRenderer.invoke('autofill:get', location.origin);
  } catch {
    return;
  }
  if (!logins || !logins.length) return;
  const login = logins[0]; // most-recent; multi-account picker is a later pass
  const pass = pwds[0];
  const user = usernameFor(pass);
  if (user && login.username) setValue(user, login.username);
  setValue(pass, login.password);
  filled = true;
}

// Fill only on a genuine user gesture on a login field. We deliberately do NOT
// fill on focus: a page can call element.focus() from script, which would let
// it trigger autofill into a field it controls and read back the password.
// A real click or keypress has isTrusted === true; synthetic events do not, so
// this blocks programmatic autofill-scraping while still feeling automatic.
function isLoginField(el) {
  if (!(el instanceof HTMLInputElement) || !visible(el)) return false;
  const t = (el.type || '').toLowerCase();
  if (t === 'password') return true;
  return (t === 'text' || t === 'email' || t === 'tel') && passwordFields().length > 0;
}
function onUserGesture(e) {
  if (!e.isTrusted) return; // ignore script-dispatched events
  if (isLoginField(e.target)) tryFill();
}
document.addEventListener('click', onUserGesture, true);
document.addEventListener('keydown', onUserGesture, true);

// Offer to save on submit.
document.addEventListener(
  'submit',
  (e) => {
    try {
      const form = e.target;
      const pass = [...form.querySelectorAll('input[type=password]')].find((el) => el.value);
      if (!pass) return;
      const user = usernameFor(pass);
      ipcRenderer.send('autofill:capture', {
        origin: location.origin,
        username: user ? user.value : '',
        password: pass.value,
      });
    } catch {
      /* ignore */
    }
  },
  true,
);
