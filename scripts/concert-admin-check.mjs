// Verification harness for card 01 (Concert id + S3 concert admin lib).
// Run from the repo root:  node scripts/concert-admin-check.mjs
//
// Requires node >= 22.18 (native TypeScript type-stripping). The harness is a
// plain node script with asserts; it imports the real libraries (lib/upcoming-concerts.ts,
// lib/concert-admin.ts) through node's type-stripping loader plus a tiny resolve hook
// for the "@/..." path alias used by the repo.
//
// What it proves:
//   (a) parsing the live S3 file returns 2 concerts, both id-less today, and the
//       parse is identical (date/time/location/venue/title/program/link) to the
//       pre-change baseline captured from the original parser;
//   (b) parse → serialize → parse round-trips 10 crafted lines;
//   (c) huDateToIso / isoToHuDate handle the Hungarian date format both ways;
//   (d) insert/update/delete against an in-memory fixture keep unrelated lines
//       byte-identical, generate unique ids for duplicate venue+date, and migrate
//       id-less lines on first write;
//   (live) the two live concerts with the ids that WOULD be derived for them,
//       plus proof that the live file was not modified (LastModified/size before
//       and after the read-only operations are identical).
//
// The live S3 file is only READ here — never written.

import assert from "node:assert/strict";
import { register } from "node:module";

const REPO_ROOT_URL = new URL("../", import.meta.url).href;

const aliasHookSource = `
  const root = ${JSON.stringify(REPO_ROOT_URL)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      let rest = specifier.slice(2);
      if (!rest.split("/").pop().includes(".")) rest += ".ts";
      return next(new URL(rest, root).href, context);
    }
    return next(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(aliasHookSource)}`);

const upcoming = await import("../lib/upcoming-concerts.ts");
const admin = await import("../lib/concert-admin.ts");

const failures = [];
const sections = [];
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
    sections.push({ name, ok: true });
    console.log("   -> ok");
  } catch (err) {
    failures.push(name);
    sections.push({ name, ok: false });
    console.error(`   -> FAIL\n      ${err?.stack ?? err}`);
  }
}

// The fields the pre-change parser produced; the new optional id is excluded on
// purpose — the baseline must match the parse of the ORIGINAL parser exactly.
const BASELINE_FIELDS = ["date", "time", "location", "venue", "title", "program", "link"];
const projectBaselineFields = (concert) =>
  Object.fromEntries(BASELINE_FIELDS.map((field) => [field, concert[field]]));

// Pre-change parse of the live file, captured 2026-11-25 with the ORIGINAL
// lib/upcoming-concerts.ts (before the id field existed). Pinned on purpose:
// this is the regression proof required by card 01.
const PRE_CHANGE_BASELINE = [
  {
    date: "2026. november 25.",
    time: "19:00",
    location: "Soproni Egyetem, Ligneum Rendezvényház",
    venue: "",
    title: "“Természetesen Zene!”",
    program: [
      "Händel: Music for the Royal Fireworks",
      "Mozart: Sinfonia concertante KV 364 (2–3. tétel)",
      "Szabó Benedek: Madman’s Treasure",
      "Ránki György: Lúd-apó meséi",
      "Gershwin: Three Preludes",
    ],
    link: { href: "https://shop.uni-sopron.hu/zeneakademia", label: "SOE Shop" },
  },
  {
    date: "2026. november 27.",
    time: "18:00",
    location: "Budapest",
    venue: "BMC – Könyvtár",
    title: "Új utakon – A Réz körút rézfúvós szeptett koncertje",
    program: [
      "Szabó Benedek: (Te)Réz körút",
      "Sebestyén-Lázár Regina: something, someday, somewhere…",
      "Molnár Viktor: Divertimento",
      "Papp Mátyás: Seiche",
      "Kovács Tihamér: Let flow my dearest humor",
      "Horváth Balázs: RA gombostűi (in memoriam Morton Feldman) – ősbemutató",
      "Tátrai Mihály: Caesar's mad senate",
    ],
    link: {
      href: "https://bmc.hu/programok/uj-utakon-a-rez-korut-rezfuvos-szeptett-koncertje",
      label: "BMC",
    },
  },
];

