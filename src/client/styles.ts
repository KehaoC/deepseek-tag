/** Minimal section styling that follows the Web settings panel's native scale. */

const ID = 'deepseek-tag-settings-styles'

const CSS = `
.dst-section{display:flex;flex-direction:column;gap:20px;max-width:760px;padding:4px 0 28px;color:var(--color-text,#e7e7e7)}
.dst-section h2,.dst-section h3,.dst-section p{margin:0}.dst-section h2{font-size:24px}.dst-section h3{font-size:15px}
.dst-intro,.dst-hint{color:var(--color-text-secondary,#9ca3af);line-height:1.5}.dst-intro{font-size:14px}.dst-hint{font-size:12px}
.dst-card{display:flex;flex-direction:column;gap:14px;padding:18px;border:1px solid var(--color-border,#343434);border-radius:12px;background:var(--color-bg-secondary,rgba(255,255,255,.025))}
.dst-row{display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);gap:16px;align-items:start}.dst-field{display:flex;flex-direction:column;gap:6px}.dst-field label,.dst-toggle{font-size:13px;font-weight:600}
.dst-input,.dst-select,.dst-textarea{width:100%;box-sizing:border-box;border:1px solid var(--color-border,#444);border-radius:8px;background:var(--color-bg,#171717);color:inherit;padding:9px 10px;font:inherit}.dst-textarea{min-height:76px;resize:vertical}
.dst-input:focus,.dst-select:focus,.dst-textarea:focus{outline:2px solid color-mix(in srgb,var(--color-primary,#5b8cff) 55%,transparent);outline-offset:1px}
.dst-toggle{display:flex;gap:10px;align-items:center}.dst-toggle input{width:16px;height:16px}.dst-status{display:flex;gap:8px;flex-wrap:wrap}.dst-badge{border:1px solid var(--color-border,#444);border-radius:999px;padding:4px 9px;font-size:12px;color:var(--color-text-secondary,#aaa)}
.dst-actions{display:flex;align-items:center;gap:12px}.dst-button{border:0;border-radius:8px;background:var(--color-primary,#4f7cff);color:white;padding:9px 15px;font:inherit;font-weight:650;cursor:pointer}.dst-button:disabled{opacity:.5;cursor:not-allowed}.dst-error{color:#ef7676;font-size:13px}.dst-success{color:#69c58c;font-size:13px}
@media(max-width:640px){.dst-row{grid-template-columns:1fr;gap:7px}.dst-card{padding:14px}}
`

/** Install the stylesheet and return its scoped disposer. */
export function adoptStyles(): () => void {
  if (document.getElementById(ID) !== null) return () => undefined
  const style = document.createElement('style')
  style.id = ID
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}
