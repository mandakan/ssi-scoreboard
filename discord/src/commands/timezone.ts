// Handler for /timezone <timezone> [hour]
// Configures when daily notifications (registration, squad, personal)
// are delivered for this guild. Stored per-guild in KV.

import { settingsKey, getGuildSettings, type GuildSettings } from "../guild-settings";

/**
 * Validate that a timezone string is a valid IANA timezone.
 * Uses Intl.DateTimeFormat which throws on invalid timezones.
 */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function handleTimezone(
  kv: KVNamespace,
  guildId: string,
  timezone: string,
  hour?: number,
): Promise<string> {
  if (!isValidTimezone(timezone)) {
    return (
      `"${timezone}" is not a valid timezone.\n\n` +
      "Use an IANA timezone like `Europe/Stockholm`, `America/New_York`, or `Asia/Tokyo`.\n" +
      "Full list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>"
    );
  }

  const settings = await getGuildSettings(kv, guildId);
  const updated: GuildSettings = {
    timezone,
    notificationHour: hour ?? settings.notificationHour,
  };

  await kv.put(settingsKey(guildId), JSON.stringify(updated));

  // Show what time that means right now
  const formatter = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
  const nowLocal = formatter.format(new Date());

  return (
    `Daily notifications set to **${String(updated.notificationHour).padStart(2, "0")}:00 ${timezone}**.\n` +
    `(Current time there: ${nowLocal})\n\n` +
    "This affects registration digests, squad reminders, and personal reminders.\n" +
    "Live match updates and achievements are unaffected (they run in real-time)."
  );
}
