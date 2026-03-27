import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { GlobalAutoRefresh } from "@/components/GlobalAutoRefresh";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "ZapMarket Automation",
  description: "Dashboard SaaS para automações no WhatsApp.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${plusJakartaSans.variable} ${sora.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <GlobalAutoRefresh />
        {children}
      </body>
    </html>
  );
}
