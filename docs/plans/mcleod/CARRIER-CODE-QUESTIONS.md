# Four questions for Silvicom about LoadMaster codes

**Why this exists:** these four columns are populated in your LoadMaster and we can see the codes, but
the codes' meanings are not in the `dbo.code` vocabulary table — we checked by column name and again by
searching every type/class/status vocabulary on the equipment and driver tables. Rather than guess, we
have left the four fields empty in FuelGuard. Each answer is one line.

**Everything below was measured on 2026-08-24** against the sandbox copy of LoadMaster, counting active
records only (164 drivers, 190 tractors, 235 trailers).

---

### 1. `trailer.trailer_type` — what do `V` and `R` mean?

| Code | Trailers |
|---|---:|
| `V` | 184 |
| `R` | 44 |
| *(blank)* | 7 |

We are confident `R` is **reefer** — it lines up with the 46 trailers whose FuelGuard unit numbers are
`R`-prefixed, and we already use it to flag refrigerated units. We assume `V` is **dry van** but have not
confirmed it. FuelGuard's trailer-type field only accepts *dry van / reefer / flatbed / tanker / hopper /
other*, so a wrong guess would be baked in.

> **Please confirm: is `V` a dry van? Are there other codes on inactive trailers we should expect?**

---

### 2. `tractor.pay_owner` — what do `D`, `B` and `O` mean?

| Code | Tractors |
|---|---:|
| `D` | 174 |
| `B` | 9 |
| `O` | 7 |

We would like to record which trucks are company-owned versus owner-operator, since it affects how cost
per mile is calculated later.

> **Please confirm what each of the three means.**

---

### 3. `tractor.owner` — is `SILVMEIL` the company itself?

`SILVMEIL` appears on 174 of 190 active tractors, `SCORELIL` on 9, and six other codes on one or two
each.

> **Please confirm `SILVMEIL` is Silvicom's own equipment, and whether the others are owner-operators
> or leasing companies.**

---

### 4. `driver.type_of` — what do `C` and `O` mean?

| Code | Drivers |
|---|---:|
| `C` | 148 |
| `O` | 16 |

Most likely **company driver** and **owner-operator**, which would match the tractor split above, but we
have not confirmed it.

> **Please confirm.**

---

## Two things we found that you may want to know about

Neither affects us; both looked worth mentioning.

- **No driver contact details are recorded in LoadMaster.** `email`, `phone` and `cell_phone` are empty
  on all 1,463 driver records. Your team appears to keep the driver's email address in the
  **`name_of_spouse`** field instead — all 164 active drivers have an email address there. We read it
  from that field, so nothing is broken, but it is worth knowing if anyone ever relies on that column
  meaning what its name says.

- **Ten tractors that FuelGuard still shows as active were taken out of service in LoadMaster**,
  between 2021 and June 2026. We have not changed anything; we will bring FuelGuard into line once the
  roster sync is switched on.
