import type { Metadata, Viewport } from "next";
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
  description: "Commercial equipment service management — from request to invoice",
  appleWebApp: {
    capable: true,
    title: "EquipmentIQ",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#00a3a6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${sora.variable} h-full antialiased`}
      data-theme="equipmentiq"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#eef2f5] text-[#1e2a36] overflow-x-clip" suppressHydrationWarning>
        <HydrationAttrGuard />
        <ThemeLock />
        {children}
      </body>
    </html>
  );
}
