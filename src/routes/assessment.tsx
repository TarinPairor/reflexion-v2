import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/assessment')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/assessment"!</div>
}
