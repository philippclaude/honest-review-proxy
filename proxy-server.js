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

app.get("/places", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query param required" });
  if (!GOOGLE_KEY) return res.status(500).json({ error: "GOOGLE_KEY not set on server" });

  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    // Normalize to our app's shape
    const results = (data.results || []).slice(0, 8).map(place => ({
      fsq_id: place.place_id,
      name: place.name,
      categories: [{ name: place.types?.[0]?.replace(/_/g, " ") || "Place" }],
      location: {
        locality: place.formatted_address?.split(",").slice(-2, -1)[0]?.trim() || query,
        country: place.formatted_address?.split(",").pop()?.trim() || "",
        address: place.formatted_address || ""
      },
      rating: place.rating || null,
      stats: { total_ratings: place.user_ratings_total || null },
      price: place.price_level || null,
    }));

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
