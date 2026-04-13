const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_KEY = process.env.GOOGLE_KEY;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "Honest Review proxy running ✦" });
});

// ─── Category → Google Places type mappings ────────────────────────
// Each category maps to specific Google Places types so we get
// genuinely relevant results instead of restaurant-biased text search.
const CATEGORY_TYPES = {
  all: [
    "tourist_attraction", "museum", "park", "night_club",
    "art_gallery", "market", "stadium", "performing_arts_theater"
  ],
  food: [
    "restaurant", "meal_delivery", "meal_takeaway", "bakery",
    "cafe", "bar", "food"
  ],
  nightlife: [
    "night_club", "bar", "casino",
    "performing_arts_theater"
  ],
  outdoors: [
    "park", "campground", "natural_feature",
    "zoo", "amusement_park"
  ],
  culture: [
    "museum", "art_gallery", "library",
    "church", "hindu_temple", "mosque", "synagogue",
    "performing_arts_theater", "tourist_attraction"
  ],
  sports: [
    "gym", "stadium", "bowling_alley",
    "swimming_pool"
  ],
};

// ─── Step 1: Geocode a city name to lat/lng ────────────────────────
async function geocodeCity(city) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results || !data.results.length) return null;
  return data.results[0].geometry.location; // { lat, lng }
}

// ─── Step 2: Nearby Search with includedTypes ──────────────────────
async function nearbySearch(lat, lng, types, limit = 10) {
  // Use the new Places API (v1) with POST for Nearby Search
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const body = {
    includedTypes: types,
    maxResultCount: Math.min(limit, 20),
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 8000.0, // 8km radius covers most city centres
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.types,places.location,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress,places.primaryType,places.primaryTypeDisplayName",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google Places API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.places || [];
}

// ─── Normalise Google Places v1 response to our frontend format ────
function normalisePlaces(places) {
  return places.map((p) => ({
    fsq_id: p.id, // reuse field name so frontend doesn't break
    name: p.displayName?.text || "Unknown",
    categories: (p.types || [])
      .filter((t) => !["point_of_interest", "establishment"].includes(t))
      .slice(0, 3)
      .map((t) => ({
        name: t
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    location: {
      locality: extractLocality(p.formattedAddress),
      country: extractCountry(p.formattedAddress),
      formatted_address: p.formattedAddress,
    },
    rating: p.rating || null,
    stats: {
      total_ratings: p.userRatingCount || 0,
    },
    price: p.priceLevel || null,
    primaryType: p.primaryType || null,
    primaryTypeDisplay: p.primaryTypeDisplayName?.text || null,
  }));
}

function extractLocality(addr) {
  if (!addr) return "";
  const parts = addr.split(",").map((s) => s.trim());
  // Usually the city is the second-to-last part
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

function extractCountry(addr) {
  if (!addr) return "";
  const parts = addr.split(",").map((s) => s.trim());
  return parts[parts.length - 1] || "";
}

// ─── Main endpoint ─────────────────────────────────────────────────
// Usage: GET /places?city=Vienna&category=culture&limit=10
app.get("/places", async (req, res) => {
  const { city, category = "all", limit = 10, query } = req.query;

  // Support legacy ?query= param (just treat it as city)
  const cityName = city || query;
  if (!cityName) return res.status(400).json({ error: "city param required" });
  if (!GOOGLE_KEY)
    return res.status(500).json({ error: "GOOGLE_KEY not set on server" });

  try {
    // Geocode the city
    const coords = await geocodeCity(cityName);
    if (!coords)
      return res.status(404).json({ error: `Could not geocode "${cityName}"` });

    // Get the right types for this category
    const types = CATEGORY_TYPES[category] || CATEGORY_TYPES.all;

    // Search
    const places = await nearbySearch(coords.lat, coords.lng, types, parseInt(limit));
    const normalised = normalisePlaces(places);

    res.json({ results: normalised });
  } catch (err) {
    console.error("Places search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