let liveStatBefore = null;
let liveStatAfter = null;
let liveConcerts = null;

// --------------------------------------------------------------------------
// (a) Live file parse equals the pre-change baseline; ids optional (assigned on first write)
// --------------------------------------------------------------------------
await section("(a) live file parses to 2 concerts, identical to the pre-change baseline (ids optional)", async () => {
  liveStatBefore = await admin.statUpcomingFile();
  liveConcerts = await admin.listUpcomingConcerts();
  liveStatAfter = await admin.statUpcomingFile();

  assert.equal(liveConcerts.length, 2, "the live file must parse to exactly 2 concerts today");
  assert.ok(
    liveConcerts.every((c) => c.id === undefined || /^rk-[a-z0-9-]+$/.test(c.id)),
    "live concert ids must be well-formed rk-... ids when present (id-less is also valid; ids are only assigned on first write)",
  );
  assert.deepEqual(
    liveConcerts.map(projectBaselineFields),
    PRE_CHANGE_BASELINE,
    "live parse must equal the pre-change parse for date/time/location/venue/title/program/link",
  );

  assert.equal(liveStatAfter.lastModified, liveStatBefore.lastModified, "read must not modify the file");
  assert.equal(liveStatAfter.sizeBytes, liveStatBefore.sizeBytes, "read must not modify the file");
});

// --------------------------------------------------------------------------
// (b) parse → serialize → parse round-trip on 10 crafted lines
// --------------------------------------------------------------------------
await section("(b) parse → serialize → parse round-trips 10 crafted lines", () => {
  const craftedLines = [
    // 1. full 8 fields
    "- 2026. november 25. | 19:00 | Sopron | Soproni Egyetem | Nyitó koncert | Händel: Water Music; Mozart: Divertimento | https://example.com/jegyek | Jegyvétel",
    // 2. full 8 fields + id (9th position)
    "- 2026. november 25. | 19:00 | Sopron | Soproni Egyetem | Nyitó koncert | Händel: Water Music; Mozart: Divertimento | https://example.com/jegyek | Jegyvétel | id:rk-2026-11-25-soproni-egyetem",
    // 3. 5 mandatory fields only, accented venue with en-dash
    "- 2026. november 27. | 18:00 | Budapest | BMC – Könyvtár | Új utakon koncert",
    // 4. href only (no program, no label → label defaults to Jegyinfo)
    "- 2026. december 5. | 20:00 | Budapest | Pesti Vigadó | Gálaest | https://example.com/gala",
    // 5. empty time slot + semicolon programs
    "- 2027. január 2. |  | Helyszín | Terem | Cím | Program egy; Program két",
    // 6. empty venue, id right after the title (no program, no href)
    "- 2027. február 10. | 19:00 | Győr | | Cím győrben | id:rk-2027-02-10-gyor",
    // 7. full 9 fields, 3 program items, heavy accents
    "- 2027. március 3. | 11:00 | Szeged | Szegedi Nemzeti | Matinék | Kodály: Háry János; Bartók: Román népi táncok; Liszt: Prelűdök | https://szeged.example | Matiné jegy | id:rk-2027-03-03-szegedi-nemzeti",
    // 8. mailto href + accented label, no program
    "- 2027. április 1. | 19:30 | Miskolc | Miskolci Bélatablak | Áprilisi koncert | mailto:jegy@example.hu | Írj nekünk",
    // 9. programs + id, no href
    "- 2027. május 15. | 17:00 | Veszprém | Veszprémi Kabaré | Örökzöld slágerek | Dal: Egy; Dal: Kettő | id:rk-2027-05-15-veszpremi-kabare",
    // 10. id between title and href (id may appear anywhere after the title)
    "- 2027. július 4. | 12:00 | Debrecen | Csokonai Színház | Nyári koncert | id:rk-2027-07-04-csokonai-szinhaz | https://example.com/debrecen | Debrecen jegy",
  ];

  for (const line of craftedLines) {
    const first = upcoming.parseUpcomingConcertsMarkdown(line);
    assert.equal(first.length, 1, `expected exactly 1 concert from: ${line}`);

    const serialized = upcoming.serializeConcert(first[0]);
    assert.ok(serialized.startsWith("- "), `serialized line must be a bullet: ${serialized}`);

    const reparsed = upcoming.parseUpcomingConcertsMarkdown(serialized);
    assert.equal(reparsed.length, 1, `expected exactly 1 concert from: ${serialized}`);
    assert.deepEqual(
      reparsed[0],
      first[0],
      `round-trip must be stable.\n  in:  ${line}\n  out: ${serialized}`,
    );
  }
  console.log(`      10/10 lines round-tripped (with/without id, href-only, accented venue, ";" programs)`);

  // The id field must never be mistaken for a program or an href.
  const idOnly = upcoming.parseUpcomingConcertsMarkdown(
    "- 2027. február 10. | 19:00 | Győr | | Cím győrben | id:rk-2027-02-10-gyor",
  )[0];
  assert.equal(idOnly.id, "rk-2027-02-10-gyor");
  assert.equal(idOnly.program, undefined, "id field must not become a program");
  assert.equal(idOnly.link, undefined, "id field must not become an href");
});

