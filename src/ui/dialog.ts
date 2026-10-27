import { icon } from './dom';

export interface Dialog {
  readonly dialog: HTMLDialogElement;
  readonly body: HTMLDivElement;
  readonly open: () => void;
}

/**
 * A modal dialog on the platform's <dialog>: a title and a close button in a
 * header, a body that scrolls on its own and takes focus, and a Done button.
 * showModal() makes the page behind it inert, so focus stays inside. It closes
 * on Escape, on the backdrop and on either button, and hands focus back to
 * whatever opened it.
 */
export function makeDialog({ id, title, closeLabel }: { id: string; title: string; closeLabel: string }): Dialog {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  const titleId = `${id}-dialog-title`;
  dialog.setAttribute('aria-labelledby', titleId);

  const head = document.createElement('div');
  head.className = 'dialog-head';
  const heading = document.createElement('h2');
  heading.id = titleId;
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.dataset.close = '';
  close.setAttribute('aria-label', closeLabel);
  close.innerHTML = icon('x');
  head.append(heading, close);

  // Focusable, so the keyboard can scroll a long policy (WCAG 2.1.1).
  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', titleId);
  body.tabIndex = 0;

  const foot = document.createElement('div');
  foot.className = 'dialog-foot';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button button-primary';
  done.dataset.close = '';
  done.textContent = 'Done';
  foot.append(done);

  dialog.append(head, body, foot);

  let returnTo: HTMLElement | null = null;
  const open = () => {
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    close.focus();
  };
  dialog.addEventListener('close', () => {
    returnTo?.focus();
    returnTo = null;
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    // A click on the backdrop lands on the <dialog> itself.
    if (target === dialog || target?.closest('[data-close]')) dialog.close();
  });
  document.body.append(dialog);
  return { dialog, body, open };
}
