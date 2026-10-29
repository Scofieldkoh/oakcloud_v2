import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  BizFileReviewDraft,
  BizFileReviewSectionId,
} from "@/lib/validations/bizfile-review";
import { BizFileReviewSections } from "@/components/companies/bizfile-review/bizfile-review-sections";

const fullDraft: BizFileReviewDraft = {
  entityDetails: {
    uen: "202400001A",
    name: "Example Pte. Ltd.",
    formerName: "Old Example",
    dateOfNameChange: "2024-01-01",
    formerNames: [
      {
        name: "First Example",
        effectiveFrom: "2020-01-01",
        effectiveTo: "2023-12-31",
      },
    ],
    entityType: "PRIVATE_LIMITED",
    status: "LIVE",
    statusDate: "2024-01-02",
    incorporationDate: "2020-01-01",
    registrationDate: "2020-01-02",
  },
  ssicActivities: {
    primary: { code: "62011", description: "Software development" },
    secondary: { code: "62019", description: "Other IT" },
  },
  registeredAddress: {
    block: "1",
    streetName: "Oak Street",
    level: "02",
    unit: "03",
    buildingName: "Oak House",
    postalCode: "123456",
    country: "SG",
    effectiveFrom: "2020-01-01",
  },
  mailingAddress: {
    block: "2",
    streetName: "Mail Street",
    level: "03",
    unit: "04",
    buildingName: "Mail House",
    postalCode: "654321",
    country: "SG",
  },
  paidUpCapital: { amount: 1000, currency: "SGD" },
  issuedCapital: { amount: 1200, currency: "SGD" },
  shareCapital: [
    {
      shareClass: "ORDINARY",
      currency: "SGD",
      numberOfShares: 1000,
      parValue: 1,
      totalValue: 1000,
      isPaidUp: true,
      isTreasury: false,
    },
  ],
  treasuryShares: { numberOfShares: 10, currency: "SGD" },
  homeCurrency: "SGD",
  officers: [
    {
      name: "Alex Tan",
      role: "DIRECTOR",
      identificationType: "NRIC",
      identificationNumber: "S1234567A",
      nationality: "SG",
      address: "1 Oak Street",
      appointmentDate: "2020-01-01",
      cessationDate: "2025-01-01",
    },
  ],
  shareholders: [
    {
      name: "Jamie Lim",
      type: "INDIVIDUAL",
      identificationType: "NRIC",
      identificationNumber: "S7654321A",
      nationality: "SG",
      placeOfOrigin: "Singapore",
      address: "2 Oak Street",
      shareClass: "ORDINARY",
      numberOfShares: 1000,
      percentageHeld: 100,
      currency: "SGD",
    },
  ],
  auditor: {
    name: "Audit LLP",
    address: "3 Oak Street",
    appointmentDate: "2021-01-01",
  },
  financialYear: { endDay: 31, endMonth: 12 },
  compliance: {
    lastAgmDate: "2025-05-01",
    lastArFiledDate: "2025-06-01",
    accountsDueDate: "2025-07-01",
    fyeAsAtLastAr: "2024-12-31",
  },
  charges: [
    {
      chargeNumber: "C1",
      chargeType: "FIXED",
      description: "Bank charge",
      chargeHolderName: "Oak Bank",
      amountSecured: 5000,
      amountSecuredText: "Five thousand",
      currency: "SGD",
      registrationDate: "2022-01-01",
      dischargeDate: "2026-01-01",
    },
  ],
  documentMetadata: { receiptNo: "ACRA123", receiptDate: "2025-01-01" },
};

function view(
  draft: BizFileReviewDraft,
  activeSection: BizFileReviewSectionId,
  onChange = vi.fn(),
) {
  return render(
    <BizFileReviewSections
      draft={draft}
      onChange={onChange}
      activeSection={activeSection}
      issues={[]}
    />,
  );
}

