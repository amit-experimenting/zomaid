import Link from "next/link";
import { cn } from "@/lib/utils";

type Route = "plan" | "recipes" | "shopping" | "bills";

export function MainNav({ active }: { active: Route }) {
  const links: { route: Route; href: string; label: string }[] = [
    { route: "plan",     href: "/plan",     label: "Plan" },
    { route: "recipes",  href: "/recipes",  label: "Recipes" },
    { route: "shopping", href: "/shopping", label: "Shopping" },
  ];
  return (
    <nav aria-label="Main" className="flex gap-4 border-b border-border px-4 py-2 text-sm">
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
    </nav>
  );
}
