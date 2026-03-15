import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal – SSI Scoreboard",
  description: "Terms of Service and Privacy Policy for SSI Scoreboard",
};

export default function LegalPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-4 pt-8 sm:p-6 sm:pt-12">
      <div className="w-full max-w-2xl space-y-10">
        <div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            ← Back to SSI Scoreboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold">Legal</h1>

        {/* Terms of Service */}
        <section aria-labelledby="tos-heading" className="space-y-4">
          <h2
            id="tos-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Terms of Service
          </h2>

          <p className="text-sm text-muted-foreground">
            By using SSI Scoreboard you agree to the following terms.
          </p>

          <div className="space-y-4 text-sm leading-relaxed">
            <div className="space-y-1">
              <h3 className="font-medium">1. Relationship with ShootNScoreIt</h3>
              <p className="text-muted-foreground">
                ShootNScoreIt (SSI) is <strong>not</strong> a party to these
                Terms of Service. SSI Scoreboard is an independent application
                that reads publicly available match data from the SSI platform.
                Any questions or complaints about SSI Scoreboard should be
                directed to the SSI Scoreboard developers, not to SSI.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">2. License to use this application</h3>
              <p className="text-muted-foreground">
                You are granted a non-transferable, non-exclusive license to use
                SSI Scoreboard solely in connection with your active SSI account
                and for personal, non-commercial purposes. This license does not
                permit you to sublicense, sell, or otherwise transfer access to
                the application to any third party.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">3. Prohibited conduct</h3>
              <p className="text-muted-foreground">
                You may not reverse-engineer, decompile, disassemble, or
                otherwise attempt to derive the source code of SSI Scoreboard
                beyond what is made available in its public repository. You may
                not modify or create derivative works of the application except
                as permitted by its open-source licence.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">4. Intellectual property</h3>
              <p className="text-muted-foreground">
                All intellectual property rights in SSI Scoreboard remain with
                their respective owners. Match data displayed in the application
                originates from ShootNScoreIt and remains the property of SSI
                and the relevant match organisers. Nothing in these terms
                transfers any IP rights to you.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">5. Disclaimer of warranties</h3>
              <p className="text-muted-foreground">
                SSI Scoreboard is provided &quot;as is&quot; without warranties of any
                kind. Match data is fetched in real time and may be incomplete,
                delayed, or inaccurate. Do not use this application for
                official scoring or results disputes.
              </p>
            </div>
          </div>
        </section>

        {/* Privacy Policy */}
        <section aria-labelledby="privacy-heading" className="space-y-4">
          <h2
            id="privacy-heading"
            className="text-xl font-semibold border-b border-border pb-2"
          >
            Privacy Policy
          </h2>

          <p className="text-sm text-muted-foreground">
            This policy explains what data SSI Scoreboard handles and how.
          </p>

          <div className="space-y-4 text-sm leading-relaxed">
            <div className="space-y-1">
              <h3 className="font-medium">1. Data fetched from SSI</h3>
              <p className="text-muted-foreground">
                When you enter a match URL or search for a competition, SSI
                Scoreboard fetches match metadata, stage definitions, and
                competitor scorecard data from the ShootNScoreIt GraphQL API.
                This includes competitor names and scores as published on
                shootnscoreit.com.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">2. Server-side data storage</h3>
              <p className="text-muted-foreground">
                SSI Scoreboard stores a cross-match index derived from
                publicly-published SSI competition results. This includes
                competitor names, club affiliations, divisions, and match
                history. This data is used solely to provide the shooter
                dashboard and cross-match statistics features. The legal basis
                for this processing is legitimate interest (GDPR Article
                6(1)(f)) — the data is already publicly available on
                shootnscoreit.com and is processed for a compatible analytical
                purpose. API responses are also cached (seconds to days) to
                reduce load on the SSI API.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">3. Local browser storage</h3>
              <p className="text-muted-foreground">
                Your browser may store recently viewed competitions in
                localStorage to power the &quot;Recent competitions&quot; feature. This
                data never leaves your device and can be cleared by clearing
                your browser&apos;s site data.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">4. SSI&apos;s responsibility</h3>
              <p className="text-muted-foreground">
                ShootNScoreIt is <strong>not</strong> responsible for the
                privacy or security of data displayed within SSI Scoreboard.
                Data shown in this application is subject to this Privacy
                Policy, not to SSI&apos;s privacy policy. For questions about the
                underlying data, refer to{" "}
                <a
                  href="https://www.shootnscoreit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  shootnscoreit.com
                </a>
                .
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">5. Third-party services</h3>
              <p className="text-muted-foreground">
                SSI Scoreboard may be hosted on infrastructure that collects
                standard server logs (IP addresses, request paths, timestamps).
                These logs are used solely for operational purposes and are not
                shared with third parties beyond what is required by the hosting
                provider.
              </p>
            </div>

            <div className="space-y-1">
              <h3 className="font-medium">6. Data removal requests</h3>
              <p className="text-muted-foreground">
                If you are an IPSC competitor and wish to have your shooter
                profile and match history removed from SSI Scoreboard, you may
                submit a removal request by emailing{" "}
                <a
                  href="mailto:privacy@urdr.dev"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  privacy@urdr.dev
                </a>
                . Please include your name and shooter ID so we can locate your
                data. Upon verification, your shooter profile, match index, and
                achievement data will be permanently deleted and your shooter ID
                will be added to a suppression list to prevent automatic
                re-indexing. This does not affect the underlying match data on
                ShootNScoreIt.
              </p>
            </div>
          </div>
        </section>

        <p className="text-xs text-muted-foreground pb-8">
          Last updated: March 2026
        </p>
      </div>
    </main>
  );
}
