"use client";

import Link from "next/link";
import { PropsWithChildren, useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

type ShellProps = PropsWithChildren<{
  title?: string;
}>;

const VAULT_ADDRESS = "EUjtN36p8jwsdghVhK4S3Wp7AU3CYQrhLyww37ZBYi7o";

export function Shell({ children }: ShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 960) {
        setMenuOpen(false);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link className="brand" href="/" onClick={closeMenu}>
            <span className="brand-mark">⚓</span>
            <span className="brand-text">
              <span>Corsair</span>
              <small>Autonomous vault intelligence</small>
            </span>
          </Link>

          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className={`nav-wrap ${menuOpen ? "open" : ""}`}>
            <nav className="nav">
              <Link href="/" onClick={closeMenu}>
                Home
              </Link>
              <Link href={`/vault/${VAULT_ADDRESS}`} onClick={closeMenu}>
                Vault
              </Link>
              <Link href={`/vault/${VAULT_ADDRESS}/dashboard`} onClick={closeMenu}>
                Dashboard
              </Link>
              <Link href={`/vault/${VAULT_ADDRESS}/trades`} onClick={closeMenu}>
                Trades
              </Link>
              <Link href="/agent/agent-001/reputation" onClick={closeMenu}>
                Reputation
              </Link>
            </nav>

            <div className="wallet-wrap">
              <WalletMultiButton />
            </div>
          </div>
        </div>
      </header>

      {children}

      <footer className="footer">
        <div className="container">
          Corsair Agent • Ranger vault strategy infrastructure • CARV-1
        </div>
      </footer>
    </div>
  );
}