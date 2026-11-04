// Presentation only: no GameState mutation or camera movement belongs here.
export class HudShell {
  constructor({ onView } = {}) {
    this.drawer = document.querySelector('#hud-drawer');
    this.body = document.querySelector('#hud-drawer-body');
    this.selector = document.querySelector('#hud-view-select');
    this.view = null; this.opener = null; this.onView = onView;
    document.querySelectorAll('[data-hud-open]').forEach(button => {
      button.setAttribute('aria-controls', 'hud-drawer'); button.setAttribute('aria-expanded', 'false');
      button.onclick = () => this.open(button.dataset.hudOpen, button);
    });
    document.querySelector('#hud-close').onclick = () => this.close();
    this.selector.onchange = () => this.open(this.selector.value, null, false);
  }
  open(view, opener = document.activeElement, focus = true) {
    const option = [...this.selector.options].find(option => option.value === view);
    if (!option) return;
    if (this.drawer.hidden && opener?.isConnected) this.opener = opener;
    if (this.view !== view) this.body.scrollTop = 0;
    this.view = view; this.drawer.hidden = false; this.drawer.dataset.view = view;
    this.selector.value = view; document.querySelector('#hud-drawer-title').textContent = option.textContent;
    document.querySelectorAll('[data-hud-view]').forEach(pane => { pane.hidden = pane.dataset.hudView !== view; });
    document.querySelectorAll('[data-hud-open]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.hudOpen === view)));
    this.onView?.(view);
    if (focus) document.querySelector('#hud-close').focus({ preventScroll: true });
  }
  openFor(selector) {
    const target = document.querySelector(selector), view = target?.closest('[data-hud-view]')?.dataset.hudView;
    if (!view) { this.close(false); target?.focus({ preventScroll: true }); return; }
    this.open(view);
    target?.querySelector('button:not(:disabled),select:not(:disabled),input:not(:disabled)')?.focus({ preventScroll: true });
  }
  close(restoreFocus = true) {
    if (this.drawer.hidden) return false;
    this.drawer.hidden = true; this.view = null; delete this.drawer.dataset.view;
    document.querySelectorAll('[data-hud-open]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) (this.opener?.isConnected && this.opener.getClientRects().length ? this.opener : document.querySelector('[data-hud-open="menu"]'))?.focus({ preventScroll: true });
    return true;
  }
}
