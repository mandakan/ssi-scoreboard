import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Publish a private match -- SSI Scoreboard",
  description:
    "Step-by-step guide for ShootNScoreIt match organizers: how to publish a private match to SSI Scoreboard by inviting the service account as Staff.",
};

const SERVICE_FIRST_NAME = "Scoreboard";
const SERVICE_LAST_NAME = "Urdr";
const SERVICE_EMAIL = "admin@urdr.dev";

export default function OrganizerPublishedPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-12">
      <div className="w-full max-w-2xl space-y-8">
        <div>
          <Link
            href="/about"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            ← Back to About
          </Link>
        </div>

        <h1 className="text-2xl font-bold">Publish a private match</h1>

        <section
          aria-labelledby="op-intro-heading"
          className="space-y-3 text-sm leading-relaxed text-muted-foreground"
        >
          <h2 id="op-intro-heading" className="sr-only">
            Introduction
          </h2>
          <p>
            ShootNScoreIt lets you mark a match as <em>not public</em>. Those
            matches don{"’"}t appear in our search and aren{"’"}t addressable
            here by URL -- unless you opt in.
          </p>
          <p>
            If you{"’"}re an organizer and want a private match to be viewable
            on SSI Scoreboard (with the same stage-by-stage breakdown that the
            public matches get), follow the three steps below.
          </p>
        </section>

        <section aria-labelledby="op-steps-heading" className="space-y-4">
          <h2
            id="op-steps-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            How to publish your match
          </h2>

          <ol className="space-y-4 text-sm leading-relaxed">
            <li>
              <p className="font-medium text-foreground">
                1. Invite our service account as <em>Staff</em>
              </p>
              <p className="text-muted-foreground">
                On your match page in ShootNScoreIt, open the team / staff
                section and add the account below with the{" "}
                <strong>Staff</strong> role:
              </p>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs bg-muted rounded-md p-3 text-foreground">
                <dt className="font-medium text-muted-foreground">First name</dt>
                <dd>
                  <code>{SERVICE_FIRST_NAME}</code>
                </dd>
                <dt className="font-medium text-muted-foreground">Last name</dt>
                <dd>
                  <code>{SERVICE_LAST_NAME}</code>
                </dd>
                <dt className="font-medium text-muted-foreground">Email</dt>
                <dd>
                  <code>{SERVICE_EMAIL}</code>
                </dd>
              </dl>
              <p className="text-muted-foreground mt-2">
                <strong>Important:</strong> the role must be{" "}
                <em>Staff</em> (or Admin). The <em>Assistant</em> role lets the
                bot see the match exists but doesn{"’"}t grant enough access to
                render it -- the scoreboard will skip it.
              </p>
            </li>

            <li>
              <p className="font-medium text-foreground">
                2. Pick the SSI visibility you want
              </p>
              <p className="text-muted-foreground">
                Set the match to whichever non-public visibility fits -- e.g.{" "}
                <em>Limited</em>, <em>Restricted</em>, <em>Closed</em>, or{" "}
                <em>Club members only</em>. SSI itself decides whether the match
                is searchable on shootnscoreit.com; we don{"’"}t override that.
              </p>
            </li>

            <li>
              <p className="font-medium text-foreground">
                3. Share the SSI URL
              </p>
              <p className="text-muted-foreground">
                Send the SSI match URL (the one shaped like{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">
                  shootnscoreit.com/event/22/&lt;id&gt;/
                </code>
                ) to whoever you want to give scoreboard access. They can paste
                it into our search bar or the &quot;Add match&quot; field.
              </p>
              <p className="text-muted-foreground mt-1">
                Pages on the scoreboard for these matches show a{" "}
                <strong>&quot;Published by organizer&quot;</strong> badge so
                viewers know the match isn{"’"}t fully public on SSI.
              </p>
            </li>
          </ol>
        </section>

        <section aria-labelledby="op-unpublish-heading" className="space-y-3">
          <h2
            id="op-unpublish-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            How to unpublish
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Remove the bot{"’"}s role on the match in ShootNScoreIt. The
            scoreboard will drop the match from its cache within one TTL cycle
            (typically minutes for active matches, longer for completed ones).
            New visitors will get a 404; existing tabs may show stale data
            until they refresh.
          </p>
        </section>

        <section aria-labelledby="op-faq-heading" className="space-y-3">
          <h2
            id="op-faq-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Notes
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li>
              We honour SSI{"’"}s search visibility. If the match isn{"’"}t
              searchable on SSI, it isn{"’"}t searchable here either -- only
              people who have the URL can open it.
            </li>
            <li>
              Competitor names are shown on the scoreboard the same way SSI
              would show them to a logged-in Staff member -- because that{"’"}s
              effectively how the bot is reading the data.
            </li>
            <li>
              We don{"’"}t expose any data SSI itself doesn{"’"}t already share
              with our service account. If you change the visibility on SSI,
              the change propagates here on the next refresh.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
