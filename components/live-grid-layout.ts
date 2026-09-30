// These three must agree: the name column width, the scroll-padding that
// keeps snapped stages clear of the sticky name column, and the minimum cell
// width. Tailwind needs literal class strings, so they live here as whole
// strings rather than being built from a number.
export const NAME_COL = "w-[104px] min-w-[104px] max-w-[104px]";
export const SCROLL_PAD = "[scroll-padding-left:104px]";
export const CELL_MIN_W = "min-w-[74px]";
