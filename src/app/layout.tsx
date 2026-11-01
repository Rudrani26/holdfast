import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Public Sans for reading, Bricolage Grotesque for headings and figures, mono only for PayPal IDs and codes.
const publicSans = Public_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Holdfast · fair rental deposits on PayPal",
  description: "Rental deposits held with PayPal, damage proposed by Gemini from photos, priced by the shop's list, settled only after the renter agrees. Sandbox demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
