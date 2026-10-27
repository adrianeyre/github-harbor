/** An inline SVG icon from the sprite in index.html. Decorative: its meaning is always in nearby text. */
export const icon = (name: string, className = 'icon'): string =>
  `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${name}" /></svg>`;

export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

const announcer = document.getElementById('announcer');

/** Says `message` to screen readers through the page's status region (WCAG 4.1.3). */
export function announce(message: string): void {
  if (!announcer) return;
  announcer.textContent = '';
  // Emptied first, so the same message is read again.
  setTimeout(() => {
    announcer.textContent = message;
  }, 50);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
