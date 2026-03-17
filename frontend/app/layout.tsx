import "./globals.css";
import type { Metadata } from "next";
import { CorsairWalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Corsair",
  description: "Premium vault interface for Corsair Agent and CARV-1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <CorsairWalletProvider>{children}</CorsairWalletProvider>
      </body>
    </html>
  );
}