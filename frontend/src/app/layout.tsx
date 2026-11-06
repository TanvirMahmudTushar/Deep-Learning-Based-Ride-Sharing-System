import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RealtimeProvider } from "@/lib/realtime";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cholo",
  description: "Deep learning–driven ride-sharing for Dhaka: bike, CNG and car rides with predictive matching, ETAs and safety alerts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`} style={{ colorScheme: "dark" }}>
      <body className="flex min-h-full flex-col">
        <RealtimeProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </RealtimeProvider>
        <Toaster theme="dark" position="top-right" richColors={false} />
      </body>
    </html>
  );
}
