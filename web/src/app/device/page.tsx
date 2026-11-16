'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Logo } from '@/app/logo'

type Step = 'checking' | 'ready' | 'bad-code' | 'approved' | 'denied' | 'error'

// The desktop app opens this page with ?user_code=ABCD-EFGH. The person signs in with Google,
// checks the code matches the one in the app, and approves. The app then picks up its session.
function Device() {
  const params = useSearchParams()
  const { data: session, isPending } = authClient.useSession()
  const [code, setCode] = useState((params.get('user_code') ?? '').toUpperCase())
  const [typed, setTyped] = useState(code)
  const [step, setStep] = useState<Step>('checking')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session || !code) return
    let live = true
    setStep('checking')
    authClient.device({ query: { user_code: code } }).then(({ data, error }) => {
      if (!live) return
      setStep(error || !data ? 'bad-code' : 'ready')
    })
    return () => { live = false }
  }, [session, code])

  const act = async (approve: boolean) => {
    setBusy(true)
    const { error } = approve
      ? await authClient.device.approve({ userCode: code })
      : await authClient.device.deny({ userCode: code })
    setBusy(false)
    setStep(error ? 'error' : approve ? 'approved' : 'denied')
  }

  if (isPending) return <Card><p className="muted">Loading…</p></Card>

  if (!session) {
    return (
      <Card>
        <h1>Sign in to Codeler</h1>
        <p className="muted">Codeler on your computer is asking to sign in.</p>
        {code && <CodeBox code={code} />}
        <button className="primary wide" onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: window.location.href })}>
          <GoogleMark /> Continue with Google
        </button>
      </Card>
    )
  }

  if (!code) {
    return (
      <Card>
        <h1>Enter the code from Codeler</h1>
        <p className="muted">It's shown in the app's sign-in box.</p>
        <form onSubmit={e => { e.preventDefault(); setCode(typed.trim().toUpperCase()) }}>
          <label htmlFor="code">Code</label>
          <input id="code" className="input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="ABCD-EFGH" autoComplete="off" autoFocus maxLength={12} />
          <button className="primary wide" disabled={!typed.trim()}>Continue</button>
        </form>
      </Card>
    )
  }

  return (
    <Card>
      {step === 'checking' && <p className="muted">Checking the code…</p>}
      {step === 'bad-code' && <>
        <h1>That code didn't work</h1>
        <p className="muted">It may have expired (codes last 10 minutes). Start signing in again from Codeler.</p>
      </>}
      {step === 'ready' && <>
        <h1>Allow Codeler to sign in?</h1>
        <p className="muted">Signed in as <b>{session.user.email}</b>. Only allow this if the code below matches the one in Codeler.</p>
        <CodeBox code={code} />
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => act(false)}>Deny</button>
          <button className="primary" disabled={busy} onClick={() => act(true)}>Allow</button>
        </div>
        <button className="link" onClick={() => authClient.signOut().then(() => window.location.reload())}>Not you? Use another Google account</button>
      </>}
      {step === 'approved' && <>
        <h1>You're signed in</h1>
        <p className="muted">Go back to Codeler. You can close this tab.</p>
      </>}
      {step === 'denied' && <>
        <h1>Sign-in denied</h1>
        <p className="muted">Codeler wasn't given access. You can close this tab.</p>
      </>}
      {step === 'error' && <>
        <h1>Something went wrong</h1>
        <p className="muted">Start signing in again from Codeler.</p>
      </>}
    </Card>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <div className="card">
        <Logo size={48} />
        {children}
      </div>
    </main>
  )
}

function CodeBox({ code }: { code: string }) {
  return <div className="code" aria-label="Sign-in code">{code}</div>
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export default function Page() {
  return <Suspense><Device /></Suspense>
}
