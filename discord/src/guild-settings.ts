// Per-guild notification settings stored in KV.
// Defaults to Europe/Stockholm at 10:00 when not configured.

export interface GuildSettings {
  /** IANA timezone, e.g. "Europe/Stockholm", "America/New_York" */
  timezone: string;
  /** Hour (0–23) in that timezone to fire daily notifications */
  notificationHour: number;
}

const DEFAULT_TIMEZONE = "Europe/Stockholm";
const DEFAULT_HOUR = 10;

export function settingsKey(guildId: string): string {
  return `g:${guildId}:settings`;
}

export async function getGuildSettings(
  kv: KVNamespace,
  guildId: string,
): Promise<GuildSettings> {
  const raw = await kv.get(settingsKey(guildId));
  if (!raw) return { timezone: DEFAULT_TIMEZONE, notificationHour: DEFAULT_HOUR };
  return JSON.parse(raw);
}

/** Check if the current time falls within the guild's notification hour. */
export async function isGuildNotificationHour(
  kv: KVNamespace,
  guildId: string,
): Promise<boolean> {
  const settings = await getGuildSettings(kv, guildId);
  const localHour = getLocalHour(settings.timezone);
  return localHour === settings.notificationHour;
}

/** Get the current hour (0–23) in the given IANA timezone. */
function getLocalHour(timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });
  return parseInt(formatter.format(new Date()), 10);
}
