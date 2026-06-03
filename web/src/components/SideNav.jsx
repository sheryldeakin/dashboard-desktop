/* Left sidebar nav. Two groups:
   - Primary: daily-driver routes (Today / Tasks / Focus / Stats / History)
   - System: utility/admin routes, pinned to the bottom of the sidebar
     (Display / Edit / Settings). Matches the convention in Linear/Things/
     Todoist where settings + system surfaces sit at the bottom, separate
     from primary navigation. */

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

function Link({ href, label, active }) {
  return (
    <a
      href={href}
      className={active ? "side-nav-link is-active" : "side-nav-link"}
    >
      {label}
    </a>
  );
}

export default function SideNav() {
  const path = window.location.pathname;
  const isFocusActive =
    path === "/todo" && window.location.search.includes("focus=1");

  return (
    <aside className="side-nav" aria-label="Main navigation">
      <div className="side-nav-brand">Dashboard</div>

      <nav className="side-nav-links side-nav-links-primary">
        {PRIMARY_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            label={label}
            active={isActiveLink(href, path, isFocusActive)}
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
          />
        ))}
      </nav>
    </aside>
  );
}
