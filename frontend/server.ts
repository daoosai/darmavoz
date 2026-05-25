import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON
  app.use(express.json());

  // API proxy routes
  app.get("/api/v1/catalog/categories/", async (req, res) => {
    try {
      const response = await fetch(
        "https://darmavoz.ru/api/v1/catalog/categories/",
      );
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.get("/api/v1/catalog/materials", async (req, res) => {
    try {
      const response = await fetch(
        "https://darmavoz.ru/api/v1/catalog/materials/",
      );
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching materials:", error);
      res.status(500).json({ error: "Failed to fetch materials" });
    }
  });

  app.get("/api/v1/catalog/delivery-options", async (req, res) => {
    try {
      const response = await fetch(
        "https://darmavoz.ru/api/v1/catalog/delivery-options/",
      );
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching delivery options:", error);
      res.status(500).json({ error: "Failed to fetch delivery options" });
    }
  });

  app.get("/api/v1/orders/", async (req, res) => {
    try {
      const response = await fetch("https://darmavoz.ru/api/v1/orders/", {
        headers: {
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6MTc4MDA1MDQyMX0.ZqbX-husqO2QHU4tE7_RzZFF0NGOtARDAY5-CNCZiuo",
        },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        res.status(response.status).json(err);
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.post("/api/v1/orders/checkout", async (req, res) => {
    try {
      const response = await fetch(
        "https://darmavoz.ru/api/v1/orders/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            session_key:
              (req.headers["session_key"] as string) || "demo-session",
            Authorization:
              "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6MTc4MDA1MDQyMX0.ZqbX-husqO2QHU4tE7_RzZFF0NGOtARDAY5-CNCZiuo",
          },
          body: JSON.stringify(req.body),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        res.status(response.status).json(err);
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
