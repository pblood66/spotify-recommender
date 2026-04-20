/**
 * Seed script — run once to populate Pinecone with a broad music catalog.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Requires a valid JWT token in the TOKEN env var:
 *   TOKEN=eyJ... npx tsx scripts/seed.ts
 */

const BASE = "http://localhost:3000/api/v1";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NTU5ZjgyZi1hYzFlLTRiOWQtYWMxNS04Y2Y0MmFkZDFjMTYiLCJzcG90aWZ5SWQiOiJwYm5qXzIiLCJlbWFpbCI6InBibG9vZDY2QGdtYWlsLmNvbSIsImlhdCI6MTc3NjAzMTIzNSwiZXhwIjoxNzc2MTE3NjM1fQ.2oFeBRr26o5gI90bWhTVC3L7V1FW1doEn8jhNP1Trts";
if (!TOKEN) {
    console.error("Missing TOKEN env var. Get it from the login flow and run:");
    process.exit(1);
}

const QUERIES = [
    // Genres
    "indie rock",
    "hip hop",
    "lo-fi beats",
    "jazz piano",
    "electronic dance",
    "r&b soul",
    "classic rock",
    "pop hits",
    "heavy metal",
    "country folk",
    "ambient music",
    "punk rock",
    "classical piano",
    "reggae",
    "blues guitar",
    "funk soul",
    "synth pop",
    "acoustic singer songwriter",
    "trap rap",
    "bossa nova",
    // Moods
    "happy upbeat songs",
    "sad emotional songs",
    "chill relaxing music",
    "workout motivation",
    "late night driving",
    "morning coffee",
    "focus study music",
    "party songs",
    "romantic love songs",
    "angry rock",
    // Eras
    "best songs 1970s",
    "best songs 1980s",
    "best songs 1990s",
    "best songs 2000s",
    "best songs 2010s",
    "best songs 2020s",
    // Specific vibes
    "guitar solo",
    "piano ballad",
    "drum and bass",
    "indie folk",
    "dream pop",
    "post punk",
    "neo soul",
    "garage rock",
    "psychedelic rock",
];

async function ingestSearch(query: string): Promise<number> {
    const res = await fetch(`${BASE}/ingest/search`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ query, limit: 20 }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${body.error ?? "unknown"}`);
    }

    const data = await res.json();
    return data.count ?? 0;
}

async function importTopTracks(
    timeRange: "short_term" | "medium_term" | "long_term"
): Promise<number> {
    const res = await fetch(`${BASE}/ingest/top-tracks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ timeRange }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${body.error ?? "unknown"}`);
    }

    const data = await res.json();
    return data.count ?? 0;
}

async function importRecentlyPlayed(): Promise<number> {
    const res = await fetch(`${BASE}/ingest/recently-played`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${body.error ?? "unknown"}`);
    }

    const data = await res.json();
    return data.count ?? 0;
}

async function checkPinecone(): Promise<number> {
    const res = await fetch(`${BASE}/debug/pinecone`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const data = await res.json();
    return data.stats?.totalRecordCount ?? 0;
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    console.log("╔════════════════════════════════╗");
    console.log("║   wavefinder seed script       ║");
    console.log("╚════════════════════════════════╝\n");

    const before = await checkPinecone();
    console.log(`Pinecone before: ${before} vectors\n`);

    // Import personal listening history first
    console.log("── personal history ──────────────");
    for (const range of ["short_term", "medium_term", "long_term"] as const) {
        try {
            const n = await importTopTracks(range);
            console.log(`  top tracks (${range}): +${n}`);
            await sleep(500);
        } catch (e: any) {
            console.warn(`  top tracks (${range}): skipped — ${e.message}`);
        }
    }

    try {
        const n = await importRecentlyPlayed();
        console.log(`  recently played: +${n}`);
    } catch (e: any) {
        console.warn(`  recently played: skipped — ${e.message}`);
    }

    // Search-based seeding
    console.log("\n── genre / mood searches ─────────");
    let total = 0;
    for (const query of QUERIES) {
        try {
            const n = await ingestSearch(query);
            total += n;
            console.log(`  "${query}": +${n}`);
            // Small delay to avoid hammering the server
            await sleep(300);
        } catch (e: any) {
            console.warn(`  "${query}": failed — ${e.message}`);
        }
    }

    const after = await checkPinecone();
    console.log(`\n── done ──────────────────────────`);
    console.log(`Pinecone after:  ${after} vectors`);
    console.log(`Net new vectors: ${after - before}`);
    console.log(`\nYour recommender now has ${after} songs to work with.`);
    if (after < 200) {
        console.log("Tip: run the script again or add more search queries for better recommendations.");
    } else if (after < 500) {
        console.log("Good start! 500+ vectors will give noticeably better diversity.");
    } else {
        console.log("Great catalog size — recommendations should be diverse and accurate.");
    }
}

main().catch(console.error);