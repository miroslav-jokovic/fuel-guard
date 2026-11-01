// Mock API + Supabase REST for a browser pass of /chat with the dev bypass.
// Serves fixtures on :8080; the web build points VITE_API_URL and VITE_SUPABASE_URL here.
// POST /__mode {"mode":"data"|"empty"|"fail"} switches the fixture set without a restart; with
// "clear": "<thread id>" it empties that thread (an empty General, CR4). POST /__line adds a line from
// somebody else to a thread, so "N new messages" (CR2) can be seen without a second person.
import http from "node:http";
import { randomUUID } from "node:crypto";

let mode = process.env.FIXTURE_MODE ?? "data";
// MOCK_PORT: a second session's pass can run beside one already holding 8080.
const port = Number(process.env.MOCK_PORT ?? 8080);
const ME = "dev-admin-001";
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();
const day = (d, h, m = 0) => {
  const t = new Date(now);
  t.setDate(t.getDate() - d);
  t.setHours(h, m, 0, 0);
  return t.toISOString();
};
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const people = [
  { user_id: "22222222-2222-4222-8222-222222222222", name: "Marcus Reyes", role: "dispatcher" },
  { user_id: "33333333-3333-4333-8333-333333333333", name: "Dana Whitfield", role: "safety_manager" },
  { user_id: "44444444-4444-4444-8444-444444444444", name: "Luis Ortega", role: "technician" },
  { user_id: "55555555-5555-4555-8555-555555555555", name: "Priya Natarajan", role: "accountant" },
  { user_id: "66666666-6666-4666-8666-666666666666", name: "Tom Becker", role: "fleet_manager" },
  { user_id: "77777777-7777-4777-8777-777777777777", name: "Elena Vasquez", role: "recruiter" },
];
const P = Object.fromEntries(people.map((p) => [p.name.split(" ")[0].toLowerCase(), p]));

const T = { marcus: uuid(1), dana: uuid(2), luis: uuid(3), priya: uuid(4), night: uuid(5), elena: uuid(6) };
const CH = { general: uuid(101), west: uuid(102), roadside: uuid(103), shopGeneral: uuid(104), parts: uuid(105) };
const SP = { dispatch: uuid(201), shop: uuid(202) };

let seqs = {};
const msgs = {}; // thread_id -> ChatMessage[]
function line(thread, sender, body, at, over = {}) {
  seqs[thread] = (seqs[thread] ?? 0) + 1;
  const seq = seqs[thread];
  const m = {
    id: randomUUID(), thread_id: thread, seq, rev: seq,
    sender_user_id: sender, sender_name: sender === ME ? "Miki Jokovic" : people.find((p) => p.user_id === sender)?.name ?? null,
    body, created_at: at, edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null,
    reactions: [], pinned_at: null, pinned_by: null, saved: false, saved_at: null, ...over,
  };
  (msgs[thread] ??= []).push(m);
  return m;
}

