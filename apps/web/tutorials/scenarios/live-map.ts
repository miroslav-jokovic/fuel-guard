import { expect } from "@playwright/test";
import { click, point, type, type Tutorial } from "../scenario";

export const liveMap: Tutorial = {
  id: "live-map",
  status: "approved",
  title: "The Live map",
  summary: "See where every truck is right now, filter by what it is doing, and open a truck to follow its load along the route.",
  audience: "dispatcher",
  start: "/?tab=dispatch",
  chapters: [
    {
      title: "Your fleet at a glance",
      description: "Dashboard, Dispatch tab",
      steps: [
        {
          say: "The live map is the Dispatch tab on your dashboard. Every truck with a tracker is on it, and it refreshes every five seconds.",
          expect: async (p) => {
            await expect(p.getByRole("button", { name: /^All trucks 11/ })).toBeVisible();
            await expect(p.getByRole("button", { name: /^1042 Moving/ })).toBeVisible();
          },
        },
        {
          say: "These counts split the fleet by what each truck is doing: moving, stopped, parked, or offline.",
          act: point((p) => p.getByRole("button", { name: /^Moving 7/ })),
          expect: async (p) => expect(p.getByRole("button", { name: /^Parked 3/ })).toBeVisible(),
          shot: false,
        },
        {
          say: "Click one to show only those trucks. Here, the three that are parked.",
          act: click((p) => p.getByRole("button", { name: /^Parked 3/ })),
          expect: async (p) => {
            await expect(p.getByRole("button", { name: /^Parked 3/ })).toHaveAttribute("aria-pressed", "true");
            await expect(p.getByRole("button", { name: /^1042 Moving/ })).toHaveCount(0);
          },
        },
        {
          say: "Below the counts, the map tells you if a truck is in the shop, or has no tracker and so cannot be drawn.",
          act: point((p) => p.getByText(/in the shop/)),
          expect: async (p) => expect(p.getByText(/with no tracker/)).toBeVisible(),
          shot: false,
        },
        {
          say: "All trucks brings everyone back.",
          act: click((p) => p.getByRole("button", { name: /^All trucks 11/ })),
          expect: async (p) => expect(p.getByRole("button", { name: /^1042 Moving/ })).toBeVisible(),
        },
      ],
    },
    {
      title: "Follow one truck",
      description: "Search, the truck card, and its route",
      steps: [
        {
          say: "To find a truck, type its unit number or the driver's name.",
          act: type((p) => p.getByRole("searchbox", { name: "Search" }), "1042"),
          expect: async (p) => {
            await expect(p.getByRole("button", { name: /^1042 Moving/ })).toBeVisible();
            await expect(p.getByRole("button", { name: /^1057 Moving/ })).toHaveCount(0);
          },
        },
        {
          say: "Click it, and the map flies to the truck and opens its card.",
          act: click((p) => p.getByRole("button", { name: /^1042 Moving/ })),
          expect: async (p) => expect(p.getByRole("heading", { name: "Unit 1042" })).toBeVisible(),
        },
        {
          say: "The card has speed, fuel and heading, how fresh the GPS fix is, and the load the truck is hauling.",
          act: point((p) => p.getByRole("link", { name: /DF-20418/ })),
          expect: async (p) => expect(p.getByRole("link", { name: /DF-20418/ })).toBeVisible(),
        },
        {
          say: "Show route draws the load from pickup to delivery: the part already driven, and the part still ahead.",
          act: click((p) => p.getByRole("button", { name: "Show route" })),
          expect: async (p) => expect(p.getByRole("button", { name: "Hide route", pressed: true })).toBeVisible(),
        },
      ],
    },
  ],
};
