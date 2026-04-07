import { UserButton, Show, SignInButton, SignUpButton, useUser } from '@clerk/tanstack-react-start'

import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {

  const { user } = useUser();
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
      <div>
        <Show when="signed-in">
          <UserButton />
          {/* <pre>
            {JSON.stringify(user, null, 2)}
          </pre> */}
        </Show>
        <Show when="signed-out">
          <SignInButton
            // @ts-expect-error
            className="mr-2 rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-1.5 text-sm font-medium text-[var(--sea-ink)] shadow-sm transition hover:bg-[var(--chip-bg-hover)] hover:text-[var(--sea-ink)]"
            >
            Sign In
          </SignInButton>
          <SignUpButton
          // @ts-expect-error
            className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-1.5 text-sm font-medium text-[var(--sea-ink)] shadow-sm transition hover:bg-[var(--chip-bg-hover)] hover:text-[var(--sea-ink)]"
          >
            Sign Up
          </SignUpButton>
        </Show>
      </div>
     
        <div className="ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">

          <ThemeToggle />
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Home
          </Link>
          <Link
            to="/conversation"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Convo
          </Link>
          <Link
            to="/dashboard"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Dashboard
          </Link>
        </div>
      </nav>
    </header>
  )
}
