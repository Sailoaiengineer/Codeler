import { Logo } from './logo'

// Nothing to do here directly: sign-in always starts from the desktop app.
export default function Home() {
  return (
    <main className="page">
      <div className="card">
        <Logo size={48} />
        <h1>Codeler</h1>
        <p className="muted">To sign in, open Codeler on your computer and choose Sign in with Google.</p>
      </div>
    </main>
  )
}