// --------------------------------------------------------------------------
// (c) Hungarian date helpers
// --------------------------------------------------------------------------
await section("(c) huDateToIso / isoToHuDate", () => {
  assert.equal(admin.huDateToIso("2026. november 27."), "2026-11-27");
  assert.equal(admin.huDateToIso("2026. március 3."), "2026-03-03");
  assert.equal(admin.huDateToIso("2026. január 1."), "2026-01-01"); // single-digit day
  assert.equal(admin.huDateToIso("2026.november 27."), "2026-11-27"); // optional spaces
  assert.equal(admin.huDateToIso("2026. november 27. 19:30"), null); // not a pure date
  assert.equal(admin.huDateToIso("ham"), null);

  assert.equal(admin.isoToHuDate("2026-11-27"), "2026. november 27.");
  assert.equal(admin.isoToHuDate("2026-03-03"), "2026. március 3.");
  assert.equal(admin.isoToHuDate("2026-01-01"), "2026. január 1.");
  for (let month = 1; month <= 12; month++) {
    const iso = `2026-${String(month).padStart(2, "0")}-15`;
    assert.equal(admin.huDateToIso(admin.isoToHuDate(iso)), iso, `month round-trip failed for ${iso}`);
  }
});

// --------------------------------------------------------------------------
// (d) insert/update/delete against an in-memory fixture
// --------------------------------------------------------------------------
await section("(d) insert/update/delete keep unrelated lines byte-identical; unique ids; migration", () => {
  const FIXTURE_HEADER = [
    "# Közelgő koncertek",
    "",
    "Formátum: `- dátum | kezdés | helyszín | terem | cím | program | jegylink | linkcímke | id:rk-...`",
    "---",
  ];
  const FIXTURE_CONCERT_LINES = [
    "- 2026. november 20. | 19:00 | Budapest | venue-a | Régi cím | P1; P2 | id:rk-2026-11-20-venue-a",
    "- 2026. december 1. | 18:00 | Budapest | venue-b | Másik cím | id:rk-2026-12-01-venue-b",
    "- 2027. január 15. | 17:00 | Szeged | venue-c | Harmadik cím | id:rk-2027-01-15-venue-c",
  ];
  const FIXTURE = [...FIXTURE_HEADER, ...FIXTURE_CONCERT_LINES].join("\n");
  const fixtureLines = () => FIXTURE.split("\n");

  // assignMissingIds is a no-op when every line already has an id
  assert.equal(admin.assignMissingIds(FIXTURE), FIXTURE, "all-id fixture must stay byte-identical");

  // CREATE — chronological insert in the middle
  const created = admin.applyCreateConcert(FIXTURE, {
    date: "2026. december 10.",
    time: "19:30",
    location: "Budapest",
    venue: "venue-d",
    title: "Beszúrt koncert",
    program: ["X"],
    link: { href: "https://example.com/x", label: "X" },
  });
  assert.equal(created.concert.id, "rk-2026-12-10-venue-d");
  const createdLines = created.content.split("\n");
  assert.equal(createdLines.length, fixtureLines().length + 1);
  assert.deepEqual(createdLines.slice(0, 4), fixtureLines().slice(0, 4), "header lines must be byte-identical");
  assert.equal(createdLines[4], fixtureLines()[4], "venue-a line must be byte-identical");
  assert.equal(createdLines[5], fixtureLines()[5], "venue-b line must be byte-identical");
  assert.equal(createdLines[7], fixtureLines()[6], "venue-c line must be byte-identical");
  assert.ok(createdLines[6].startsWith("- 2026. december 10."), `new line must be after 12-01 and before 2027-01-15: ${createdLines[6]}`);
  assert.ok(createdLines[6].endsWith("id:rk-2026-12-10-venue-d"), `new line must carry its id: ${createdLines[6]}`);

  // CREATE — chronological insert at the front
  const earlier = admin.applyCreateConcert(FIXTURE, {
    date: "2026. november 15.",
    time: "18:00",
    location: "Budapest",
    venue: "venue-0",
    title: "Korábbi koncert",
  });
  const earlierLines = earlier.content.split("\n");
  assert.ok(earlierLines[4].startsWith("- 2026. november 15."), "the earliest concert must be inserted first");
  assert.deepEqual(earlierLines.slice(0, 4), fixtureLines().slice(0, 4));
  for (let i = 4; i < fixtureLines().length; i++) {
    assert.equal(earlierLines[i + 1], fixtureLines()[i], "all pre-existing lines must stay byte-identical");
  }

  // CREATE — duplicate venue+date must produce unique ids
  const dupBase = admin.applyCreateConcert(FIXTURE, {
    date: "2026. december 5.",
    location: "Budapest",
    venue: "venue-dup",
    title: "Első azonos",
  });
  assert.equal(dupBase.concert.id, "rk-2026-12-05-venue-dup");
  const dupSecond = admin.applyCreateConcert(dupBase.content, {
    date: "2026. december 5.",
    location: "Budapest",
    venue: "venue-dup",
    title: "Második azonos",
  });
  assert.equal(dupSecond.concert.id, "rk-2026-12-05-venue-dup-2", "duplicate venue+date must get a -2 id");
  assert.equal(upcoming.parseUpcomingConcertsMarkdown(dupSecond.content).length, 5);

  // UPDATE — rewrites only the target line
  const updated = admin.applyUpdateConcert(FIXTURE, "rk-2026-12-01-venue-b", {
    title: "Megváltozott cím",
    time: "20:00",
  });
  const updatedLines = updated.content.split("\n");
  assert.equal(updatedLines.length, fixtureLines().length);
  for (const index of [0, 1, 2, 3, 4, 6]) {
    assert.equal(updatedLines[index], fixtureLines()[index], `line ${index} must stay byte-identical`);
  }
  assert.ok(updatedLines[5].includes("Megváltozott cím"), "the patched line must change");
  assert.ok(updatedLines[5].endsWith("id:rk-2026-12-01-venue-b"), "the id must be kept");
  assert.equal(updated.concert.title, "Megváltozott cím");
  assert.equal(updated.concert.time, "20:00");
  assert.equal(updated.concert.id, "rk-2026-12-01-venue-b");

  // DELETE — removes exactly the target line
  const deleted = admin.applyDeleteConcert(FIXTURE, "rk-2026-11-20-venue-a");
  assert.deepEqual(
    deleted.split("\n"),
    [...fixtureLines().slice(0, 4), ...fixtureLines().slice(5)],
    "delete must remove exactly the one line",
  );

  // Unknown ids must throw
  assert.throws(() => admin.applyUpdateConcert(FIXTURE, "rk-9999-01-01-missing", { title: "x" }), /No upcoming concert/);
  assert.throws(() => admin.applyDeleteConcert(FIXTURE, "rk-9999-01-01-missing"), /No upcoming concert/);

  // MIGRATION — id-less lines get ids on the first write touch (create or update)
  const LEGACY = [
    "- 2026. november 25. | 19:00 | Soproni Egyetem, Ligneum Rendezvényház | | „Természetesen Zene!” | Händel: Music for the Royal Fireworks | https://shop.uni-sopron.hu/zeneakademia | SOE Shop",
    "- 2026. november 27. | 18:00 | Budapest | BMC – Könyvtár | Új utakon | https://bmc.hu/program | BMC",
  ].join("\n");
  const legacyLines = LEGACY.split("\n");

  const migratedCreate = admin.applyCreateConcert(LEGACY, {
    date: "2026. december 20.",
    location: "Budapest",
    venue: "Új hely",
    title: "Harmadik koncert",
  });
  const migratedCreateLines = migratedCreate.content.split("\n");
  assert.ok(migratedCreateLines[0].startsWith(legacyLines[0]), "legacy line 1 must keep its original bytes, plus the id field");
  assert.ok(migratedCreateLines[0].endsWith("id:rk-2026-11-25-soproni-egyetem-lign"), `Sopron line must gain its derived id: ${migratedCreateLines[0]}`);
  assert.ok(migratedCreateLines[1].endsWith("id:rk-2026-11-27-bmc-konyvtar"), `BMC line must gain its derived id: ${migratedCreateLines[1]}`);
  assert.equal(migratedCreate.concert.id, "rk-2026-12-20-uj-hely");
  assert.deepEqual(
    upcoming.parseUpcomingConcertsMarkdown(migratedCreate.content).map((c) => c.id),
    ["rk-2026-11-25-soproni-egyetem-lign", "rk-2026-11-27-bmc-konyvtar", "rk-2026-12-20-uj-hely"],
  );

  // update can address an id-less concert with the id the migration derives for it
  const migratedUpdate = admin.applyUpdateConcert(LEGACY, "rk-2026-11-27-bmc-konyvtar", { time: "19:00" });
  const migratedUpdateLines = migratedUpdate.content.split("\n");
  assert.equal(migratedUpdate.concert.time, "19:00");
  assert.ok(migratedUpdateLines[0].endsWith("id:rk-2026-11-25-soproni-egyetem-lign"), "migration must also run on update");
  assert.ok(migratedUpdateLines[1].endsWith("id:rk-2026-11-27-bmc-konyvtar"));

  // migration is idempotent
  const migratedOnce = admin.assignMissingIds(LEGACY);
  assert.equal(admin.assignMissingIds(migratedOnce), migratedOnce, "second migration must change nothing");
});

