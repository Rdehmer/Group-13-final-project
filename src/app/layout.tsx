import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { ThemeLock } from "@/components/ThemeLock";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Equipment Service Manager",
  description: "Commercial equipment service management for Ridley Equipment Services",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} h-full antialiased`}
      data-theme="corporate"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-base-200">
        <ThemeLock />
        {children}
      </body>
    </html>
  );
}
