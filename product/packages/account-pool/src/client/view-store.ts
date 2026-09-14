/** Settings viewing preferences shared across section remounts. */
import { defineStore } from '@deepseek-ai/dsh-client-store'

interface AccountPoolView {
  filter: string
  face: 'A' | 'B'
  faceRevision: number
}

/**
 * Declare account filters and the global card face; account data stays in the controller.
 * @returns a handle owned by the Client plugin's registrations.
 */
export function createAccountPoolViewStore() {
  return defineStore({
    init: (): AccountPoolView => ({ filter: 'all', face: 'A', faceRevision: 0 }),
    actions: {
      filter: (state, filter: string) => { state.filter = filter },
      face: (state, face: 'A' | 'B') => { state.face = face; state.faceRevision++ },
    },
  })
}
