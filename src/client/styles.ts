/** Settings styling built exclusively on the Harness Web semantic theme tokens. */

const ID = 'deepseek-tag-settings-styles'

const CSS = `
.dst-section{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;max-width:720px;padding:2px 0 28px;color:var(--dsw-alias-label-primary)}
.dst-section h2,.dst-section h3,.dst-section p{margin:0}.dst-section h2{font-size:18px;line-height:26px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}.dst-section h3{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dst-intro,.dst-hint{color:var(--dsw-alias-label-tertiary)}.dst-intro{max-width:640px;font-size:14px;line-height:22px}.dst-hint{font-size:12px;line-height:18px}
.dst-status{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 4px}.dst-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:4px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}.dst-badge:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}.dst-badge--ok:before{background:var(--dsw-alias-state-success-primary)}
.dst-card{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent}.dst-card>h3{padding-bottom:2px}.dst-card--primary{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-module-platform)}
.dst-row{display:grid;grid-template-columns:minmax(170px,210px) minmax(260px,1fr);gap:20px;align-items:start}.dst-field{display:flex;flex-direction:column;gap:3px}.dst-field label,.dst-row>label,.dst-toggle{font-size:13px;line-height:20px;font-weight:550;color:var(--dsw-alias-label-primary)}
.dst-input,.dst-select,.dst-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);padding:8px 11px;font:inherit;font-size:14px;line-height:22px;transition:border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dst-input,.dst-select{height:40px}.dst-textarea{min-height:76px;resize:vertical}
.dst-input:hover:not(:disabled),.dst-select:hover:not(:disabled),.dst-textarea:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}.dst-input:focus,.dst-select:focus,.dst-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}.dst-input:disabled,.dst-select:disabled,.dst-textarea:disabled{opacity:.5;cursor:not-allowed}
.dst-toggle{display:flex;gap:10px;align-items:center}.dst-toggle input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}.dst-card>.dst-hint{padding-left:26px}
.dst-actions{position:sticky;bottom:-1px;z-index:1;display:flex;align-items:center;gap:12px;padding:12px 0 2px;background:linear-gradient(transparent 0,var(--dsw-alias-bg-layer-1) 28%)}.dst-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;border:0;border-radius:18px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);padding:0 16px;font:inherit;font-size:14px;line-height:22px;font-weight:500;cursor:pointer}.dst-button:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.dst-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}.dst-button:disabled{opacity:.4;cursor:default}.dst-error,.dst-success{font-size:12px;line-height:18px}.dst-error{color:var(--dsw-alias-state-error-primary)}.dst-success{color:var(--dsw-alias-state-success-primary)}
@media(max-width:720px){.dst-row{grid-template-columns:1fr;gap:7px}.dst-card{padding:14px}.dst-card>.dst-hint{padding-left:0}}
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
