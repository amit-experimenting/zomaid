import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

type Route = "home" | "recipes" | "shopping" | "inventory";

// Tiny gear icon for the custom UserButton menu item.
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function MainNav({ active }: { active: Route }) {
  const links: { route: Route; href: string; label: string }[] = [
    { route: "home",       href: "/dashboard",  label: "Home" },
    { route: "recipes",    href: "/recipes",    label: "Recipes" },
    { route: "shopping",   href: "/shopping",   label: "Shopping" },
    { route: "inventory",  href: "/inventory",  label: "Inventory" },
  ];
  return (
    <nav aria-label="Main" className="flex items-center justify-between gap-4 border-b border-border px-4 py-2 text-sm">
      <div className="flex flex-wrap gap-4">
        {links.map((l) => (
          <Link
            key={l.route}
            href={l.href}
            className={cn(
              "hover:underline",
              active === l.route ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Link
            label="Household settings"
            labelIcon={<SettingsIcon />}
            href="/household/settings"
          />
        </UserButton.MenuItems>
      </UserButton>
    </nav>
  );
}
