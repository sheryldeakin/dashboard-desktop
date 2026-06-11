import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/", label: "Display" },
  { href: "/todo", label: "Tasks" },
  { href: "/todo?focus=1", label: "Focus" },
  { href: "/stats", label: "Stats" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function TopNav() {
  const location = useLocation();
  const path = location.pathname;
  const isFocusActive = path === "/todo" && location.search.includes("focus=1");

  const isActive = (href) => {
    if (href === "/todo?focus=1") return isFocusActive;
    if (href === "/todo") return path === "/todo" && !isFocusActive;
    return path === href;
  };

  return (
    <nav className="top-nav" aria-label="Main navigation">
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          to={href}
          className={isActive(href) ? "top-nav-link active" : "top-nav-link"}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
