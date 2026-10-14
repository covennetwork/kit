import type { Kit } from '../core/kit.js'
import { defineElements } from './define.js'
import type { CovenModal } from './modal.js'

const mounted = new WeakMap<Kit, CovenModal>()

/** Puts one `<coven-modal>` per kit on the page, the first time that kit opens a view. */
export function mountModal(kit: Kit): CovenModal {
  defineElements()
  let modal = mounted.get(kit)
  if (!modal || !modal.isConnected) {
    modal = document.createElement('coven-modal') as CovenModal
    modal.kit = kit
    document.body.appendChild(modal)
    mounted.set(kit, modal)
  }
  return modal
}
