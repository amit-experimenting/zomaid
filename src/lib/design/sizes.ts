import { buttonSizes } from "@/components/ui/button";
import { inputSizes } from "@/components/ui/input";
import { iconButtonSizes } from "@/components/ui/icon-button";
import { listRowSizes } from "@/components/ui/list-row";
import { tabBarSizes } from "@/components/ui/tab-bar";
import { textareaSizes } from "@/components/ui/textarea";

export type PrimitiveSize = {
  height: number;
  /** True if this size is allowed because the surrounding row gives 44px effective tap area. */
  extendsRow?: boolean;
};

export type PrimitiveSizeMap = Record<string, PrimitiveSize>;

/** Aggregated sizes for every interactive primitive. Each primitive contributes its own map. */
export const primitiveSizes: Record<string, PrimitiveSizeMap> = {
  button: buttonSizes,
  input: inputSizes,
  textarea: textareaSizes,
  iconButton: iconButtonSizes,
  listRow: listRowSizes,
  tabBar: tabBarSizes,
};