function seed() {
  seqs = {};
  for (const k of Object.keys(msgs)) delete msgs[k];
  // Marcus — a long direct conversation, with consecutive lines and a day boundary.
  line(T.marcus, P.marcus.user_id, "Morning. 811 is loaded at Kenosha, leaving at 7.", day(1, 6, 58));
  line(T.marcus, ME, "Good. Did the reefer pre-cool finish?", day(1, 7, 2));
  line(T.marcus, P.marcus.user_id, "Yes, 34°F at 6:40.", day(1, 7, 3));
  line(T.marcus, P.marcus.user_id, "He also asked about the gate code for the Joliet drop.", day(1, 7, 3));
  // CH6c-2: a pinned line with a reaction, one the dev session saved.
  line(T.marcus, ME, "4411. Same as last week.", day(1, 7, 10), { edited_at: day(1, 7, 11), pinned_at: day(1, 7, 12), pinned_by: P.marcus.user_id, reactions: [{ reaction: "thumbs_up", users: [P.marcus.user_id] }] });
  line(T.marcus, P.marcus.user_id, "Got it, sent to him.", day(1, 7, 12));
  line(T.marcus, P.marcus.user_id, "Truck 702 is sitting at the Pilot in Gary — 3h idle on the map. Calling him now.", ago(190));
  line(T.marcus, ME, "Thanks. If it's the APU again, have Luis look at it on Friday.", ago(140));
  line(T.marcus, P.marcus.user_id, null, ago(130), { deleted_at: ago(129) });
  line(T.marcus, P.marcus.user_id, "APU threw a code. I put a note on the unit.", ago(128));
  line(T.marcus, P.marcus.user_id, "Also 455 needs a reset on the ELD before his 14 runs out at 15:20.", ago(44));
  line(T.marcus, ME, "On it.", ago(41));
  line(T.marcus, P.marcus.user_id, "Can you approve the detention on load L-20481? Shipper held him 4h.", ago(6), { saved: true, saved_at: ago(4) });
  line(T.marcus, P.marcus.user_id, "I attached the BOL time stamps in the load.", ago(5));

  line(T.dana, P.dana.user_id, "Roadside on 455 in Indiana, level 2. No OOS. Report is in the inspection queue.", ago(75));
  line(T.dana, ME, "Any brake findings?", ago(70));
  line(T.dana, P.dana.user_id, "One: 393.47, out of adjustment on the trailer. I'm opening a DataQ for the ABS lamp one, it was a bad bulb.", ago(68));

  line(T.luis, ME, "Is 702's APU on the board for Friday?", ago(2 * 60 * 24 + 30));
  line(T.luis, P.luis.user_id, "Yes, bay 2 at 8. Parts are here.", ago(2 * 60 * 24 + 10));

  line(T.priya, P.priya.user_id, "October fuel tie-out is −$152 against McLeod. Diesel vs Fuel Advance, cancels. I'll close it Monday.", day(3, 16, 20));

  line(T.night, P.marcus.user_id, "Handing over: 3 trucks rolling, 811 delivers at 02:00, 455 is parked in Elkhart.", day(0, 22, 5));
  line(T.night, P.tom.user_id, "Thanks Marcus. I have the board.", day(0, 22, 9));
  line(T.night, P.tom.user_id, "811 delivered, POD uploaded from the app.", day(0, 2, 14));
  line(T.night, ME, "👍", day(0, 6, 40));

  line(T.elena, P.elena.user_id, "Two applicants are ready to screen, both Class A with 2+ years. Want me to book the MVRs?", ago(60 * 26));

  // Channels
  line(CH.general, P.tom.user_id, "Welcome to Dispatch. Shift handovers go in #west-region or #roadside, general notes here.", day(6, 9));
  line(CH.general, P.marcus.user_id, "Reminder: HOS resets this week — 455, 702 and 318 all run out Thursday.", day(1, 8, 30), {
    pinned_at: day(1, 9), pinned_by: P.tom.user_id,
    reactions: [{ reaction: "thumbs_up", users: [P.tom.user_id, P.dana.user_id, ME] }, { reaction: "done", users: [P.luis.user_id] }],
  });
  const post = line(CH.general, P.dana.user_id, "New rule from Friday: every roadside inspection gets photographed before the truck leaves the scale. Driver app → Inspection.", day(0, 9, 15), { reply_count: 3, last_reply_at: ago(20) });
  line(CH.general, P.luis.user_id, "Bay 1 is down until Wednesday, compressor. Route PMs to bay 2.", ago(95));
  line(CH.general, ME, "Noted. Marcus, keep 318's PM on Thursday but push 611 to next week.", ago(90));
  line(CH.general, P.marcus.user_id, "Done.", ago(88));
  line(CH.general, P.dana.user_id, "Report is at 'Here's how to shoot the placard side' — see the reply.", ago(20), { parent_id: post.id });
  line(CH.general, P.marcus.user_id, "What if the officer keeps the paper?", ago(18), { parent_id: post.id });
  line(CH.general, P.dana.user_id, "Then the photo is the record until the report lands in the FMCSA feed. Both go on the file.", ago(16), { parent_id: post.id });

  line(CH.west, P.marcus.user_id, "I-80 closed at Des Moines westbound, hazmat spill. 611 rerouted via I-35 / US-30.", ago(35));
  // A mention (CH6b-2, D-CHAT22): the body carries the token; the page draws the name.
  line(CH.west, P.tom.user_id, `<@${P.marcus.user_id}> can you tell 611 the Ames fuel stop is closed too?`, ago(12));
  line(CH.roadside, P.dana.user_id, "Indiana weigh stations are running brake blitz this week.", day(2, 14));
  line(CH.shopGeneral, P.luis.user_id, "Parts order went in. Steer tires for 702 and 318 arrive Tuesday.", day(1, 15));
}
seed();

