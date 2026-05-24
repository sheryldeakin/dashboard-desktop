const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/todo", label: "Tasks" },
  { href: "/todo?focus=1", label: "Focus" },
  { href: "/admin", label: "Edit" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function TopNav() {
  const path = window.location.pathname;
  const isFocusActive = path === "/todo" && window.location.search.includes("focus=1");

  const isActive = (href) => {
    if (href === "/todo?focus=1") return isFocusActive;
    if (href === "/todo") return path === "/todo" && !isFocusActive;
    return path === href;
  };

  return (
    <nav className="top-nav" aria-label="Main navigation">
      {NAV_LINKS.map(({ href, label }) => (
        <a
          key={href}
          href={href}
          className={isActive(href) ? "top-nav-link active" : "top-nav-link"}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
