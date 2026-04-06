/** Key for `{ clerkId, email }` JSON in `sessionStorage` (browser session). */
export const USER_SESSION_STORAGE_KEY = 'reflexion.clerkUserSession'

export type UserSessionSnapshot = {
  clerkId: string
  email: string
}

export function setUserSessionSnapshot(data: UserSessionSnapshot): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(USER_SESSION_STORAGE_KEY, JSON.stringify(data))
}

export function clearUserSessionSnapshot(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(USER_SESSION_STORAGE_KEY)
}
