/**
 * @file Tabs.test.tsx
 * @description Tests for the Tabs wrappers (tablist/tab/tabpanel roles, arrow
 * keys change the value, count badge) and SegmentedControl (radiogroup with
 * aria-checked, never empties on re-select).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../Tabs";
import { SegmentedControl } from "../SegmentedControl";

function Controlled({ onChange }: { onChange: (v: string) => void }) {
  const [tab, setTab] = useState("a");
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v);
        onChange(v);
      }}
    >
      <TabsList>
        <TabsTrigger value="a" count={3}>
          Alpha
        </TabsTrigger>
        <TabsTrigger value="b">Beta</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders tablist/tab/tabpanel roles and the selected panel", () => {
    render(<Controlled onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveTextContent("3");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel A");
  });

  it("changes value with arrow keys (automatic activation)", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const [first] = screen.getAllByRole("tab");
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    // Radix moves roving focus on a macrotask; automatic activation follows the focus.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("b"));
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel B");
  });

  it("changes value on click", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Beta" }), { button: 0 });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("SegmentedControl", () => {
  const items = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
  ] as const;

  it("renders a labelled radiogroup with aria-checked", () => {
    render(
      <SegmentedControl
        value="all"
        onValueChange={() => {}}
        items={[...items]}
        ariaLabel="Status"
      />
    );
    expect(screen.getByRole("radiogroup", { name: "Status" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
    expect(radios[1]).toHaveTextContent("Active");
  });

  it("selects on click and ignores re-selecting the current value", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        value="all"
        onValueChange={onValueChange}
        items={[...items]}
        ariaLabel="Status"
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Active/ }));
    expect(onValueChange).toHaveBeenCalledWith("active");
  });
});
