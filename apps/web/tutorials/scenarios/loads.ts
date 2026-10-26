import { expect } from "@playwright/test";
import { click, point, type, type Tutorial } from "../scenario";

export const loads: Tutorial = {
  id: "loads",
  status: "approved",
  title: "Loads",
  summary: "Work the load queues, find any load by number, and read a load's stops before you dispatch it.",
  audience: "dispatcher",
  start: "/loads",
  chapters: [
    {
      title: "The queues",
      description: "In transit, upcoming, uncovered, delivered",
      steps: [
        {
          say: "Loads come from McLeod. The tabs split them by where they are: in transit, upcoming, uncovered and delivered.",
          expect: async (p) => {
            await expect(p.getByRole("heading", { name: "Loads", level: 1 })).toBeVisible();
            await expect(p.getByRole("tab", { name: /In transit/ })).toHaveAttribute("aria-selected", "true");
          },
        },
        {
          say: "In transit is every load on a truck right now, with its ETA against the appointment.",
          act: point((p) => p.getByRole("row").filter({ hasText: "DF-20409" }).getByText("Late", { exact: true })),
          expect: async (p) => expect(p.getByRole("link", { name: "DF-20418" })).toBeVisible(),
        },
        {
          say: "Upcoming holds the planned loads, each with its truck and driver.",
          act: click((p) => p.getByRole("tab", { name: /Upcoming/ })),
          expect: async (p) => {
            await expect(p.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute("aria-selected", "true");
            await expect(p.getByRole("link", { name: "DF-20433" })).toBeVisible();
          },
        },
        {
          say: "Uncovered is freight with no truck yet. This is the list to work through when you plan tomorrow.",
          act: click((p) => p.getByRole("tab", { name: /Uncovered/ })),
          expect: async (p) => {
            await expect(p.getByRole("tab", { name: /Uncovered/ })).toHaveAttribute("aria-selected", "true");
            await expect(p.getByRole("link", { name: "DF-20451" })).toBeVisible();
          },
        },
      ],
    },
    {
      title: "Find a load",
      description: "Search by load number, driver or unit",
      steps: [
        {
          say: "To find one load, go to All and type its number in the search box.",
          act: click((p) => p.getByRole("tab", { name: /^All/ })),
          expect: async (p) => expect(p.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true"),
          shot: false,
        },
        {
          say: "For example, load D F two oh four one eight.",
          act: type((p) => p.getByRole("searchbox").first(), "DF-20418"),
          expect: async (p) => {
            await expect(p.getByRole("link", { name: "DF-20418" })).toBeVisible();
            await expect(p.getByRole("link", { name: "DF-20409" })).toHaveCount(0);
          },
        },
      ],
    },
    {
      title: "Load details",
      description: "The plan, the stops, and dispatch",
      steps: [
        {
          say: "Click the load number to open its page.",
          act: click((p) => p.getByRole("link", { name: "DF-20418" })),
          expect: async (p) => expect(p.getByRole("heading", { name: "Load Details", level: 1 })).toBeVisible(),
        },
        {
          say: "Up top: the customer, the driver, the truck and the trailer.",
          act: point((p) => p.getByText("Customer", { exact: true })),
          expect: async (p) => expect(p.getByText("Buckeye Beverage", { exact: true })).toBeVisible(),
          shot: false,
        },
        {
          say: "Stops shows each appointment, and when McLeod and the driver recorded arriving and leaving.",
          act: point((p) => p.getByText("1. Pickup — Prairie Paper Co.")),
          expect: async (p) => expect(p.getByText("2. Drop-off — Buckeye Beverage DC")).toBeVisible(),
        },
        {
          say: "When a load is ready for the driver, Dispatch sends it to their phone. Nothing reaches the driver until you do.",
          act: point((p) => p.getByRole("main").getByRole("button", { name: "Dispatch", exact: true })),
          expect: async (p) => expect(p.getByRole("main").getByRole("button", { name: "Dispatch", exact: true })).toBeVisible(),
        },
      ],
    },
  ],
};
