/**
 * A small, one-off confirm dialog for showing what permissions something
 * (currently: an extension being installed) is asking for. Not a generic
 * Modal framework — just enough for this one use, matching the inline-styled
 * DOM convention the rest of src/ui (settings-page.ts, research-page.ts) uses.
 */

interface PermissionDialogOptions {
  readonly title: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly onAllow: () => void;
  readonly onDeny: () => void;
}

function showPermissionDialog(options: PermissionDialogOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'nova-permission-dialog-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const card = document.createElement('div');
  card.style.cssText = 'width:360px;max-width:90vw;padding:20px;border-radius:var(--radius-md,8px);background:var(--bg-surface,#161618);border:1px solid var(--border-subtle,rgba(255,255,255,.08));color:var(--text-primary,#e0e0e0);font-family:system-ui,-apple-system,sans-serif;';

  const title = document.createElement('h3');
  title.textContent = options.title;
  title.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600;';
  card.appendChild(title);

  if (options.description) {
    const desc = document.createElement('p');
    desc.textContent = options.description;
    desc.style.cssText = 'margin:0 0 12px;font-size:12.5px;color:var(--text-secondary,#a0a098);';
    card.appendChild(desc);
  }

  const list = document.createElement('ul');
  list.style.cssText = 'margin:0 0 16px;padding-left:18px;font-size:13px;line-height:1.6;max-height:220px;overflow-y:auto;';
  if (options.permissions.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No special permissions requested.';
    li.style.listStyle = 'none';
    li.style.marginLeft = '-18px';
    list.appendChild(li);
  } else {
    for (const perm of options.permissions) {
      const li = document.createElement('li');
      li.textContent = perm;
      list.appendChild(li);
    }
  }
  card.appendChild(list);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

  const denyBtn = document.createElement('button');
  denyBtn.type = 'button';
  denyBtn.textContent = 'Deny';
  denyBtn.style.cssText = 'padding:7px 14px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:13px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);cursor:pointer;';

  const allowBtn = document.createElement('button');
  allowBtn.type = 'button';
  allowBtn.textContent = 'Allow';
  allowBtn.style.cssText = 'padding:7px 14px;border:none;border-radius:var(--radius-sm,4px);font-size:13px;background:var(--accent,#3a7afd);color:#fff;cursor:pointer;font-weight:600;';

  const close = (): void => {
    overlay.remove();
  };

  denyBtn.addEventListener('click', () => { close(); options.onDeny(); });
  allowBtn.addEventListener('click', () => { close(); options.onAllow(); });

  buttons.appendChild(denyBtn);
  buttons.appendChild(allowBtn);
  card.appendChild(buttons);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  allowBtn.focus();
}

export { showPermissionDialog };
export type { PermissionDialogOptions };
