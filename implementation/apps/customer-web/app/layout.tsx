import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@fairbite/brand";
import "./globals.css";
export const metadata: Metadata = {
  title: `${brand.name} | Customer`,
  description: "Customer application foundation",
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
            <span className="context">Customer</span>
          </div>
          <nav aria-label="Main navigation">
            <Link href="/">Home</Link>
            <Link href="/status">Service status</Link>
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer>
          Public foundation · Role authentication is not implemented.
        </footer>
      </body>
    </html>
  );
}
