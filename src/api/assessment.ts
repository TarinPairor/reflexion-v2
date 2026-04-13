import { auth } from '@clerk/tanstack-react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { MongoClient } from 'mongodb'

const REF_DB = 'ref'
const ASSESSMENTS_COLLECTION = 'Assessments'

export type AssessmentEntry = {
  uid: string
  date: string
  time: string
  orientation: number
  attention: number
  immediateRecall: number
  totalScore: number
  createdAt: Date
}

export type AssessmentEntryClient = Omit<AssessmentEntry, 'createdAt'> & {
  _id: string
  createdAt: string
}

export type AddAssessmentInput = {
  date: string
  time: string
  orientation: number
  attention: number
  immediateRecall: number
  totalScore: number
}

export type AddAssessmentResult =
  | { inserted: true; _id: string }
  | { inserted: false; reason: string }

export const addAssessmentEntry = createServerFn({
  method: 'POST',
})
  .inputValidator((data: AddAssessmentInput) => data)
  .handler(async ({ data }): Promise<AddAssessmentResult> => {
    const { userId } = await auth()
    if (!userId) return { inserted: false, reason: 'not_signed_in' }

    const uri = process.env.MONGODB_URI
    if (!uri) return { inserted: false, reason: 'missing_mongodb_uri' }

    const client = new MongoClient(uri)

    try {
      await client.connect()
      const collection = client
        .db(REF_DB)
        .collection<AssessmentEntry>(ASSESSMENTS_COLLECTION)

      const entry: AssessmentEntry = {
        uid: userId,
        date: data.date,
        time: data.time,
        orientation: data.orientation,
        attention: data.attention,
        immediateRecall: data.immediateRecall,
        totalScore: data.totalScore,
        createdAt: new Date(),
      }

      const result = await collection.insertOne(entry)
      if (result.insertedId) return { inserted: true, _id: String(result.insertedId) }
      return { inserted: false, reason: 'insert_failed' }
    } catch {
      return { inserted: false, reason: 'db_error' }
    } finally {
      await client.close()
    }
  })

export const getUserAssessments = createServerFn({
  method: 'GET',
})
  .handler(async (): Promise<
    | { success: true; data: AssessmentEntryClient[] }
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
        .collection<AssessmentEntry>(ASSESSMENTS_COLLECTION)

      const assessments = await collection
        .find({ uid: userId })
        .sort({ createdAt: -1 })
        .toArray()

      return {
        success: true,
        data: assessments.map((assessment) => ({
          _id: String((assessment as { _id?: unknown })._id ?? ''),
          uid: assessment.uid,
          date: assessment.date,
          time: assessment.time,
          orientation: assessment.orientation,
          attention: assessment.attention,
          immediateRecall: assessment.immediateRecall,
          totalScore: assessment.totalScore,
          createdAt: assessment.createdAt.toISOString(),
        })),
      }
    } catch {
      return { success: false, reason: 'db_error' }
    } finally {
      await client.close()
    }
  })
