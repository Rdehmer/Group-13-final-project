import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { HydrationAttrGuard } from "@/components/HydrationAttrGuard";
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
  title: "EquipmentIQ",
  description: "Smart equipment service management — field, operations, and billing in one place",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${sora.variable} h-full antialiased`}
      data-theme="ridley"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#eef2f5] text-[#1e2a36]" suppressHydrationWarning>
        <HydrationAttrGuard />
        <ThemeLock />
        {children}
      </body>
    </html>
  );
}
