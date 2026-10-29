import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAutomaticContactResolutions, BizFileReviewWorkspace } from "@/components/companies/bizfile-review/bizfile-review-workspace";
import type { ExtractedBizFileData } from "@/services/bizfile";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const fixture: ExtractedBizFileData = {
  entityDetails: { uen: "202400001A", name: "Example Pte. Ltd.", entityType: "PRIVATE_LIMITED", status: "LIVE" },
};

function setup(onConfirm = vi.fn(), overrides: Partial<React.ComponentProps<typeof BizFileReviewWorkspace>> = {}) {
  return render(<BizFileReviewWorkspace initialData={fixture} sourcePanel={<div>PDF source</div>}
    onCancel={vi.fn()} onReset={vi.fn()} onConfirm={onConfirm} {...overrides} />);
}

function useLargeViewport() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true, media: "(min-width: 1024px)", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

describe("BizFileReviewWorkspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("automatically reuses an unconflicted contact with the same name and identifier", () => {
    const data: ExtractedBizFileData = {
      ...fixture,
      officers: [{ name: "Alex Tan", role: "DIRECTOR", identificationType: "NRIC", identificationNumber: "S1234567A" }],
    };
    const resolved = applyAutomaticContactResolutions(data, {
      "officers.0": {
        contactId: "00000000-0000-4000-8000-000000000001", score: 1, automatic: true,
        blockedByIdentifierConflict: false, reasons: ["IDENTIFIER"], conflicts: [],
        contact: { id: "00000000-0000-4000-8000-000000000001", fullName: "Alex Tan", identificationType: "NRIC", identificationNumber: "S1234567A", corporateUen: null, companies: [] },
      },
    });

    expect(resolved.officers?.[0].contactResolution).toEqual({
      action: "REUSE", contactId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("does not prompt for an exact name-and-identifier contact match", async () => {
    const onConfirm = vi.fn();
    const exactFixture: ExtractedBizFileData = {
      ...fixture,
      officers: [{ name: "Tan Tze Yong (Chen Zhiyong)", role: "DIRECTOR", identificationType: "NRIC", identificationNumber: "S8005231F" }],
    };
    const exactMatch = {
      contactId: "00000000-0000-4000-8000-000000000001", score: 1, automatic: true,
      blockedByIdentifierConflict: false, reasons: ["IDENTIFIER"], conflicts: [],
      contact: { id: "00000000-0000-4000-8000-000000000001", fullName: "Tan Tze Yong (Chen Zhiyong)", identificationType: "NRIC", identificationNumber: "S8005231F", corporateUen: null, companies: [] },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ matches: { "officers.0": exactMatch } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BizFileReviewWorkspace initialData={exactFixture} sourcePanel={<div>PDF source</div>}
      onCancel={vi.fn()} onReset={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Review section" }), { target: { value: "officers" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Existing contact match")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose how to resolve this contact match")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      officers: [expect.objectContaining({ contactResolution: { action: "REUSE", contactId: exactMatch.contactId } })],
    })));
  });

  it("shows extraction metadata in the bottom-left footer", () => {
    setup(vi.fn(), { extractionMetadata: <span>GPT-5 · 1,234 tokens · Est. $0.01</span> });
    expect(within(screen.getByRole("contentinfo")).getByText(/GPT-5.*1,234 tokens.*Est\. \$0\.01/)).toBeVisible();
  });

  it("blocks invalid confirmation, focuses the field, and submits normalized corrections", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    expect(screen.queryByText("Review extracted information")).not.toBeInTheDocument();
    expect(screen.queryByText("10 sections")).not.toBeInTheDocument();
    const name = screen.getByLabelText("Company name");
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Company name is required")).toBeVisible();
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: "  Corrected Pte. Ltd.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      entityDetails: expect.objectContaining({ name: "Corrected Pte. Ltd." }),
    })));
    await screen.findByText("Save completed.");
  });

  it("shows section issue counts and attention states", () => {
    useLargeViewport();
    setup();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "" } });
    expect(screen.getByRole("tab", { name: /Entity.*1 error/i })).toBeVisible();
  });

  it("previews officer matches, blocks an undecided save, and persists explicit reuse", async () => {
    const onConfirm = vi.fn();
    const previewFixture: ExtractedBizFileData = {
      ...fixture,
      officers: [{ name: "王小明", role: "DIRECTOR" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: {
          "officers.0": {
            contactId: "00000000-0000-4000-8000-000000000001",
            score: 1,
            automatic: true,
            blockedByIdentifierConflict: false,
            reasons: ["EXACT_CANONICAL_NAME"],
            conflicts: [],
            contact: {
              id: "00000000-0000-4000-8000-000000000001",
              fullName: "王小明",
              identificationType: "NRIC",
              identificationNumber: "S1234567A",
              corporateUen: null,
              companies: [{ id: "company-1", name: "Example Pte. Ltd.", uen: "202400001A" }],
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BizFileReviewWorkspace initialData={previewFixture} sourcePanel={<div>PDF source</div>}
      onCancel={vi.fn()} onReset={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Review section" }), { target: { value: "officers" } });
    expect(await screen.findByText("Existing contact match")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/contacts/match-preview", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("link", { name: "王小明" })).toHaveAttribute("href", "/contacts/00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("link", { name: /Example Pte\. Ltd\./ })).toHaveAttribute("href", "/companies/company-1");

    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(await screen.findByText("Choose how to resolve this contact match")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      officers: [expect.objectContaining({
        contactResolution: { action: "REUSE", contactId: "00000000-0000-4000-8000-000000000001" },
      })],
    })));
  });

  it("chunks more than 100 combined officer and shareholder candidates before save", async () => {
    const onConfirm = vi.fn();
    const manyRecords: ExtractedBizFileData = {
      ...fixture,
      officers: Array.from({ length: 51 }, (_, index) => ({ name: `Officer ${index}`, role: "DIRECTOR" })),
      shareholders: Array.from({ length: 50 }, (_, index) => ({
        name: `Owner ${index}`, type: "INDIVIDUAL" as const, shareClass: "ORDINARY", numberOfShares: 1,
      })),
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const candidates = (JSON.parse(String(init.body)) as { candidates: Array<{ sourceRecordId: string }> }).candidates;
      return new Response(JSON.stringify({
        matches: Object.fromEntries(candidates.map((candidate) => [candidate.sourceRecordId, null])),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BizFileReviewWorkspace initialData={manyRecords} sourcePanel={<div>PDF source</div>}
      onCancel={vi.fn()} onReset={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).candidates.length)).toEqual([100, 1]);
  });

  it("previews matches in the selected BizFile tenant", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({
      matches: { "shareholders.0": null },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BizFileReviewWorkspace
      initialData={{ ...fixture, shareholders: [{ name: "Owner", type: "INDIVIDUAL", shareClass: "ORDINARY", numberOfShares: 1 }] }}
      tenantId="tenant-selected" sourcePanel={<div>PDF source</div>}
      onCancel={vi.fn()} onReset={vi.fn()} onConfirm={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Review section" }), { target: { value: "shareholders" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual(expect.objectContaining({
      tenantId: "tenant-selected",
    }));
  });

  it("uses compact desktop tabs with wrapped pointer and keyboard navigation", () => {
    useLargeViewport();
    setup();

    const tabs = screen.getByRole("tablist", { name: "Review sections" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(10);
    expect(screen.getByRole("tab", { name: /Entity.*Complete/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /Previous section.*Ctrl \+ </i }));
    expect(screen.getByRole("tab", { name: /Document.*Complete/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /Next section.*Ctrl \+ >/i }));
    expect(screen.getByRole("tab", { name: /Entity.*Complete/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: ">", ctrlKey: true });
    expect(screen.getByRole("tab", { name: /Addresses.*Complete/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Entity.*Complete/i }));
    fireEvent.keyDown(screen.getByLabelText("Company name"), { key: ">", ctrlKey: true });
    expect(screen.getByRole("tab", { name: /Entity.*Complete/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Addresses.*Complete/i }));
    const addresses = screen.getByRole("tab", { name: /Addresses.*Complete/i });
    addresses.focus();
    fireEvent.keyDown(addresses, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Activities.*Complete/i })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the desktop footer visible in normal flex flow below the full-height split", () => {
    useLargeViewport();
    setup();

    const split = screen.getByTestId("desktop-split");
    expect(split).toHaveClass("min-h-0", "flex-1");
    expect(split).not.toHaveClass("relative");
    expect(split.closest("section")).toHaveClass("h-full");
    expect(within(screen.getByTestId("review-editor")).queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm & Save" })).toBeVisible();
    expect(screen.getByTestId("review-source")).toHaveClass("h-full");
    expect(screen.getByTestId("review-editor")).toHaveClass("h-full");
  });

  it("provides responsive Document and Review panels", () => {
    setup();
    expect(screen.queryByTestId("desktop-split")).not.toBeInTheDocument();
    const mobile = screen.getByTestId("mobile-workspace");
    expect(screen.getByRole("tab", { name: "Document" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Review" })).toBeVisible();
    expect(within(mobile).queryByText("PDF source")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Document" }));
    expect(within(mobile).getByText("PDF source")).toBeVisible();
    expect(within(mobile).queryByLabelText("Company name")).not.toBeInTheDocument();
  });

  it("offers compact navigation to every section below lg", () => {
    setup();
    const select = screen.getByRole("combobox", { name: "Review section" });
    expect(within(select).getAllByRole("option")).toHaveLength(10);
    fireEvent.change(select, { target: { value: "charges" } });
    expect(screen.getByText("Charges", { selector: "h2" })).toBeVisible();
  });

  it("starts with the hydration-safe mobile tree and switches when the lg media query changes", () => {
    let matches = false;
    let notify = () => {};
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return matches; }, media: "(min-width: 1024px)", onchange: null,
      addEventListener: vi.fn((_type, listener: () => void) => { notify = listener; }),
      removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    setup();
    expect(screen.getByTestId("mobile-workspace")).toBeVisible();
    expect(screen.queryByTestId("desktop-split")).not.toBeInTheDocument();
    act(() => { matches = true; notify(); });
    expect(screen.getByTestId("desktop-split")).toBeVisible();
    expect(screen.queryByTestId("mobile-workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Document" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("does not read a wide viewport while producing the initial render tree", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, media: "(min-width: 1024px)", onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const markup = renderToString(<BizFileReviewWorkspace initialData={fixture} sourcePanel={<div>PDF source</div>}
      onCancel={vi.fn()} onReset={vi.fn()} onConfirm={vi.fn()} />);
    expect(markup).toContain('data-testid="mobile-workspace"');
    expect(markup).not.toContain('data-testid="desktop-split"');
    vi.unstubAllGlobals();
  });

  it("saves with Ctrl+S and only warns before unload while dirty", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entityDetails: expect.objectContaining({ name: "Changed" }) }));
    await screen.findByText("Save completed.");
  });

  it("preserves user edits when initialData identity changes", () => {
    const props = { sourcePanel: <div>PDF source</div>, onCancel: vi.fn(), onReset: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<BizFileReviewWorkspace {...props} initialData={fixture} />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "My edit" } });
    rerender(<BizFileReviewWorkspace {...props} initialData={{ ...fixture, entityDetails: { ...fixture.entityDetails } }} />);
    expect(screen.getByLabelText("Company name")).toHaveValue("My edit");
  });

  it("cancels with Ctrl/Cmd+Backspace outside editors but preserves input editing", () => {
    const onCancel = vi.fn();
    setup(vi.fn(), { onCancel });
    const name = screen.getByLabelText("Company name");
    fireEvent.keyDown(name, { key: "Backspace", ctrlKey: true });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(["Cancel", "Upload Different File"])("guards dirty %s and honors keep/discard", async (name) => {
    const onCancel = vi.fn(); const onReset = vi.fn();
    setup(vi.fn(), { onCancel, onReset });
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument());
    expect(onCancel).not.toHaveBeenCalled(); expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(name === "Cancel" ? onCancel : onReset).toHaveBeenCalledOnce());
  });

  it("does not prompt on clean exit and guards the dirty cancel keyboard shortcut", async () => {
    const onCancel = vi.fn();
    setup(vi.fn(), { onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument(); expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.keyDown(window, { key: "Backspace", ctrlKey: true });
    expect(await screen.findByRole("button", { name: "Discard changes" })).toBeVisible(); expect(onCancel).toHaveBeenCalledOnce();
  });

  it("awaits save, blocks duplicate saves, and reports rejection for retry", async () => {
    let reject!: (error: Error) => void;
    const onConfirm = vi.fn(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
    setup(onConfirm);
    const save = screen.getByRole("button", { name: "Confirm & Save" });
    fireEvent.click(save);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    reject(new Error("network"));
    expect(await screen.findByRole("status")).toHaveTextContent("Save failed. Please try again.");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("guards dirty browser back navigation without adding history entries", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    setup();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.popState(window, { state: { page: "previous" } });
    expect(forward).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(back).toHaveBeenCalledOnce(); expect(push).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    push.mockRestore(); back.mockRestore(); forward.mockRestore();
  });

  it("never mutates history across repeated dirty and clean cycles", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    const rendered = setup();
    const name = screen.getByLabelText("Company name");
    fireEvent.change(name, { target: { value: "Changed" } });
    fireEvent.change(name, { target: { value: fixture.entityDetails.name } });
    fireEvent.change(name, { target: { value: "Changed again" } });
    rendered.unmount();
    expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled(); expect(forward).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Upload Different File"])("disarms history before accepted %s navigation and ordinary unmount", async (label) => {
    const callback = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const rendered = setup(vi.fn(), label === "Cancel" ? { onCancel: callback } : { onReset: callback });
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(callback).toHaveBeenCalledOnce());
    rendered.unmount();
    expect(back).not.toHaveBeenCalled(); expect(forward).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    back.mockRestore(); forward.mockRestore(); push.mockRestore(); replace.mockRestore();
  });

  it("disarms the Back guard after save", async () => {
    const onConfirm = vi.fn();
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    setup(onConfirm);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await screen.findByText("Save completed.");
    fireEvent.popState(window, { state: { original: "previous" } });
    expect(forward).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
    forward.mockRestore();
  });

  it("restores a declined Back once and suppresses only its restoration popstate", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    setup();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.popState(window, { state: { page: "previous" } });
    expect(forward).toHaveBeenCalledOnce(); expect(push).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument());
    fireEvent.popState(window, { state: { page: "current" } });
    expect(forward).toHaveBeenCalledOnce();
    fireEvent.popState(window, { state: { page: "previous" } });
    expect(forward).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Discard changes" })).toBeVisible();
    push.mockRestore(); forward.mockRestore();
  });

  it("allows clean browser history navigation without prompting", () => {
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    setup();
    fireEvent.popState(window, { state: { __bizFileReviewGuard: true } });
    expect(forward).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
    forward.mockRestore();
  });

  it("deduplicates server issues, gives client messages precedence, and clears an edited field issue", async () => {
    setup(vi.fn(), { serverIssues: [
      { path: "entityDetails.name", section: "entity", message: "Server name issue" },
      { path: "entityDetails.name", section: "entity", message: "Duplicate server issue" },
    ] });
    expect(screen.getAllByText("Server name issue")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "" } });
    expect(screen.getByText("Company name is required")).toBeVisible();
    expect(screen.queryByText("Server name issue")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Retried Pte. Ltd." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(screen.queryByText("Save blocked")).not.toBeInTheDocument());
  });

  it("restores an identical server issue payload when a retry response arrives", async () => {
    const issue = { path: "entityDetails.name", section: "entity" as const, message: "Server name issue" };
    const props = { sourcePanel: <div>PDF source</div>, onCancel: vi.fn(), onReset: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<BizFileReviewWorkspace {...props} initialData={fixture} serverIssues={[issue]} />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Corrected Pte. Ltd." } });
    expect(screen.queryByText("Server name issue")).not.toBeInTheDocument();
    rerender(<BizFileReviewWorkspace {...props} initialData={fixture} serverIssues={[{ ...issue }]} />);
    expect(await screen.findByText("Server name issue")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Save blocked");
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("does not mark untouched issue-free sections complete and marks visited valid sections reviewed", () => {
    useLargeViewport();
    setup();
    expect(screen.getByRole("tab", { name: /Addresses.*Not reviewed/i })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /Addresses/i }));
    expect(screen.getByRole("tab", { name: /Addresses.*Complete/i })).toBeVisible();
  });

  it("labels reset precisely, removes extraction metadata, and presents invalid-attempt summary", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Upload Different File" })).toBeVisible();
    expect(screen.queryByText(/AI-extracted data may be inaccurate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/10 sections/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openai|openrouter|provider|model/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Save blocked: 1 issue in 1 section.");
  });
});
