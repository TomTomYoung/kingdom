// The manifest is the only source of adopted asset revisions and delivery URLs.
export const MANIFEST_URL = new URL('../../assets/manifest.json', import.meta.url);
const REPOSITORY_URL = new URL('../../', import.meta.url);

export function indexAssets(manifest, root = REPOSITORY_URL) {
  const entries = new Map();
  for (const asset of manifest.assets ?? []) {
    const file = asset.files?.find(({ path }) => /\.(png|svg|wav|ogg)$/.test(path));
    if (!file) continue;
    const url = new URL(file.path, root);
    if (!url.href.startsWith(root.href)) continue;
    entries.set(asset.id, { ...asset, url: url.href });
  }
  return entries;
}

export class AssetStore {
  constructor() { this.entries = new Map(); this.images = new Map(); this.failed = new Set(); }

  async load({ fetcher = fetch, imageFactory = () => new Image(), onProgress = () => {} } = {}) {
    try {
      const response = await fetcher(MANIFEST_URL);
      if (!response.ok) throw new Error('manifest');
      this.entries = indexAssets(await response.json());
    } catch {
      this.failed.add('manifest');
      return;
    }
    await Promise.all([...this.entries.values()].filter((entry) => entry.width).map((entry) => new Promise((resolve) => {
      const image = imageFactory();
      image.onload = () => { this.images.set(entry.id, image); onProgress(); resolve(); };
      image.onerror = () => { this.failed.add(entry.id); resolve(); };
      image.src = entry.url;
    })));
  }

  // Equal scaling on both axes. Pixel art stays at integral CSS pixel scale;
  // a narrow viewport scrolls the map rather than compressing individual assets.
  draw(ctx, id, x, y, scale = 1) {
    const image = this.images.get(id);
    if (!image) return false;
    const factor = Math.max(1, Math.floor(scale));
    const width = image.naturalWidth * factor, height = image.naturalHeight * factor;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, Math.round(x - width / 2), Math.round(y - height / 2), width, height);
    return true;
  }

  icon(id, className = 'asset-icon') {
    const node = document.createElement('span');
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    if (this.images.has(id)) node.append(this.images.get(id).cloneNode());
    else if (['unit-archer', 'unit-ballista'].includes(id)) { node.classList.add('unit-type-badge'); node.textContent = id === 'unit-archer' ? '弓' : '弩'; }
    return node;
  }
}