// --------------------------------------------------------------------------
// Live-read proof
// --------------------------------------------------------------------------
await section("live-read proof: derived ids of the live concerts; live file not modified", () => {
  if (!liveConcerts) {
    throw new Error("section (a) did not run successfully — no live concerts available");
  }
  const usedIds = new Set();
  const withDerivedIds = liveConcerts.map((concert) => ({
    ...projectBaselineFields(concert),
    derivedId: admin.deriveConcertId(concert, usedIds),
  }));
  assert.deepEqual(
    withDerivedIds.map((c) => c.derivedId),
    ["rk-2026-11-25-soproni-egyetem-lign", "rk-2026-11-27-bmc-konyvtar"],
    "derived ids of the two live concerts",
  );

  console.log("      Live concerts and the ids the first write would assign:");
  console.log(JSON.stringify(withDerivedIds, null, 2).replace(/^/gm, "        "));
  console.log(`        S3 key:        ${liveStatBefore?.key}`);
  console.log(`        LastModified before read: ${liveStatBefore?.lastModified} (size ${liveStatBefore?.sizeBytes} bytes)`);
  console.log(`        LastModified after read:  ${liveStatAfter?.lastModified} (size ${liveStatAfter?.sizeBytes} bytes)`);
  assert.equal(liveStatAfter.lastModified, liveStatBefore.lastModified);
  assert.equal(liveStatAfter.sizeBytes, liveStatBefore.sizeBytes);
  console.log("        The live S3 file was NOT modified: read-only operations only (stat, list).");
});

// --------------------------------------------------------------------------
console.log("");
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} section(s): ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log(`ALL CHECKS PASSED (${sections.length} sections).`);
}
