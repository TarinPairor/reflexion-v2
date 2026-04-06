import { useAuth, useUser } from '@clerk/tanstack-react-start'
import { useEffect, useRef } from 'react'

import { ensureRefUser } from '#/api/users'
import {
  clearUserSessionSnapshot,
  setUserSessionSnapshot,
} from '#/lib/userSessionStorage'

/**
 * After sign-in or sign-up: syncs Clerk user to MongoDB `ref.Users`, and stores
 * `{ clerkId, email }` in sessionStorage. Clears that entry on sign-out.
 */
export default function ClerkUserSync() {
  const { isLoaded, userId } = useAuth()
  const { user, isLoaded: userLoaded } = useUser()
  const syncedMongoFor = useRef<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return

    if (!userId) {
      clearUserSessionSnapshot()
      syncedMongoFor.current = null
      return
    }

    if (!userLoaded || !user) return

    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      ''

    setUserSessionSnapshot({ clerkId: user.id, email })

    if (syncedMongoFor.current === userId) return
    syncedMongoFor.current = userId

    void ensureRefUser().catch((err: unknown) => {
      console.error('[ClerkUserSync] ensureRefUser failed', err)
    })
  }, [isLoaded, userId, userLoaded, user])

  return null
}
