import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrganizerPublishedBadge } from "@/components/organizer-published-badge";
import type { Visibility } from "@/lib/types";

const PUBLIC: Visibility = {
  class: "public",
  rawCode: "pub",
  displayName: "Public, searchable and details/names for all",
};

const UNLISTED: Visibility = {
  class: "unlisted",
  rawCode: "lim",
  displayName: "Limited, not searchable and details/names for all",
};

const ORGANIZER_PUBLISHED: Visibility = {
  class: "organizer-published",
  rawCode: "csd",
  displayName: "Closed, not searchable and details/names only participants",
};

describe("OrganizerPublishedBadge", () => {
  it("renders nothing for public matches", () => {
    const { container } = render(<OrganizerPublishedBadge visibility={PUBLIC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for unlisted matches (full names public on SSI)", () => {
    const { container } = render(<OrganizerPublishedBadge visibility={UNLISTED} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders badge for organizer-published matches with accessible name", () => {
    render(<OrganizerPublishedBadge visibility={ORGANIZER_PUBLISHED} />);
    const trigger = screen.getByRole("button", {
      name: /Published by organizer/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/Published by organizer/i);
  });
});
