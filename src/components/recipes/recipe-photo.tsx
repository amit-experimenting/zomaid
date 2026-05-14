"use client";

import { useState } from "react";

const PLACEHOLDER = "/recipe-photo-placeholder.jpg";

export type RecipePhotoProps = {
  src: string | null;
  alt: string;
  width: number;
  height: number;
  className?: string;
};

export function RecipePhoto({ src, alt, width, height, className }: RecipePhotoProps) {
  const [errored, setErrored] = useState(false);
  const resolved = !src || errored ? PLACEHOLDER : src;
  return (
    <img
      src={resolved}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
