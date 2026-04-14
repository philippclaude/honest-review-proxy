const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_KEY = process.env.GOOGLE_KEY;
const FSQ_KEY = process.env.FSQ_KEY;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "Honest Review proxy running ✦", sources: ["google", "foursquare", "reddit"] });
});

// ─── Category → Google Places (New) Table A types ──────────────────
const CATEGORY_TYPES = {
  all: [
    "tourist_attraction", "museum", "park", "night_club",
    "art_gallery", "shopping_mall", "stadium", "performing_arts_theater"
  ],
  food: [
    "restaurant", "bakery", "cafe", "bar"
  ],
  nightlife: [
    "night_club", "bar", "casino", "performing_arts_theater"
  ],
  outdoors: [
    "park", "campground", "zoo", "amusement_park",
    "hiking_area", "botanical_garden", "garden"
  ],
  culture: [
    "museum", "art_gallery", "library",
    "church", "hindu_temple", "mosque", "synagogue",
    "performing_arts_theater", "tourist_attraction",
    "cultural_landmark", "historical_landmark"
  ],
  sports: [
    "gym", "stadium", "bowling_alley",
    "sports_complex", "adventure_sports_center"
  ],
};

// ═══════════════════════════════════════════════════════════════════
// SOURCE 1: GOOGLE PLACES (New)
// ═══════════════════════════════════════════════════════════════════

async function geocodeCity(city) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results || !data.results.length) return null;
  return data.results[0].geometry.location;
}

