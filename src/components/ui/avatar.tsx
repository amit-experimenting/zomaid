import { cn } from "@/lib/utils";

const SIZES = { sm: 24, md: 32, lg: 48 } as const;
type AvatarSize = keyof typeof SIZES;

// Six saturated backgrounds, all AA against white text (verified manually before merge).
// `#A55A00` aligns with the corrected `--warning` token (originally `#B26100` in the brainstorm
// but darkened in Task 1.3 to clear AA 4.5:1 on warning-subtle).
const HASH_PALETTE = ["#3949AB", "#5C6BC0", "#1F7A3B", "#0E6E6E", "#A55A00", "#6A1B9A"] as const;

function hashIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % HASH_PALETTE.length;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

type AvatarProps = {
  name: string;
  size?: AvatarSize;
  imageUrl?: string;
  className?: string;
};

export function Avatar({ name, size = "md", imageUrl, className }: AvatarProps) {
  const px = SIZES[size];
  const fontPx = size === "sm" ? 10 : size === "md" ? 12 : 16;
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        width={px}
        height={px}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  const color = HASH_PALETTE[hashIndex(name)];
  return (
    <span
      aria-label={name}
      role="img"
      className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: px, height: px, fontSize: fontPx, background: color }}
    >
      {initials(name)}
    </span>
  );
}
