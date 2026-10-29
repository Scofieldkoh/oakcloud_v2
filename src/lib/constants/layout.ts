/**
 * Layout Constants
 *
 * Centralized constants for layout dimensions.
 * Using these constants ensures consistency across components.
 */

// Sidebar dimensions (in pixels)
export const SIDEBAR_WIDTH_COLLAPSED = 56; // Tailwind: w-14
export const SIDEBAR_WIDTH_EXPANDED = 224; // Tailwind: w-56
export const MOBILE_HEADER_HEIGHT = 48; // Tailwind: h-12

// Tailwind class equivalents for reference:
// - w-14 = 56px (3.5rem)
// - w-56 = 224px (14rem)
// - h-12 = 48px (3rem)

// Breakpoints (matching Tailwind defaults)
export const BREAKPOINT_SM = 640;
export const BREAKPOINT_MD = 768;
export const BREAKPOINT_LG = 1024;
export const BREAKPOINT_XL = 1280;
export const BREAKPOINT_2XL = 1536;

/**
 * Get the current sidebar width based on state
 */
export function getSidebarWidth(collapsed: boolean, isMobile: boolean): number {
  if (isMobile) return 0;
  return collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
}
