import React from 'react'
import { Play, X } from 'lucide-react'

const h = React.createElement

// Running turns include the final turn being settled before a requested pause.
export const activeMatchCount = matches => matches.filter(match => ['running', 'pausing'].includes(match.status)).length

function Confirmation({ title, description, notice, players, confirmLabel, onResult, opener }) {
  const dialog = React.useRef(null), titleId = React.useId(), descriptionId = React.useId()
  React.useEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('.ar-confirm-actions button').focus()
    return () => { element.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  const trapFocus = event => {
    if (event.key !== 'Tab') return
    const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')]
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return h('dialog', { ref: dialog, className: 'ar-confirm', 'aria-labelledby': titleId, 'aria-describedby': descriptionId, onKeyDown: trapFocus, onCancel: event => { event.preventDefault(); onResult(false) } },
    h('div', { className: 'ar-confirm-head' }, h('span', { className: 'ar-confirm-mark' }, h(Play)), h('button', { className: 'ar-icon', type: 'button', 'aria-label': '关闭确认框', onClick: () => onResult(false) }, h(X))),
    h('h2', { id: titleId }, title), h('p', { id: descriptionId, className: 'ar-confirm-copy' }, description),
    notice && h('p', { className: 'ar-confirm-notice' }, notice),
    players && h('div', { className: 'ar-confirm-players' }, players.map((name, index) => h('div', { key: index }, h('small', null, index ? '白方 · 后手' : '黑方 · 先手'), h('strong', null, name)))),
    h('div', { className: 'ar-confirm-actions' }, h('button', { type: 'button', className: 'ar-button', onClick: () => onResult(false) }, '取消'), h('button', { type: 'button', className: 'ar-button ar-primary', onClick: () => onResult(true) }, confirmLabel)))
}

export function useConfirmation() {
  const [options, setOptions] = React.useState(null), pending = React.useRef(null)
  React.useEffect(() => () => { pending.current?.(false); pending.current = null }, [])
  const confirm = options => {
    if (pending.current) return Promise.resolve(false)
    return new Promise(resolve => { pending.current = resolve; setOptions({ ...options, opener: document.activeElement }) })
  }
  const finish = result => { const resolve = pending.current; pending.current = null; setOptions(null); resolve?.(result) }
  return [confirm, options ? h(Confirmation, { ...options, onResult: finish }) : null]
}
