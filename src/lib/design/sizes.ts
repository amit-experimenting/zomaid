import { buttonSizes } from "@/components/ui/button";

export type PrimitiveSize = {
  height: number;
  /** True if this size is allowed because the surrounding row gives 44px effective tap area. */
  extendsRow?: boolean;
};

export type PrimitiveSizeMap = Record<string, PrimitiveSize>;

/** Aggregated sizes for every interactive primitive. Each primitive contributes its own map. */
export const primitiveSizes: Record<string, PrimitiveSizeMap> = {
  button: buttonSizes,
};