const conv = (thread_id, kind, subject, members, extra = {}) => {
  const ms = msgs[thread_id] ?? [];
  const last = ms.filter((m) => !m.parent_id).at(-1);
  const others = members.filter((id) => id !== ME).map((id) => ({ user_id: id, name: people.find((p) => p.user_id === id)?.name ?? null }));
  return {
    thread_id, kind, subject, load_id: null, created_at: day(10, 9), last_message_at: last?.created_at ?? day(10, 9),
    last_seq: seqs[thread_id] ?? 0, rev: seqs[thread_id] ?? 0, read_seq: extra.read_seq ?? seqs[thread_id] ?? 0,
    unread: extra.unread ?? 0, muted: extra.muted ?? "none", member_role: "member", member_count: members.length,
    title_members: others.slice(0, 4),
    last_message: last ? { id: last.id, seq: last.seq, sender_user_id: last.sender_user_id, sender_name: last.sender_name, body: last.body, created_at: last.created_at, deleted: !!last.deleted_at } : null,
  };
};
const convMembers = {
  [T.marcus]: [ME, P.marcus.user_id], [T.dana]: [ME, P.dana.user_id], [T.luis]: [ME, P.luis.user_id],
  [T.priya]: [ME, P.priya.user_id], [T.night]: [ME, P.marcus.user_id, P.tom.user_id, P.dana.user_id], [T.elena]: [ME, P.elena.user_id],
  [CH.general]: [ME, P.marcus.user_id, P.tom.user_id, P.dana.user_id, P.luis.user_id], [CH.west]: [ME, P.marcus.user_id, P.tom.user_id],
  [CH.roadside]: [ME, P.dana.user_id, P.tom.user_id], [CH.shopGeneral]: [ME, P.luis.user_id], [CH.parts]: [ME, P.luis.user_id],
};
const convMeta = {
  [T.marcus]: { kind: "direct", subject: null, unread: 2 },
  [T.dana]: { kind: "direct", subject: null, unread: 0 },
  [T.luis]: { kind: "direct", subject: null, unread: 0 },
  [T.priya]: { kind: "direct", subject: null, unread: 0, muted: "all" },
  [T.night]: { kind: "group", subject: "Night dispatch", unread: 0 },
  [T.elena]: { kind: "direct", subject: null, unread: 1 },
  [CH.general]: { kind: "channel", subject: "General", unread: 3 },
  [CH.west]: { kind: "channel", subject: "west-region", unread: 1 },
  [CH.roadside]: { kind: "channel", subject: "roadside", unread: 0 },
  [CH.shopGeneral]: { kind: "channel", subject: "General", unread: 0 },
};
const inbox = (kinds) => {
  const list = Object.keys(convMeta)
    .map((id) => conv(id, convMeta[id].kind, convMeta[id].subject, convMembers[id], { unread: convMeta[id].unread, muted: convMeta[id].muted, read_seq: (seqs[id] ?? 0) - (convMeta[id].unread ?? 0) }))
    .filter((c) => !kinds || kinds.includes(c.kind))
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
  return { conversations: list, next: null, unread_total: list.reduce((n, c) => n + (c.muted === "all" ? 0 : c.unread), 0) };
};
// Activity (CH6b-2, D-CHAT25): what named "me" or answered "my" posts. The dev session's id is not a
// uuid, so no line can carry a token for it; the items are built from the seeded lines instead.
let activityReadAt = null;
const activity = () => {
  const pick = (thread, reason, test) => {
    const m = (msgs[thread] ?? []).find(test);
    const meta = convMeta[thread];
    return m && { message_id: m.id, reason, at: m.created_at, thread_id: thread, kind: meta.kind, subject: meta.subject,
      space_id: meta.kind === "channel" ? SP.dispatch : null, parent_id: m.parent_id, seq: m.seq,
      sender_user_id: m.sender_user_id, sender_name: m.sender_name, body: m.body, created_at: m.created_at };
  };
  return [
    pick(CH.general, "reply", (m) => m.parent_id && m.body?.startsWith("Then the photo")),
    pick(CH.west, "mention", (m) => m.body?.includes("Ames")),
    pick(T.night, "mention", (m) => m.body?.startsWith("Handing over")),
    pick(T.elena, "mention", () => true),
  ].filter(Boolean)
    .map((i) => ({ ...i, unread: !activityReadAt || i.at > activityReadAt }))
    .sort((a, b) => b.at.localeCompare(a.at));
};
const channel = (id, name, general, visibility, joined = true) => ({
  thread_id: id, name, visibility, general, joined, last_message_at: msgs[id]?.at(-1)?.created_at ?? day(5, 9),
  last_seq: seqs[id] ?? 0, read_seq: joined ? (seqs[id] ?? 0) - (convMeta[id]?.unread ?? 0) : null, unread: joined ? convMeta[id]?.unread ?? 0 : 0, muted: joined ? convMeta[id]?.muted ?? "none" : null,
});
const teams = () => ({
  can_manage: true,
  teams: [
    { space_id: SP.dispatch, name: "Dispatch", description: "Day and night dispatch, the board, roadside.", space_role: "owner", member_count: 6, created_at: day(20, 9),
      channels: [channel(CH.general, "General", true, "public"), channel(CH.west, "west-region", false, "public"), channel(CH.roadside, "roadside", false, "private"), channel(uuid(106), "detention", false, "public", false)] },
    { space_id: SP.shop, name: "Shop", description: null, space_role: "member", member_count: 3, created_at: day(15, 9),
      channels: [channel(CH.shopGeneral, "General", true, "public"), channel(CH.parts, "parts", false, "public", false)] },
  ],
});
const members = (id) => (convMembers[id] ?? []).map((uid) => ({
  user_id: uid, name: uid === ME ? "Miki Jokovic" : people.find((p) => p.user_id === uid)?.name ?? null,
  member_role: uid === ME ? "owner" : "member", read_seq: uid === ME ? seqs[id] ?? 0 : Math.max(0, (seqs[id] ?? 0) - (uid === P.marcus.user_id ? 0 : 1)), last_read_at: ago(3), joined_at: day(10, 9),
}));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, apikey, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-max-age": "600",
    });
    return res.end();
  }
  if (path === "/__mode") { const b = await readBody(req); mode = b.mode; if (b.reseed) { seed(); activityReadAt = null; } if (b.clear) { delete msgs[b.clear]; seqs[b.clear] = 0; } console.log("[mock] mode", mode); return json(res, 200, { mode }); }
  // A line from somebody else, now — for "N new messages" (D-CHATUI17): POST /__line {"thread":"<id>","body":"…"}.
  if (path === "/__line") { const b = await readBody(req); const m = line(b.thread, b.sender ?? P.marcus.user_id, b.body, new Date().toISOString()); convMeta[b.thread] ??= { kind: "direct", subject: null, unread: 0 }; return json(res, 200, { id: m.id, seq: m.seq }); }
  console.log(`[mock] ${req.method} ${path}${url.search} (${mode})`);

  // Supabase REST (dev bypass still reads org_modules directly)
  if (path.startsWith("/rest/v1/")) {
    if (req.headers.accept?.includes("pgrst.object")) return json(res, 406, { message: "none" });
    if (path.endsWith("org_modules")) return json(res, 200, [{ module_key: "messages", enabled: true, config: {} }, { module_key: "dispatch", enabled: true, config: {} }]);
    return json(res, 200, []);
  }
  if (path.startsWith("/auth/v1/")) return json(res, 200, {});
  if (path === "/api/me") return json(res, 200, { fullName: "Miki Jokovic" });
  if (path === "/api/me/notifications") return json(res, 200, { notifications: [], unread: 0 });
  if (path === "/api/version") return json(res, 200, { commit: "mock", realtime: "ok" });

  if (path.startsWith("/api/chat")) {
    if (mode === "fail") return json(res, 500, { error: { message: "mock failure" } });
    const empty = mode === "empty";
    const seg = path.split("/").filter(Boolean); // api, chat, ...
    if (seg.length === 2 && req.method === "GET") {
      const kinds = url.searchParams.get("kinds")?.split(",");
      return json(res, 200, empty ? { conversations: [], next: null, unread_total: 0 } : inbox(kinds));
    }
    if (seg[2] === "people") return json(res, 200, { people: empty ? [] : people });
    if (seg[2] === "activity") {
      if (seg[3] === "read") { const b = await readBody(req); activityReadAt = b.at ?? new Date().toISOString(); return json(res, 200, { activity_read_at: activityReadAt }); }
      const items = empty ? [] : activity();
      const unread = items.filter((i) => i.unread).length;
      return json(res, 200, seg[3] === "unread" ? { unread } : { items, next: null, unread });
    }
    if (seg[2] === "teams") {
      if (seg.length === 3) return json(res, 200, empty ? { teams: [], can_manage: true } : teams());
      if (seg[4] === "members") return json(res, 200, { members: members(seg[3] === SP.dispatch ? CH.general : CH.shopGeneral) });
      if (req.method === "POST") return json(res, 200, { thread_id: randomUUID(), space_id: randomUUID() });
    }
    if (seg[2] === "channels") {
      const id = seg[3];
      // "Add to # west-region" from the composer's @ list (Q-CHAT20 (a)).
      if (seg[4] === "members" && req.method === "POST") {
        const b = await readBody(req);
        convMembers[id] = [...new Set([...(convMembers[id] ?? []), ...b.user_ids])];
        return json(res, 200, { added: b.user_ids.length });
      }
      if (seg[4] === "posts") {
        if (seg[6] === "replies") {
          if (req.method === "POST") { const b = await readBody(req); const m = line(id, ME, b.body, new Date().toISOString(), { parent_id: seg[5], id: b.message_id }); return json(res, 200, { message_id: m.id, seq: m.seq, rev: m.rev, created_at: m.created_at, duplicate: false }); }
          return json(res, 200, { posts: (msgs[id] ?? []).filter((m) => m.parent_id === seg[5]), before_seq: null });
        }
        return json(res, 200, { posts: (msgs[id] ?? []).filter((m) => !m.parent_id), before_seq: null });
      }
      return json(res, 200, {});
    }
    if (seg[2] === "saved") {
      const items = empty ? [] : Object.values(msgs).flat().filter((m) => m.saved && !m.deleted_at)
        .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
        .map((m) => ({ message_id: m.id, saved_at: m.saved_at, thread_id: m.thread_id, kind: convMeta[m.thread_id]?.kind ?? "direct",
          subject: convMeta[m.thread_id]?.subject ?? null, space_id: null, parent_id: m.parent_id, seq: m.seq,
          sender_user_id: m.sender_user_id, sender_name: m.sender_name, body: m.body, created_at: m.created_at }));
      return json(res, 200, { items, next: null });
    }
    if (seg[2] === "messages") {
      const id = seg[3];
      for (const list of Object.values(msgs)) {
        const m = list.find((x) => x.id === id);
        if (m && seg[4]) {
          // CH6c-2: react, pin, save — each moves the line's rev but the save (D-CHAT24).
          const b = await readBody(req);
          if (seg[4] === "reactions") {
            const k = m.reactions.find((r) => r.reaction === b.reaction);
            if (b.on && !k) m.reactions.push({ reaction: b.reaction, users: [ME] });
            else if (b.on && !k.users.includes(ME)) k.users.push(ME);
            else if (!b.on && k) { k.users = k.users.filter((u) => u !== ME); if (!k.users.length) m.reactions = m.reactions.filter((r) => r !== k); }
            const order = ["thumbs_up", "heart", "laugh", "surprised", "sad", "done"];
            m.reactions.sort((x, y) => order.indexOf(x.reaction) - order.indexOf(y.reaction));
            m.rev++;
            return json(res, 200, { rev: m.rev });
          }
          if (seg[4] === "pin") { m.pinned_at = b.on ? new Date().toISOString() : null; m.pinned_by = b.on ? ME : null; m.rev++; return json(res, 200, { rev: m.rev }); }
          if (seg[4] === "save") { m.saved = b.on; m.saved_at = b.on ? new Date().toISOString() : null; return json(res, 200, { saved: b.on }); }
        }
        if (m) {
          if (req.method === "PATCH") { const b = await readBody(req); m.body = b.body; m.edited_at = new Date().toISOString(); m.rev++; }
          if (req.method === "DELETE") { m.body = null; m.deleted_at = new Date().toISOString(); m.rev++; }
        }
      }
      return json(res, 200, {});
    }
    if (seg[2] === "direct" || seg[2] === "groups") return json(res, 200, { thread_id: T.marcus });
    const id = seg[2];
    if (seg.length === 3 && req.method === "GET") {
      const meta = convMeta[id];
      if (!meta || empty) return json(res, 404, { error: { message: "not found" } });
      const all = (msgs[id] ?? []).filter((m) => !m.parent_id);
      const page = all.slice(-50);
      return json(res, 200, { conversation: conv(id, meta.kind, meta.subject, convMembers[id], { unread: meta.unread, muted: meta.muted }), members: members(id), messages: page, before_seq: all.length > 50 ? page[0].seq : (url.searchParams.get("paged") ? null : null) });
    }
    if (seg[3] === "messages" && req.method === "GET") return json(res, 200, { messages: [], before_seq: null });
    if (seg[3] === "members" && req.method === "GET") return json(res, 200, { members: members(id) });
    if (seg[3] === "pins") {
      const name = (uid) => (uid === ME ? "Miki Jokovic" : people.find((p) => p.user_id === uid)?.name ?? null);
      const pins = (msgs[id] ?? []).filter((m) => m.pinned_at && !m.deleted_at).sort((a, b) => b.pinned_at.localeCompare(a.pinned_at))
        .map((m) => ({ id: m.id, thread_id: m.thread_id, seq: m.seq, rev: m.rev, sender_user_id: m.sender_user_id, sender_name: m.sender_name,
          body: m.body, created_at: m.created_at, edited_at: m.edited_at, parent_id: m.parent_id, pinned_at: m.pinned_at, pinned_by: m.pinned_by, pinned_by_name: name(m.pinned_by) }));
      return json(res, 200, { pins });
    }
    if (seg[3] === "messages" && req.method === "POST") {
      const b = await readBody(req);
      const m = line(id, ME, b.body, new Date().toISOString(), { id: b.message_id });
      return json(res, 200, { message_id: m.id, seq: m.seq, rev: m.rev, created_at: m.created_at, duplicate: false });
    }
    if (seg[3] === "read") return json(res, 200, {});
    if (seg[3] === "mute") { const b = await readBody(req); (convMeta[id] ??= { kind: "channel", subject: null, unread: 0 }).muted = b.muted; return json(res, 200, { muted: b.muted }); }
    return json(res, 200, {});
  }
  json(res, 404, { error: { message: "no fixture for " + path } });
}).listen(port, () => console.log(`[mock] listening on :${port}, mode`, mode));
