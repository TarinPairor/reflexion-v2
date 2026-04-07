import { auth } from '@clerk/tanstack-react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { MongoClient } from 'mongodb'

const REF_DB = 'ref'
const CONVERSATIONS_COLLECTION = 'Conversations'

export type ConversationEntry = {
  uid: string
  date: string
  time: string
  duration: number
  speechActivity: number
  avgSpeechRate: number
  wordsSpoken: number
  createdAt: Date
}

export type ConversationEntryClient = Omit<ConversationEntry, 'createdAt'> & {
  _id: string
  createdAt: string
}

export type AddConversationResult =
  | { inserted: true; _id: string }
  | { inserted: false; reason: string }

export type AddConversationInput = {
  date: string
  time: string
  duration: number
  speechActivity: number
  avgSpeechRate: number
  wordsSpoken: number
}

export const addConversationEntry = createServerFn({
  method: 'POST',
})
  .inputValidator((data: AddConversationInput) => data)
  .handler(async ({ data }): Promise<AddConversationResult> => {
    const { userId } = await auth()
    if (!userId) return { inserted: false, reason: 'not_signed_in' }

    const uri = process.env.MONGODB_URI
    if (!uri) return { inserted: false, reason: 'missing_mongodb_uri' }

    const client = new MongoClient(uri)

    try {
      await client.connect()
      const collection = client.db(REF_DB).collection<ConversationEntry>(CONVERSATIONS_COLLECTION)

      const entry: ConversationEntry = {
        uid: userId,
        date: data.date,
        time: data.time,
        duration: data.duration,
        speechActivity: data.speechActivity,
        avgSpeechRate: data.avgSpeechRate,
        wordsSpoken: data.wordsSpoken,
        createdAt: new Date(),
      }

      const result = await collection.insertOne(entry)

      if (result.insertedId) {
        return { inserted: true, _id: String(result.insertedId) }
      }

      return { inserted: false, reason: 'insert_failed' }
    } catch {
      return { inserted: false, reason: 'db_error' }
    } finally {
      await client.close()
    }
  })



export const getUserConversations = createServerFn({
  method: 'GET',
})
  .handler(async (): Promise<
    | { success: true; data: ConversationEntryClient[] }
    | { success: false; reason: string }
  > => {
    const { userId } = await auth()
    if (!userId) return { success: false, reason: 'not_signed_in' }

    const uri = process.env.MONGODB_URI
    if (!uri) return { success: false, reason: 'missing_mongodb_uri' }

    const client = new MongoClient(uri)

    try {
      await client.connect()
      const collection = client
        .db(REF_DB)
        .collection<ConversationEntry>(CONVERSATIONS_COLLECTION)

      const conversations = await collection
        .find({ uid: userId })
        .sort({ createdAt: -1 }) // newest first
        .toArray()

      // Server functions must return JSON-serializable data.
      return {
        success: true,
        data: conversations.map((conversation) => ({
          _id: String((conversation as { _id?: unknown })._id ?? ''),
          uid: conversation.uid,
          date: conversation.date,
          time: conversation.time,
          duration: conversation.duration,
          speechActivity: Math.round(conversation.speechActivity * 100) / 100,
          avgSpeechRate: conversation.avgSpeechRate,
          wordsSpoken: conversation.wordsSpoken,
          createdAt: conversation.createdAt.toISOString(),
        })),
      }
    } catch {
      return { success: false, reason: 'db_error' }
    } finally {
      await client.close()
    }
  })