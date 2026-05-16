import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

type Route = "home" | "plan" | "recipes" | "shopping" | "tasks" | "inventory";

export function MainNav({ active }: { active: Route }) {
  const links: { route: Route; href: string; label: string }[] = [
    { route: "home",     href: "/dashboard", label: "Home" },
    { route: "plan",     href: "/plan",      label: "Plan" },
    { route: "recipes",  href: "/recipes",   label: "Recipes" },
    { route: "shopping",   href: "/shopping",   label: "Shopping" },
    { route: "inventory",  href: "/inventory",  label: "Inventory" },
    { route: "tasks",      href: "/tasks",      label: "Tasks" },
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
      <UserButton />
    </nav>
  );
}
