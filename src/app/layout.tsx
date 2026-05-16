import type { Metadata, Viewport } from "next";
import "./globals.css";
import { IBM_Plex_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Home, ShoppingCart, Utensils, Package } from "lucide-react";
import { TabBar, type Tab } from "@/components/ui/tab-bar";
import { cn } from "@/lib/utils";

const TABS: Tab[] = [
  { href: "/dashboard", label: "Home", icon: <Home /> },
  { href: "/recipes", label: "Meals", icon: <Utensils /> },
  { href: "/shopping", label: "Shop", icon: <ShoppingCart /> },
  { href: "/inventory", label: "Inventory", icon: <Package /> },
];

const plex = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const APP_NAME = "Zomaid";
const APP_DESCRIPTION = "Zomaid PWA";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={cn("font-sans", plex.variable)}>
        <body className="min-h-dvh antialiased pb-[calc(56px+env(safe-area-inset-bottom))]">
          {process.env.NODE_ENV === "development" && (
            // TEMP DIAGNOSTIC: react-server-dom-turbopack's flushComponentPerformance
            // can call performance.measure(name, { start: 0, end: -Infinity }) when an
            // RSC chunk's status is 'rejected', which Chrome rejects with a TypeError
            // whose stack only shows "measure [native code]" — masking the real error.
            // Remove once the upstream React 19 RSC perf-track bug is patched.
            <script
              dangerouslySetInnerHTML={{
                __html: `(function(){if(typeof performance==="undefined"||window.__measureFixApplied)return;window.__measureFixApplied=true;var orig=performance.measure.bind(performance);performance.measure=function(name,a,b){try{if(a&&typeof a==="object"){var s=a.start,e=a.end;if(typeof s==="number"&&typeof e==="number"&&(!isFinite(s)||!isFinite(e)||s>e)){console.warn("[dev] swallowed perf.measure TypeError",{name:name,start:s,end:e});return undefined;}}return orig(name,a,b);}catch(err){console.warn("[dev] swallowed perf.measure error",name,err);return undefined;}};})();`,
              }}
            />
          )}
          {children}
          <TabBar tabs={TABS} />
        </body>
      </html>
    </ClerkProvider>
  );
}