async function googleNearbySearch(lat, lng, types, limit = 10) {
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const body = {
    includedTypes: types,
    maxResultCount: Math.min(limit, 20),
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 8000.0,
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.types", "places.location",
        "places.rating", "places.userRatingCount", "places.priceLevel",
        "places.formattedAddress", "places.primaryType", "places.primaryTypeDisplayName",
        "places.reviews", "places.generativeSummary"
      ].join(","),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Google API error: ${res.status} - ${txt}`);
    throw new Error(`Google Places API error ${res.status}`);
  }
  const data = await res.json();
  return data.places || [];
}

function normaliseGooglePlaces(places) {
  return places.map((p) => {
    const googleReviews = (p.reviews || []).slice(0, 5).map((r) => ({
      text: r.text?.text || "",
      rating: r.rating || null,
      author: r.authorAttribution?.displayName || "Anonymous",
      time: r.relativePublishTimeDescription || "",
    })).filter(r => r.text.length > 10);

    return {
      fsq_id: p.id,
      name: p.displayName?.text || "Unknown",
      categories: (p.types || [])
        .filter((t) => !["point_of_interest", "establishment"].includes(t))
        .slice(0, 3)
        .map((t) => ({
          name: t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        })),
      location: {
        locality: extractLocality(p.formattedAddress),
        country: extractCountry(p.formattedAddress),
        formatted_address: p.formattedAddress,
        lat: p.location?.latitude,
        lng: p.location?.longitude,
      },
      rating: p.rating || null,
      stats: { total_ratings: p.userRatingCount || 0 },
      price: p.priceLevel || null,
      primaryType: p.primaryType || null,
      primaryTypeDisplay: p.primaryTypeDisplayName?.text || null,
      googleReviews,
      googleSummary: p.generativeSummary?.overview?.text || null,
      foursquareTips: [],
      foursquareRating: null,
      redditMentions: [],
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 2: FOURSQUARE
// ═══════════════════════════════════════════════════════════════════

async function foursquareSearch(query, lat, lng) {
  if (!FSQ_KEY) return [];
  try {
    const url = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}&ll=${lat},${lng}&radius=8000&limit=5&fields=name,location,tips,rating,stats,categories`;
    const res = await fetch(url, {
      headers: { Authorization: FSQ_KEY, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error("Foursquare error:", e.message);
    return [];
  }
}

function matchFoursquareToGoogle(googlePlaces, fsqPlaces) {
  for (const gp of googlePlaces) {
    const gpName = gp.name.toLowerCase().trim();
    for (const fp of fsqPlaces) {
      const fpName = (fp.name || "").toLowerCase().trim();
      if (gpName === fpName || gpName.includes(fpName) || fpName.includes(gpName)) {
        gp.foursquareTips = (fp.tips || []).slice(0, 3).map((t) => ({
          text: t.text || "",
          date: t.created_at || "",
        })).filter(t => t.text.length > 10);
        if (fp.rating) gp.foursquareRating = fp.rating;
        break;
      }
    }
  }
  return googlePlaces;
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 3: REDDIT (public JSON endpoint)
// ═══════════════════════════════════════════════════════════════════

async function redditSearch(placeName, city) {
  try {
    const query = encodeURIComponent(`${placeName} ${city}`);
    const url = `https://www.reddit.com/search.json?q=${query}&sort=relevance&limit=5&restrict_sr=false&t=all`;
    const res = await fetch(url, {
      headers: { "User-Agent": "HonestReview/1.0 (travel recommendations app)" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const posts = data?.data?.children || [];
    return posts
      .filter((p) => p.data && p.data.selftext && p.data.selftext.length > 30)
      .slice(0, 3)
      .map((p) => ({
        title: p.data.title || "",
        text: (p.data.selftext || "").slice(0, 300),
        subreddit: p.data.subreddit || "",
        score: p.data.score || 0,
        url: `https://reddit.com${p.data.permalink}`,
      }));
  } catch (e) {
    console.error("Reddit error:", e.message);
    return [];
  }
}

async function enrichWithReddit(googlePlaces, city) {
  // Only top 3 places to respect rate limits
  const topPlaces = googlePlaces.slice(0, 3);
  const redditPromises = topPlaces.map((p) => redditSearch(p.name, city));
  const redditResults = await Promise.allSettled(redditPromises);
  redditResults.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value.length > 0) {
      googlePlaces[i].redditMentions = result.value;
    }
  });
  return googlePlaces;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function extractLocality(addr) {
  if (!addr) return "";
  const parts = addr.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

function extractCountry(addr) {
  if (!addr) return "";
  const parts = addr.split(",").map((s) => s.trim());
  return parts[parts.length - 1] || "";
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENDPOINT
// ═══════════════════════════════════════════════════════════════════

app.use(express.json());

app.get("/places", async (req, res) => {
  const { city, category = "all", limit = 10, query } = req.query;
  const cityName = city || query;
  if (!cityName) return res.status(400).json({ error: "city param required" });
  if (!GOOGLE_KEY)
    return res.status(500).json({ error: "GOOGLE_KEY not set on server" });

  try {
    // Step 1: Geocode
    const coords = await geocodeCity(cityName);
    if (!coords)
      return res.status(404).json({ error: `Could not geocode "${cityName}"` });

    // Step 2: Google Places (primary)
    const types = CATEGORY_TYPES[category] || CATEGORY_TYPES.all;
    const rawPlaces = await googleNearbySearch(coords.lat, coords.lng, types, parseInt(limit));
    let places = normaliseGooglePlaces(rawPlaces);

    // Step 3 & 4: Foursquare + Reddit in parallel
    const enrichments = [];

    if (FSQ_KEY && places.length > 0) {
      const fsqQuery = category === "all" ? cityName : `${category} in ${cityName}`;
      enrichments.push(
        foursquareSearch(fsqQuery, coords.lat, coords.lng)
          .then((fsq) => { places = matchFoursquareToGoogle(places, fsq); })
          .catch((e) => console.error("Foursquare enrichment failed:", e.message))
      );
    }

    if (places.length > 0) {
      enrichments.push(
        enrichWithReddit(places, cityName)
          .then((enriched) => { places = enriched; })
          .catch((e) => console.error("Reddit enrichment failed:", e.message))
      );
    }

    await Promise.allSettled(enrichments);

    res.json({
      results: places,
      sources: {
        google: true,
        foursquare: !!FSQ_KEY,
        reddit: true,
      },
      city: cityName,
      category,
    });
  } catch (err) {
    console.error("Places search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GEMINI AI REVIEW PROXY (free tier)
// ═══════════════════════════════════════════════════════════════════

const GEMINI_KEY = process.env.GEMINI_KEY;

app.post("/review", async (req, res) => {
  if (!GEMINI_KEY)
    return res.status(500).json({ error: "GEMINI_KEY not set on server" });

  try {
    const { prompt } = req.body;
    if (!prompt)
      return res.status(400).json({ error: "prompt is required" });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.7,
        },
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("Gemini API error:", response.status, txt);
      return res.status(response.status).json({ error: txt });
    }

    const data = await response.json();
    // Normalise Gemini response to match the format the frontend expects
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Review unavailable.";
    res.json({ content: [{ text }] });
  } catch (err) {
    console.error("Review synthesis error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT} — sources: Google, Foursquare, Reddit`));
