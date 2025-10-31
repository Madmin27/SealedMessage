import "./globals.css";
import type { ReactNode } from "react";
import { Metadata } from "next";
import { Providers } from "../components/Providers";
import { FarcasterProvider } from "../components/FarcasterProvider";
import { EncryptionKeyManager } from "../components/EncryptionKeyManager";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://sealedmessage.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "SealedMessage | Time-Locked Messages",
  description: "Send encrypted time-locked messages on Base. Messages can only be read after the specified unlock time.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  },
  openGraph: {
    title: "SealedMessage",
    description: "Time-locked encrypted messages on Base blockchain",
    url: appUrl,
    siteName: "SealedMessage",
    images: [
      {
        url: "/preview.png",
        width: 1200,
        height: 800,
        alt: "SealedMessage - Time-Locked Messages on Base"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "SealedMessage",
    description: "Time-locked encrypted messages on Base blockchain",
    images: ["/preview.png"]
  },
  other: {
    // Farcaster Frame Metadata
    'fc:frame': 'vNext',
    'fc:frame:image': `${appUrl}/preview.png`,
    'fc:frame:image:aspect_ratio': '1.91:1',
    'fc:frame:button:1': 'Open App',
    'fc:frame:button:1:action': 'link',
    'fc:frame:button:1:target': appUrl,
    'og:image': `${appUrl}/preview.png`
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Open Graph Meta Tags */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={appUrl} />
        <meta property="og:title" content="SealedMessage - Time-Locked Messages" />
        <meta property="og:description" content="Send encrypted time-locked messages on Base blockchain" />
        <meta property="og:image" content={`${appUrl}/preview.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="800" />
        <meta property="og:image:alt" content="SealedMessage - Time-Locked Messages on Base" />
        
        {/* Twitter Card Meta Tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="SealedMessage - Time-Locked Messages" />
        <meta name="twitter:description" content="Send encrypted time-locked messages on Base blockchain" />
        <meta name="twitter:image" content={`${appUrl}/preview.png`} />
        
        {/* Farcaster Frame Meta Tags */}
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content={`${appUrl}/preview.png`} />
        <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
        <meta property="fc:frame:button:1" content="Open App" />
        <meta property="fc:frame:button:1:action" content="link" />
        <meta property="fc:frame:button:1:target" content={appUrl} />
        
        {/* Polyfill for libraries expecting a global object */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (typeof global === 'undefined') {
              window.global = window;
            }
          `
        }} />
      </head>
      <body className="min-h-screen bg-midnight text-slate-100" suppressHydrationWarning>
        <FarcasterProvider>
          <Providers>
            <EncryptionKeyManager />
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 overflow-visible">
              {children}
            </div>
          </Providers>
        </FarcasterProvider>
      </body>
    </html>
  );
}
