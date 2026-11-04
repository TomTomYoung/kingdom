// Legacy feature suites navigate the viewport HUD through its public controls.
// No visibility overrides, state mutations or bypasses of disabled controls.
// The dedicated browser-hud suite deliberately does not install this adapter.
export function installHudNavigation(page) {
  const rawLocator = page.locator.bind(page);
  const ensure = async locator => {
    if (!await rawLocator('#hud-drawer').count() || !await locator.count()) return;
    const place = await locator.first().evaluate(el => ({
      view: el.closest('[data-hud-view]')?.dataset.hudView,
      map: el.matches('#map,.hud-stage'),
    }));
    if (place.map) {
      if (await rawLocator('#hud-drawer').isVisible()) await rawLocator('#hud-close').click();
    } else if (place.view) {
      if (!await rawLocator('#hud-drawer').isVisible()) await rawLocator('.hud-nav [data-hud-open="menu"]').click();
      if (await rawLocator('#hud-view-select').inputValue() !== place.view)
        await rawLocator('#hud-view-select').selectOption(place.view);
    }
  };
  const actions = new Set(['click', 'dblclick', 'check', 'uncheck', 'fill', 'selectOption', 'focus', 'hover', 'press', 'evaluate', 'evaluateAll', 'innerText', 'isVisible', 'isEnabled', 'isDisabled', 'scrollIntoViewIfNeeded', 'screenshot', 'boundingBox']);
  const chain = new Set(['locator', 'first', 'last', 'nth', 'filter', 'getByRole', 'getByText', 'getByLabel']);
  const wrap = locator => new Proxy(locator, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      if (chain.has(key)) return (...args) => wrap(value.apply(target, args));
      if (actions.has(key)) return async (...args) => { await ensure(target); return value.apply(target, args); };
      return value.bind(target);
    },
  });
  page.locator = (...args) => wrap(rawLocator(...args));
  for (const method of ['click', 'dblclick', 'check', 'uncheck', 'fill', 'selectOption', 'focus', 'hover']) {
    const original = page[method].bind(page);
    page[method] = async (selector, ...args) => { await ensure(rawLocator(selector)); return original(selector, ...args); };
  }
}
