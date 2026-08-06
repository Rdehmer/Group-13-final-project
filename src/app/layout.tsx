import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { ThemeLock } from "@/components/ThemeLock";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
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
      className={`${plusJakarta.variable} ${sora.variable} h-full antialiased`}
      data-theme="ridley"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-base-200">
        <ThemeLock />
        {children}
      </body>
    </html>
  );
}
