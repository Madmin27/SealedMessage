import "./globals.css";
import type { ReactNode } from "react";
import { Metadata } from "next";
import { Providers } from "../components/Providers";
import { FarcasterProvider } from "../components/FarcasterProvider";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://sealedmessage.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "SealedMessage | Time-Locked Messages",
  description: "Send encrypted time-locked messages on Base. Messages can only be read after the specified unlock time.",
  manifest: "/manifest.json",
  icons: {
    icon: "/image/7.png",
    apple: "/image/7.png"
  },
  openGraph: {
    title: "SealedMessage",
    description: "Time-locked encrypted messages on Base blockchain",
    url: appUrl,
    siteName: "SealedMessage",
    images: [
      {
        url: "/preview.png",
        url: "/image/9.png",
        width: 1731,
        height: 909,
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
    images: ["/image/9.png"]
  },
  other: {
    // Farcaster Frame Metadata
    'fc:frame': 'vNext',
    'fc:frame:image': `${appUrl}/image/9.png`,
    'fc:frame:image:aspect_ratio': '1.91:1',
    'fc:frame:button:1': 'Open App',
    'fc:frame:button:1:action': 'link',
    'fc:frame:button:1:target': appUrl,
    'og:image': `${appUrl}/image/9.png`
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
        <meta property="og:image" content={`${appUrl}/image/9.png`} />
        <meta property="og:image:width" content="1731" />
        <meta property="og:image:height" content="909" />
        <meta property="og:image:alt" content="SealedMessage - Time-Locked Messages on Base" />
        
        {/* Twitter Card Meta Tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="SealedMessage - Time-Locked Messages" />
        <meta name="twitter:description" content="Send encrypted time-locked messages on Base blockchain" />
        <meta name="twitter:image" content={`${appUrl}/image/9.png`} />
        
        {/* Farcaster Frame Meta Tags */}
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content={`${appUrl}/image/9.png`} />
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
            <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-6 overflow-visible sm:px-6 lg:px-10 lg:py-8">
              {children}
            </div>
          </Providers>
        </FarcasterProvider>
      </body>
    </html>
  );
}
