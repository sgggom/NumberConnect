const PREFIX = 'number-connect.arranger.playtest.v1.';
const memory = new Map<string, string>();

export function readPlaytestPreference(key: string): string | undefined {
  try { return localStorage.getItem(PREFIX + key) ?? memory.get(key); }
  catch { return memory.get(key); }
}

export function savePlaytestPreference(key: string, value: string): void {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, value); } catch { /* Keep settings across boards even if storage is unavailable. */ }
}

/** Restore before callers initialize rendering/model state; persist only valid edits. */
export function persistPlaytestControl(key: string, control: HTMLInputElement | HTMLSelectElement): void {
  const saved = readPlaytestPreference(key);
  const checkbox = control instanceof HTMLInputElement && control.type === 'checkbox';
  if (checkbox) {
    if (saved === 'true' || saved === 'false') control.checked = saved === 'true';
  } else if (saved !== undefined) {
    const initial = control.value;
    control.value = saved;
    if (!control.value || !control.checkValidity()
      || (control instanceof HTMLInputElement && ['number', 'range'].includes(control.type)
        && (!Number.isFinite(Number(saved)) || control.valueAsNumber !== Number(saved)))) control.value = initial;
  }
  const save = () => {
    if (checkbox) savePlaytestPreference(key, String(control.checked));
    else if (control.value && control.checkValidity()) savePlaytestPreference(key, control.value);
  };
  control.addEventListener('input', save);
  control.addEventListener('change', save);
}
