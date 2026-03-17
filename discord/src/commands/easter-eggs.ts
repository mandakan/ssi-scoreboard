// Easter-egg commands that lean into the Range Officer persona.
// All are synchronous — no API calls, no deferring needed.

import type { APIEmbed } from "discord-api-types/v10";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// /dq @user — issue a dramatic (fake) disqualification
// ---------------------------------------------------------------------------

const DQ_REASONS = [
  "Broke the 180! Muzzle pointed directly at the moon.",
  "Finger inside the trigger guard during loading. The trigger is not a stress ball.",
  "Dropped a loaded firearm. Gravity is not your friend.",
  "Swept the RO. I take that very personally.",
  "Negligent discharge into the berm. The berm did nothing to you.",
  "Left the designated shooting area with a loaded gun. Where were you going?",
  "Started the stage before the start signal. Enthusiasm is not a defence.",
  "Handled a firearm while the range was cold. Not even close, my friend.",
  "Used a holster that doesn't cover the trigger guard. Fashion is not a safety plan.",
  "Muzzle pointed at own foot during unload. Your toes filed a complaint.",
  "Abandoned a loaded firearm on the barricade. It's not a shelf.",
  "Unsportsmanlike conduct: argued with the RO about a delta. It's still a delta.",
  "Triple-tapped every target. We appreciate the enthusiasm, but rules are rules.",
  "Wore crocs on the range. That's not in the rulebook, but it should be.",
] as const;

export function handleDq(targetUserId?: string): { content: string; embeds: APIEmbed[] } {
  const reason = pick(DQ_REASONS);
  const mention = targetUserId ? `<@${targetUserId}>` : "You";
  const content =
    `**STOP! STOP! STOP!**\n\n` +
    `${mention} — you have been **disqualified**.\n` +
    `> ${reason}\n\n` +
    `Please unload and show clear. If clear, hammer down, holster. ` +
    `You may now accompany me to the safe area.`;

  return { content, embeds: [] };
}

// ---------------------------------------------------------------------------
// /standby — random-delay start signal
// ---------------------------------------------------------------------------

// No real delay in a slash command (we respond instantly), but we simulate
// the tension with the RO sequence. The "delay" is narrative flavour.
const STANDBY_DELAYS = [
  "1.2",
  "1.7",
  "2.1",
  "2.5",
  "0.9",
  "3.0",
  "1.4",
  "2.8",
  "1.1",
  "2.3",
] as const;

export function handleStandby(): { content: string; embeds: APIEmbed[] } {
  const delay = pick(STANDBY_DELAYS);
  const content =
    `*Load and make ready...*\n` +
    `*Are you ready?*\n` +
    `*Standby...*\n\n` +
    `# BEEP!\n` +
    `-# (${delay}s delay)`;

  return { content, embeds: [] };
}

// ---------------------------------------------------------------------------
// /mike — announce a miss
// ---------------------------------------------------------------------------

const MIKE_REACTIONS = [
  "That wasn't even close.",
  "The target filed a restraining order.",
  "Did you close both eyes?",
  "The bullet is still looking for that target.",
  "I've seen better accuracy from a garden hose.",
  "That round is in a different zip code.",
  "Somewhere, a backstop is very disappointed.",
  "Not even the tape can save that one.",
  "Your sights called. They said they've never met you.",
  "That's a miss. And the target behind it? Also a miss.",
  "The steel will stop laughing eventually.",
  "I'd call it a close miss, but I'd be lying about the close part.",
] as const;

export function handleMike(): { content: string; embeds: APIEmbed[] } {
  const reaction = pick(MIKE_REACTIONS);
  const content = `**MIKE!**\n> ${reaction}`;
  return { content, embeds: [] };
}

// ---------------------------------------------------------------------------
// /delta — passive-aggressive encouragement for a marginal hit
// ---------------------------------------------------------------------------

const DELTA_REACTIONS = [
  "Well... it hit the paper.",
  "Technically on target. Technically.",
  "The scoring zone is more of a suggestion, apparently.",
  "A delta is just an alpha that took the scenic route.",
  "Your bullet found the target. Eventually.",
  "That's the participation trophy of hit zones.",
  "Close enough for government work, but not for IPSC.",
  "The target accepted your hit, reluctantly.",
  "Hey, at least it's not a mike. That's something.",
  "If deltas were worth double, you'd be winning.",
  "I see you've chosen the 'spray and pray' technique.",
  "That hit has the same energy as a C+ on a test.",
] as const;

export function handleDelta(): { content: string; embeds: APIEmbed[] } {
  const reaction = pick(DELTA_REACTIONS);
  const content = `**Delta.** ${reaction}`;
  return { content, embeds: [] };
}

// ---------------------------------------------------------------------------
// /procedural @user — issue a fake procedural penalty
// ---------------------------------------------------------------------------

const PROCEDURAL_INFRACTIONS = [
  "Failure to engage the snack table between stages.",
  "Shooting a stage without complaining about the stage design first.",
  "Excessive celebration after a clean run (unsportsmanlike vibes).",
  "Failure to blame the ammunition for bad hits.",
  "Discussing hit factors before the match is over. Jinxing is a procedural.",
  "Using a shot timer as an alarm clock. That's not what it's for.",
  "Offering unsolicited coaching advice to the squad leader.",
  "Taking more than 3 photos of your holster setup before Stage 1.",
  "Performing a practice draw in the parking lot. We all saw you.",
  "Eating during the stage briefing. Yes, even if it's a banana.",
  "Wearing a jersey that doesn't match your skill level.",
  "Asking \"what's the hit factor to beat?\" on the first stage.",
  "Starting a conversation about reloading recipes at the safe area.",
  "Walking the stage more than 5 times. It's not getting shorter.",
] as const;

export function handleProcedural(targetUserId?: string): { content: string; embeds: APIEmbed[] } {
  const infraction = pick(PROCEDURAL_INFRACTIONS);
  const mention = targetUserId ? `<@${targetUserId}>` : "Competitor";
  const content =
    `**Procedural penalty!**\n\n` +
    `${mention} has been assessed a procedural for:\n` +
    `> ${infraction}\n\n` +
    `+10 seconds. No alibis.`;

  return { content, embeds: [] };
}
