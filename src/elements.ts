import { defineElements } from './elements/define.js'

// Importing this entry registers the elements: <coven-widget>, <coven-connect-button> and the
// views they use. `kit.open()` loads it on its own, so a modal-only app never has to.
defineElements()

export { defineElements }
export {
  CovenAccountView,
  CovenChainPicker,
  CovenConnectButton,
  CovenConnectView,
  CovenModal,
  CovenSwapView,
  CovenTokenPicker,
  CovenWidget,
} from './elements/define.js'
export * from './index.js'
