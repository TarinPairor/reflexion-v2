import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { MongoClient } from 'mongodb'

/** Server-only: connects to Atlas and reads `Test` DB / `Test` collection. */
const fetchTestDocuments = createServerFn({ method: 'GET' }).handler(async () => {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error(
      'Set MONGODB_URI in .env (e.g. mongodb+srv://user:pass@ref.5l9bxw9.mongodb.net/?appName=ref)',
    )
  }

  const client = new MongoClient(uri)
  await client.connect()
  try {
    const docs = await client.db('Test').collection('Test').find({}).toArray()
    return docs.map((doc) => ({
      ...doc,
      _id: doc._id.toString(),
    }))
  } finally {
    await client.close()
  }
})

export const Route = createFileRoute('/test')({
  loader: () => fetchTestDocuments(),
  component: RouteComponent,
})

function RouteComponent() {
  const documents = Route.useLoaderData()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <h1 className="mb-4 text-xl font-semibold">Test DB — Test collection</h1>
      <p className="mb-4 text-sm text-[var(--sea-ink-soft)]">
        {documents.length} document{documents.length === 1 ? '' : 's'}
      </p>
      <pre className="island-shell max-h-[min(70vh,32rem)] overflow-auto rounded-2xl p-4 text-xs leading-relaxed">
        {JSON.stringify(documents, null, 2)}
      </pre>
    </main>
  )
}
