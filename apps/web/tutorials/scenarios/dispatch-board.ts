import { expect } from "@playwright/test";
import { click, point, press, type Tutorial } from "../scenario";

const row = (unit: string) => (p: import("@playwright/test").Page) => p.getByRole("row").filter({ has: p.getByRole("button", { name: `Open truck ${unit}` }) });

export const dispatchBoard: Tutorial = {
  id: "dispatch-board",
  status: "approved",
  title: "The Dispatch board",
  summary: "See when and where every truck in your fleet is next free, spot the ones that need you, and open a truck for its hours and load.",
  audience: "dispatcher",
  start: "/assignments",
  chapters: [
    {
      title: "Read the board",
      description: "Every truck, soonest free first",
      steps: [
        {
          say: "The Dispatch board lists every truck in your fleet, sorted by when it is next free. The soonest is at the top.",
          expect: async (p) => {
            await expect(p.getByRole("heading", { name: "Dispatch board", level: 1 })).toBeVisible();
            await expect(p.getByRole("button", { name: "Open truck 1071" })).toBeVisible();
          },
        },
        {
          say: "Available is when the truck will be empty. Available in is the city where that happens.",
          act: point((p) => p.getByRole("columnheader", { name: "Available in" })),
          expect: async (p) => expect(p.getByRole("columnheader", { name: "Available in" })).toBeVisible(),
          shot: false,
        },
        {
          say: "Status compares our ETA with the delivery appointment. Truck ten sixty-three is running late.",
          act: point((p) => row("1063")(p).getByText("Late", { exact: true })),
          expect: async (p) => expect(row("1063")(p).getByText("Late", { exact: true })).toBeVisible(),
        },
        {
          say: "Warnings show anything due on the driver, the truck or the trailer. Here, the truck's annual inspection is overdue.",
          act: point((p) => row("1090")(p).getByText(/Annual overdue/)),
          expect: async (p) => expect(row("1090")(p).getByText(/Annual overdue/)).toBeVisible(),
        },
      ],
    },
    {
      title: "Find what needs you",
      description: "Tabs and filters",
      steps: [
        {
          say: "Needs attention keeps only the trucks that are late, at risk, short on hours, or carrying an overdue warning.",
          act: click((p) => p.getByRole("tab", { name: /Needs attention/ })),
          expect: async (p) => {
            await expect(p.getByRole("tab", { name: /Needs attention/ })).toHaveAttribute("aria-selected", "true");
            await expect(p.getByRole("button", { name: "Open truck 1071" })).toHaveCount(0);
          },
        },
        {
          say: "Back to all trucks. Dispatcher, Mine, shows your fleet. Clear it any time to see everyone's.",
          act: click((p) => p.getByRole("tab", { name: /All trucks/ })),
          expect: async (p) => {
            await expect(p.getByRole("tab", { name: /All trucks/ })).toHaveAttribute("aria-selected", "true");
            await expect(p.getByRole("button", { name: "Dispatcher: Mine" })).toBeVisible();
          },
        },
        {
          say: "Looking for a truck near a shipper? Open Near, and pick the city.",
          act: click((p) => p.getByRole("button", { name: "Near", exact: true })),
          expect: async (p) => expect(p.getByRole("listbox", { name: "Near options" })).toBeVisible(),
        },
        {
          say: "Columbus, Ohio. Truck ten forty-two will be free there this afternoon.",
          act: click((p) => p.getByRole("option", { name: "Columbus, OH" })),
          expect: async (p) => {
            await expect(p.getByRole("button", { name: "Open truck 1042" })).toBeVisible();
            await expect(p.getByRole("button", { name: "Open truck 1063" })).toHaveCount(0);
          },
        },
      ],
    },
    {
      title: "Open a truck",
      description: "Hours, load and stops in one place",
      steps: [
        {
          say: "Click a truck number to open it.",
          act: click((p) => p.getByRole("button", { name: "Open truck 1042" })),
          expect: async (p) => expect(p.getByRole("heading", { name: "Truck 1042" })).toBeVisible(),
        },
        {
          say: "Hours of service shows how much driving the driver has left, and which clock runs out first.",
          act: point((p) => p.getByText("Hours of service", { exact: true })),
          expect: async (p) => expect(p.getByText("Hours of service", { exact: true })).toBeVisible(),
          shot: false,
        },
        {
          say: "Below it are the current load, our ETA to the next stop, and the load that comes next.",
          act: point((p) => p.getByText("Current load", { exact: true })),
          expect: async (p) => expect(p.getByText("Next load", { exact: true })).toBeVisible(),
        },
        {
          say: "These links take you straight to the truck on the live map, or to its truck, driver and load pages.",
          act: point((p) => p.getByRole("link", { name: "On the map" })),
          expect: async (p) => expect(p.getByRole("link", { name: "On the map" })).toBeVisible(),
          shot: false,
        },
        {
          say: "Press Escape to close it, and you are back on the board.",
          act: press("Escape"),
          expect: async (p) => expect(p.getByRole("heading", { name: "Truck 1042" })).toHaveCount(0),
        },
      ],
    },
  ],
};
