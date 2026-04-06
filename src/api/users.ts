import { auth, clerkClient } from '@clerk/tanstack-react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { MongoClient } from 'mongodb'

const REF_DB = 'ref'
const USERS_COLLECTION = 'Users'

export type EnsureRefUserResult =
  | { skipped: true; reason: 'not_signed_in' }
  | { created: boolean; clerkId: string; email: string }

/**
 * Ensures the signed-in Clerk user exists in MongoDB `ref.Users`.
 * Uses `clerkId` as the logical primary key; does not duplicate if already present.
 */
export const ensureRefUser = createServerFn({ method: 'POST' }).handler(
  async (): Promise<EnsureRefUserResult> => {
    const { userId } = await auth()
    if (!userId) {
      return { skipped: true, reason: 'not_signed_in' }
    }

    const uri = process.env.MONGODB_URI
    if (!uri) {
      throw new Error('MONGODB_URI is not set')
    }

    const user = await clerkClient().users.getUser(userId)
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    )
    const email =
      primary?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      ''

    const client = new MongoClient(uri)
    await client.connect()
    try {
      const collection = client.db(REF_DB).collection(USERS_COLLECTION)
      const result = await collection.updateOne(
        { clerkId: userId },
        {
          $setOnInsert: {
            clerkId: userId,
            email,
            createdAt: new Date(),
            totalSessions: 0,
            totalDuration: 0,
            avgSpeechRate: 0,
          },
        },
        { upsert: true },
      )

      const created = result.upsertedCount === 1

      return { created, clerkId: userId, email }
    } finally {
      await client.close()
    }
  },
)
