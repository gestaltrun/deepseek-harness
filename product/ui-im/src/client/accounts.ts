/** Account presentation derives authorization and listener facts independently. */
import type { ImAccountView } from '@gestaltrun/dsh-api-im/client'
import type { ImKey } from './locales.ts'

/** @param account - authoritative account facts. @returns whether its identity can configure routes. */
export function accountUsable(account: ImAccountView): boolean {
  return account.authorization.state === 'ready'
    && account.connectionIntent === 'connected'
}

/** @param account - authoritative account. @returns locale key for its authorization fact. */
export function authorizationKey(account: ImAccountView): ImKey {
  switch (account.authorization.state) {
    case 'unchecked': return 'authorizationUnchecked'
    case 'ready': return 'authorizationReady'
    case 'required': return account.authorization.reason === 'expired' ? 'expired' : 'authorizationRequired'
    case 'failed': return 'authorizationFailed'
  }
}

/** @param account - authoritative account. @returns locale key for its listener fact. */
export function listenerKey(account: ImAccountView): ImKey {
  switch (account.listener.state) {
    case 'running': return 'connected'
    case 'starting': return 'connecting'
    case 'reconnecting': return 'reconnecting'
    case 'failed': return 'listenerFailed'
    case 'stopped': {
      switch (account.listener.reason) {
        case 'account-paused': return 'paused'
        case 'authorization-required': return 'authorizationRequired'
        case 'no-enabled-route': return 'listenerNoRoutes'
        case 'disconnected': return 'disconnected'
        case 'manual': return 'listenerStopped'
      }
    }
  }
}
