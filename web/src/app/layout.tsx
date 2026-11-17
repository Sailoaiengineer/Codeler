import type { Metadata } from 'next'
import { connection } from 'next/server'
import './globals.css'

export const metadata: Metadata = {
  title: 'Codeler',
  description: 'Sign in to Codeler.',
  icons: { icon: '/codeler.svg' },
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Nonces only exist per request, so every page must render on request (see src/proxy.ts).
  await connection()
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
