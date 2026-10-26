import { expect } from "@playwright/test";
import { click, point, type, type Tutorial } from "../scenario";

const product = (p: import("@playwright/test").Page) => p.getByRole("combobox", { name: /Search by UN\/NA number/ });

export const placardCalculator: Tutorial = {
  id: "placard-calculator",
  status: "approved",
  title: "The Placard calculator",
  summary: "Work out the placards, ID numbers and shipping-paper wording for a hazmat load before it leaves, with the regulation behind every answer.",
  audience: "dispatcher",
  start: "/hazmat/calculator",
  prerequisites: [
    "The calculator starts switched off for every role (Q-PR2). An admin turns it on for dispatchers under Settings → Permissions; until then it is not in your sidebar.",
  ],
  chapters: [
    {
      title: "Equipment",
      description: "What the load rides on",
      steps: [
        {
          say: "The placard calculator tells you which placards a hazmat load needs. Truck ten forty-two's next load is a cleaning compound, so let's check it.",
          expect: async (p) => expect(p.getByRole("heading", { name: "Placard Calculator", level: 1 })).toBeVisible(),
        },
        {
          say: "Start with the trailer. Pick it from your fleet, and the calculator reads what kind of equipment it is.",
          act: type((p) => p.getByRole("combobox", { name: "Trailer" }), "5310"),
          expect: async (p) => expect(p.getByRole("option", { name: /T-5310/ })).toBeVisible(),
          shot: false,
        },
        {
          say: "T fifty-three ten, a dry van.",
          act: click((p) => p.getByRole("option", { name: /T-5310/ })),
          expect: async (p) => expect(p.getByText(/T-5310 is a dry van/)).toBeVisible(),
        },
      ],
    },
    {
      title: "The product",
      description: "As the bill of lading states it",
      steps: [
        {
          say: "Next, the product. Search by its UN or NA number, as it appears on the bill of lading.",
          act: type(product, "1760"),
          expect: async (p) => expect(p.getByRole("option", { name: /NA1760 · Compounds, cleaning liquid · Class 8 · PG II$/ })).toBeVisible(),
        },
        {
          say: "Choose the entry that matches the paper: cleaning compound, class eight, packing group two.",
          act: click((p) => p.getByRole("option", { name: /NA1760 · Compounds, cleaning liquid · Class 8 · PG II$/ })),
          // Once chosen, the search box gives way to the product's own line.
          expect: async (p) => expect(p.getByText("NA1760 · Compounds, cleaning liquid · Class 8 · PG II", { exact: true })).toBeVisible(),
          shot: false,
        },
        {
          say: "It ships in drums.",
          act: click((p) => p.getByRole("combobox", { name: "Package type" })),
          expect: async (p) => expect(p.getByRole("option", { name: "Drum (≤ 119 gal)" })).toBeVisible(),
          shot: false,
        },
        {
          say: "Drums.",
          act: click((p) => p.getByRole("option", { name: "Drum (≤ 119 gal)" })),
          expect: async (p) => expect(p.getByRole("combobox", { name: "Package type" })).toHaveValue(/Drum/),
          shot: false,
        },
        {
          say: "Eight of them.",
          act: type((p) => p.getByRole("spinbutton", { name: "Package count" }), "8"),
          expect: async (p) => expect(p.getByRole("spinbutton", { name: "Package count" })).toHaveValue("8"),
          shot: false,
        },
        {
          say: "And the gross weight from the bill of lading: forty-four hundred pounds.",
          act: type((p) => p.getByRole("spinbutton", { name: "Gross weight of this product" }), "4400"),
          expect: async (p) => expect(p.getByText(/550 lb/).first()).toBeVisible(),
        },
      ],
    },
    {
      title: "The answer",
      description: "Placards, and why",
      steps: [
        {
          say: "Now, calculate.",
          act: click((p) => p.getByRole("button", { name: "Calculate placards" })),
          expect: async (p) => expect(p.getByRole("heading", { name: "What goes on the truck" })).toBeVisible(),
        },
        {
          say: "This load needs CORROSIVE placards.",
          act: point((p) => p.getByRole("img", { name: "CORROSIVE placard" }).first()),
          expect: async (p) => expect(p.getByRole("img", { name: "CORROSIVE placard" }).first()).toBeVisible(),
        },
        {
          say: "How this was decided shows the weight it counted, and which thresholds the load meets.",
          act: point((p) => p.getByRole("heading", { name: "How this was decided" })),
          expect: async (p) => expect(p.getByText(/1,001 lb/).first()).toBeVisible(),
        },
        {
          say: "And every line of the answer cites the regulation behind it, so you can check it for yourself.",
          act: point((p) => p.getByRole("heading", { name: "What the shipping paper must say" })),
          expect: async (p) => expect(p.getByText("49 CFR 172.202(a)").first()).toBeVisible(),
        },
      ],
    },
  ],
};
