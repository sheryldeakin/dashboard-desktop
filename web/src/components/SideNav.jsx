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

/* Stroke-based icon set matching the /home rail icon family
   (1.8px strokes, 16×16 viewBox, currentColor). Each link in the
   nav gets one so the nav can be scanned by shape as well as label. */
const NAV_ICONS = {
  today: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M5.5 2v3M10.5 2v3M2.5 7h11" />
      <circle cx="8" cy="10" r="1.25" fill="currentColor" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="4" height="4" rx="0.8" />
      <path d="M3 5.5l1 1 1.5-1.5" />
      <path d="M8.5 5.5h5" />
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.8" />
      <path d="M8.5 11.5h5" />
    </svg>
  ),
  focus: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  stats: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 13.5V10M6 13.5V6M9.5 13.5V8M13 13.5V3.5" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2 2.5v3h3" />
      <path d="M8 5v3.2l2 1.3" />
    </svg>
  ),
  display: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M6 14h4M8 11.5V14" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 13.5h3l7-7-3-3-7 7z" />
      <path d="M9.5 3.5l3 3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M2.5 8H.9M15.1 8h-1.6M3.6 3.6L2.5 2.5M13.5 13.5l-1.1-1.1M3.6 12.4L2.5 13.5M13.5 2.5l-1.1 1.1" />
    </svg>
  ),
};

const PRIMARY_LINKS = [
  { href: "/home", label: "Today", icon: NAV_ICONS.today },
  { href: "/todo", label: "Tasks", icon: NAV_ICONS.tasks },
  { href: "/todo?focus=1", label: "Focus", icon: NAV_ICONS.focus },
  { href: "/stats", label: "Stats", icon: NAV_ICONS.stats },
  { href: "/history", label: "History", icon: NAV_ICONS.history },
];

const SYSTEM_LINKS = [
  { href: "/", label: "Display", icon: NAV_ICONS.display },
  { href: "/settings", label: "Settings", icon: NAV_ICONS.settings },
];

function isActiveLink(href, path, isFocusActive) {
  if (href === "/todo?focus=1") return isFocusActive;
  if (href === "/todo") return path === "/todo" && !isFocusActive;
  return path === href;
}

function Link({ href, label, icon, active, onNavigate }) {
  return (
    <a
      href={href}
      className={active ? "side-nav-link is-active" : "side-nav-link"}
      onClick={onNavigate}
    >
      {icon && <span className="side-nav-link-icon" aria-hidden="true">{icon}</span>}
      <span className="side-nav-link-label">{label}</span>
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
          {PRIMARY_LINKS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        <nav className="side-nav-links side-nav-links-system">
          {SYSTEM_LINKS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}
