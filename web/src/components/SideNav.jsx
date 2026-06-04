/* Left sidebar nav. Two groups:
   - Primary: daily-driver routes (Today / Tasks / Focus / Stats / History)
   - System: utility/admin routes, pinned to the bottom of the sidebar
     (Display / Edit / Settings). Matches the convention in Linear/Things/
     Todoist where settings + system surfaces sit at the bottom, separate
     from primary navigation.

   Below 720px the nav becomes a hamburger-triggered slide-in drawer
   (the dominant SaaS mobile pattern). State is owned here:
     - isOpen: boolean
     - Close on Esc, on backdrop click, on link tap, on viewport resize
       past the desktop breakpoint. */

import { useEffect, useState } from "react";

const PRIMARY_LINKS = [
  { href: "/home", label: "Today" },
  { href: "/todo", label: "Tasks" },
  { href: "/todo?focus=1", label: "Focus" },
  { href: "/stats", label: "Stats" },
  { href: "/history", label: "History" },
];

const SYSTEM_LINKS = [
  { href: "/", label: "Display" },
  { href: "/admin", label: "Edit" },
  { href: "/settings", label: "Settings" },
];

function isActiveLink(href, path, isFocusActive) {
  if (href === "/todo?focus=1") return isFocusActive;
  if (href === "/todo") return path === "/todo" && !isFocusActive;
  return path === href;
}

function Link({ href, label, active, onNavigate }) {
  return (
    <a
      href={href}
      className={active ? "side-nav-link is-active" : "side-nav-link"}
      onClick={onNavigate}
    >
      {label}
    </a>
  );
}

/* Hamburger icon — 3 stroked lines, currentColor so it inherits the
   button's text color. Drawn at 18×18 with 1.8px strokes. */
function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="2.5" y1="5" x2="15.5" y2="5" />
      <line x1="2.5" y1="9" x2="15.5" y2="9" />
      <line x1="2.5" y1="13" x2="15.5" y2="13" />
    </svg>
  );
}

/* Close (X) icon for the drawer header in mobile mode. */
function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

export default function SideNav() {
  const path = window.location.pathname;
  const isFocusActive =
    path === "/todo" && window.location.search.includes("focus=1");

  const [isOpen, setIsOpen] = useState(false);

  // Close on Escape key — accessibility convention for dismissible overlays.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Close when crossing into desktop layout (drawer no longer needed).
  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 720 && isOpen) setIsOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen]);

  // Lock body scroll while the drawer is open so the page behind
  // doesn't scroll under the user's finger on touch devices.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
  }

  // Link clicks navigate normally; we just close the drawer so the
  // user lands on the new route with a clean view.
  function handleNavigate() {
    setIsOpen(false);
  }

  return (
    <>
      {/* Hamburger trigger — only visible at the mobile breakpoint.
          Lives outside the <aside> so the drawer can slide independently. */}
      <button
        type="button"
        className="side-nav-trigger"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation"
        aria-expanded={isOpen}
        aria-controls="side-nav"
      >
        <HamburgerIcon />
      </button>

      {/* Backdrop — only rendered when drawer is open. Click closes. */}
      {isOpen && (
        <div
          className="side-nav-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        id="side-nav"
        className={`side-nav${isOpen ? " is-open" : ""}`}
        aria-label="Main navigation"
      >
        {/* Drawer header — only visible in mobile mode. Shows brand + close. */}
        <div className="side-nav-drawer-header">
          <span className="side-nav-brand-mobile">Dashboard</span>
          <button
            type="button"
            className="side-nav-close"
            onClick={closeDrawer}
            aria-label="Close navigation"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="side-nav-brand">Dashboard</div>

        <nav className="side-nav-links side-nav-links-primary">
          {PRIMARY_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              label={label}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        <nav className="side-nav-links side-nav-links-system">
          {SYSTEM_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              label={label}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}
