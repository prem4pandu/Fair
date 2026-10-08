import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@fairbite/brand";
import "./globals.css";
export const metadata: Metadata = {
  title: `${brand.name} | Merchant`,
  description: "Merchant application foundation",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header>
          <div>
            <Link className="brand" href="/">
              {brand.name}
            </Link>
            <span className="context">Merchant</span>
          </div>
          <nav aria-label="Main navigation">
            <Link href="/">Home</Link>
            <Link href="/status">Service status</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/account">Account</Link>
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer>
          Password identity checkpoint · Product workflows remain in
          development.
        </footer>
      </body>
    </html>
  );
}
