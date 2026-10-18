/** The Settings page's three tabs (names settled by the user, 5 Oct 2026). */
export const SETTINGS_TABS = ['analysis', 'visualize', 'mcp'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const TAB_LABELS: Record<SettingsTab, string> = { analysis: 'Analysis', visualize: 'Visualize', mcp: 'MCP' };

/** The tab an address names (`?tab=mcp`), or Analysis. */
export function tabFrom(search: string): SettingsTab {
  const tab = new URLSearchParams(search).get('tab');
  return SETTINGS_TABS.find((t) => t === tab) ?? 'analysis';
}