describe("BizFileReviewSections", () => {
  it("shows only the canonical compliance FYE as at last AR field", () => {
    view(fullDraft, "compliance");
    expect(screen.getAllByLabelText(/FYE as at last AR/i)).toHaveLength(1);
  });

  it("renders and edits the complete extraction field surface", () => {
    const onChange = vi.fn();
    let result = view(fullDraft, "entity", onChange);
    expect(screen.getByLabelText("Former names")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "Corrected Pte. Ltd." },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityDetails: expect.objectContaining({ name: "Corrected Pte. Ltd." }),
      }),
    );
    result.unmount();

    for (const [section, label] of [
      ["addresses", "Mailing street"],
      ["capital", "Treasury shares"],
      ["officers", "Identification number"],
      ["compliance", "FYE as at last AR"],
      ["charges", "Charge holder"],
      ["document", "Receipt number"],
    ] as const) {
      result = view(fullDraft, section);
      expect(screen.getByLabelText(label)).toBeInTheDocument();
      result.unmount();
    }
  });

  it("labels and maps the optional ALIAS field after the company name", () => {
    const onChange = vi.fn();
    view(fullDraft, "entity", onChange);

    const alias = screen.getByLabelText("ALIAS");
    expect(alias).toHaveAttribute("maxLength", "10");
    expect(alias).toHaveAccessibleDescription(
      "Review or edit the extracted alias before saving. Maximum 10 characters.",
    );
    expect(screen.getByLabelText("Company name").compareDocumentPosition(alias) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(alias, { target: { value: "OAK" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityDetails: expect.objectContaining({ displayAlias: "OAK" }),
      }),
    );
  });

  it("keeps blank optional singleton groups editable", () => {
    const empty: BizFileReviewDraft = {
      entityDetails: { uen: "", name: "", entityType: "", status: "" },
    };
    let result = view(empty, "addresses");
    expect(screen.getByLabelText("Mailing address")).toBeInTheDocument();
    result.unmount();
    result = view(empty, "auditor");
    expect(screen.getByLabelText("Auditor")).toBeInTheDocument();
    result.unmount();
  });

  it("hides mailing fields when the mailing address is the registered address", () => {
    function Harness() {
      const [draft, setDraft] = useState<BizFileReviewDraft>({ ...fullDraft, mailingAddressSameAsRegistered: true });
      return <><BizFileReviewSections draft={draft} onChange={setDraft} activeSection="addresses" issues={[]} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
    }
    render(<Harness />);
    const checkbox = screen.getByRole("checkbox", { name: "Same as Registered Address" });
    expect(screen.queryByLabelText("Mailing street")).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByLabelText("Mailing street")).toHaveValue("");
    expect(screen.getByLabelText("Mailing postal code")).toHaveValue("");
    expect(screen.getByTestId("draft")).toHaveTextContent('"mailingAddressSameAsRegistered":false');
    expect(screen.getByTestId("draft")).not.toHaveTextContent('Mail Street');
  });

  it("preserves row focus across immutable edits and middle-row operations", () => {
    function Harness() {
      const [draft, setDraft] = useState<BizFileReviewDraft>({
        ...fullDraft,
        officers: [
          { name: "Alice", role: "DIRECTOR" },
          { name: "Bob", role: "SECRETARY" },
          { name: "Carol", role: "CEO" },
        ],
      });
      return (
        <BizFileReviewSections
          draft={draft}
          onChange={setDraft}
          activeSection="officers"
          issues={[]}
        />
      );
    }
    render(<Harness />);
    const alice = screen.getAllByLabelText("Name")[0];
    alice.focus();
    fireEvent.change(alice, { target: { value: "Alicia" } });
    expect(screen.getAllByLabelText("Name")[0]).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
    expect(screen.getAllByLabelText("Name")[0]).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Undo remove Bob" }));
    expect(screen.getAllByLabelText("Name")[1]).toHaveFocus();
    expect(
      screen
        .getAllByLabelText("Name")
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(["Alicia", "Bob", "Carol"]);
  });

  it("clears optional numbers, never emits NaN, and leaves blank required numbers invalid", () => {
    function Harness() {
      const [draft, setDraft] = useState(fullDraft);
      return (
        <>
          <BizFileReviewSections
            draft={draft}
            onChange={setDraft}
            activeSection="capital"
            issues={[]}
          />
          <output data-testid="draft">{JSON.stringify(draft)}</output>
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Par value"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("draft")).not.toHaveTextContent('"parValue"');
    fireEvent.change(screen.getByLabelText("Number of shares"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Number of shares")).toHaveValue(null);
    expect(screen.getByTestId("draft")).not.toHaveTextContent("NaN");
    expect(screen.getByTestId("draft")).not.toHaveTextContent(
      '"numberOfShares":0',
    );
  });

  it("offers every accepted mapped entity type, status, and officer role", () => {
    let result = view(fullDraft, "entity");
    expect(
      Array.from(
        (screen.getByLabelText("Entity type") as HTMLSelectElement).options,
      ).map((option) => option.value),
    ).toEqual(
      expect.arrayContaining([
        "EXEMPTED_PRIVATE_LIMITED",
        "PUBLIC_COMPANY_LIMITED_BY_GUARANTEE",
        "LIMITED_PARTNERSHIP",
        "FOREIGN_COMPANY",
        "VARIABLE_CAPITAL_COMPANY",
      ]),
    );
    expect(
      Array.from(
        (screen.getByLabelText("Status") as HTMLSelectElement).options,
      ).map((option) => option.value),
    ).toEqual(
      expect.arrayContaining([
        "WINDING_UP",
        "IN_RECEIVERSHIP",
        "AMALGAMATED",
        "CONVERTED",
      ]),
    );
    result.unmount();
    result = view(fullDraft, "officers");
    expect(
      Array.from(
        (screen.getByLabelText("Officer role") as HTMLSelectElement).options,
      ).map((option) => option.value),
    ).toEqual(
      expect.arrayContaining([
        "MANAGING_DIRECTOR",
        "ALTERNATE_DIRECTOR",
        "LIQUIDATOR",
        "RECEIVER",
        "JUDICIAL_MANAGER",
      ]),
    );
    result.unmount();
  });

  it("marks a shareholder as a nominee in the BizFile review", () => {
    const onChange = vi.fn();
    view(fullDraft, "shareholders", onChange);
    const checkbox = screen.getByRole("checkbox", { name: "Nominee shareholder" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        shareholders: [expect.objectContaining({ isNominee: true })],
      }),
    );
  });

  it("connects scalar and indexed issues to their exact controls", () => {
    const issues = [
      {
        path: "entityDetails.status",
        message: "Choose status",
        section: "entity" as const,
      },
      {
        path: "officers.0.identificationNumber",
        message: "Invalid ID",
        section: "officers" as const,
      },
    ];
    let result = render(
      <BizFileReviewSections
        draft={fullDraft}
        onChange={vi.fn()}
        activeSection="entity"
        issues={issues}
      />,
    );
    expect(screen.getByLabelText("Status")).toHaveAccessibleDescription(
      "Choose status",
    );
    result.unmount();
    result = render(
      <BizFileReviewSections
        draft={fullDraft}
        onChange={vi.fn()}
        activeSection="officers"
        issues={issues}
      />,
    );
    expect(
      screen.getByLabelText("Identification number"),
    ).toHaveAccessibleDescription("Invalid ID");
    result.unmount();
  });

  it("visibly selects canonical options for extraction aliases", () => {
    const aliased = { ...fullDraft, entityDetails: { ...fullDraft.entityDetails, entityType: "PRIVATE LIMITED", status: "LIVE COMPANY" }, officers: [{ ...fullDraft.officers![0], role: "COMPANY SECRETARY", identificationType: "NATIONAL REGISTRATION IDENTITY CARD" }], shareholders: [{ ...fullDraft.shareholders![0], identificationType: "UNIQUE ENTITY NUMBER" }] };
    let result = view(aliased, "entity");
    expect(screen.getByLabelText("Entity type")).toHaveValue("PRIVATE_LIMITED");
    expect(screen.getByLabelText("Status")).toHaveValue("LIVE");
    result.unmount();
    result = view(aliased, "officers");
    expect(screen.getByLabelText("Officer role")).toHaveValue("SECRETARY");
    expect(screen.getByLabelText("Identification type")).toHaveValue("NRIC");
    expect(screen.getByRole("option", { name: "NRIC" })).toBeVisible();
    expect(screen.getByRole("option", { name: "FIN" })).toBeVisible();
    result.unmount();
    result = view(aliased, "shareholders");
    expect(screen.getByLabelText("Identification type")).toHaveValue("UEN");
  });

  it.each([
    ["officers", "NATIONAL REGISTRATION IDENTITY CARD", "NRIC"],
    ["officers", "FOREIGN IDENTIFICATION NUMBER", "FIN"],
    ["shareholders", "UNIQUE ENTITY NUMBER", "UEN"],
  ] as const)("edits and saves canonical %s identification aliases", (section, alias, canonical) => {
    function Harness() {
      const [draft, setDraft] = useState<BizFileReviewDraft>({
        ...fullDraft,
        officers: [{ ...fullDraft.officers![0], identificationType: section === "officers" ? alias : "NRIC" }],
        shareholders: [{ ...fullDraft.shareholders![0], identificationType: section === "shareholders" ? alias : "NRIC" }],
      });
      return <><BizFileReviewSections draft={draft} onChange={setDraft} activeSection={section} issues={[]} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
    }
    render(<Harness />);
    expect(screen.getByLabelText("Identification type")).toHaveValue(canonical);
    fireEvent.change(screen.getByLabelText("Identification type"), { target: { value: canonical } });
    expect(screen.getByTestId("draft")).toHaveTextContent(`"identificationType":"${canonical}"`);
  });

  it.each(["officers", "shareholders"] as const)("clears optional %s identification type", (section) => {
    function Harness() {
      const [draft, setDraft] = useState(fullDraft);
      return <><BizFileReviewSections draft={draft} onChange={setDraft} activeSection={section} issues={[]} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Identification type"), { target: { value: "" } });
    expect(screen.getByTestId("draft")).not.toHaveTextContent('"identificationType":""');
  });
});
