"use client";

import { useState } from "react";

export type RecipePhotoProps = {
  src: string | null;
  alt: string;
  width: number;
  height: number;
  className?: string;
};

/** djb2-style string hash → non-negative int. Deterministic, no deps. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** First non-whitespace letter of the recipe name, uppercased. */
function initial(name: string): string {
  const m = name.trim().match(/\p{L}|\p{N}/u);
  return m ? m[0].toUpperCase() : "?";
}

function PlaceholderSvg({ name, width, height, className }: {
  name: string; width: number; height: number; className?: string;
}) {
  const hue = hashString(name) % 360;
  const bg = `hsl(${hue} 60% 78%)`;
  const fg = `hsl(${hue} 55% 25%)`;
  const letter = initial(name);
  return (
    <svg
      viewBox="0 0 64 64"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={name}
    >
      <rect width="64" height="64" fill={bg} />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dy=".35em"
        fontSize="32"
        fontWeight="700"
        fill={fg}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

export function RecipePhoto({ src, alt, width, height, className }: RecipePhotoProps) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return <PlaceholderSvg name={alt} width={width} height={height} className={className} />;
  }
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
