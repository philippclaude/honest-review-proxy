const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const FSQ_KEY = process.env.FSQ_KEY;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "Honest Review proxy running ✦" });
});

app.get("/places", async (req, res) => {
  const { query, limit = 8 } = req.query;
  if (!query) return res.status(400).json({ error: "query param required" });
  if (!FSQ_KEY) return res.status(500).json({ error: "FSQ_KEY not set on server" });

  try {
    const url = `https://places.googleapis.com/v1/places:searchText`;
    
    // Try Foursquare new API first
    const fsqUrl = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=fsq_id,name,categories,location,rating,stats,price`;
    
    const response = await fetch(fsqUrl, {
      headers: { 
        Authorization: FSQ_KEY, 
        Accept: "application/json",
        "X-Places-Api-Version": "1"
      },
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
