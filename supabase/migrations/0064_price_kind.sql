-- 0064: price_kind on the global posted layer (FUEL-PRICE-DATA-PLAN.md Phase B regionals).
-- Road Ranger publishes CASH prices; the majors publish posted (card) prices. The kind must ride on
-- every row so cash and posted quotes are never blended silently — an optimizer comparing a cash price
-- against card prices without saying so would overstate savings for card-paying fleets.
alter table fuel_prices_posted add column if not exists price_kind text not null default 'posted'; -- posted | cash
