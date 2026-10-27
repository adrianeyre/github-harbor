import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Where the site is published. The Pages workflow passes the real address from `actions/configure-pages`. */
const SITE_URL = (process.env.SITE_URL ?? 'https://adrianeyre.github.io/github-clone').replace(/\/+$/, '');
const REPO_URL = (process.env.REPO_URL ?? 'https://github.com/adrianeyre/github-clone').replace(/\/+$/, '');

/** Fills `{{SITE_URL}}`, `{{REPO_URL}}` and `{{VERSION}}` in index.html, and writes robots.txt and sitemap.xml. */
function site(): Plugin {
  return {
    name: 'repo-harbor-site',
    transformIndexHtml: (html) =>
      html.replaceAll('{{SITE_URL}}', SITE_URL).replaceAll('{{REPO_URL}}', REPO_URL).replaceAll('{{VERSION}}', pkg.version),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n` });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>
</urlset>
`,
      });
    },
  };
}

export default defineConfig({
  // Relative, so the build works under https://<user>.github.io/<repo>/ without naming the repo.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __REPO_URL__: JSON.stringify(REPO_URL),
  },
  plugins: [site()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    testTimeout: 60_000,
  },
});
