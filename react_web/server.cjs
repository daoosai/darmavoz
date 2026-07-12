var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var API_BASE_URL = process.env.VITE_API_BASE_URL || process.env.VITE_API_URL || process.env.API_BASE_URL || "http://127.0.0.1:8000/api/v1";
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  app.get("/api/v1/catalog/categories/", async (req, res) => {
    try {
      const response = await fetch(`${API_BASE_URL}/catalog/categories/`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });
  app.get("/api/v1/catalog/materials", async (req, res) => {
    try {
      const response = await fetch(`${API_BASE_URL}/catalog/materials/`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching materials:", error);
      res.status(500).json({ error: "Failed to fetch materials" });
    }
  });
  app.get("/api/v1/catalog/delivery-options", async (req, res) => {
    try {
      const response = await fetch(`${API_BASE_URL}/catalog/delivery-options/`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching delivery options:", error);
      res.status(500).json({ error: "Failed to fetch delivery options" });
    }
  });
  app.get("/api/v1/orders/", async (req, res) => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/`, {
        headers: {
          Authorization: req.headers.authorization || ""
        }
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
      const response = await fetch(`${API_BASE_URL}/orders/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          session_key: req.headers["session_key"] || "demo-session",
          Authorization: req.headers.authorization || ""
        },
        body: JSON.stringify(req.body)
      });
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
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
