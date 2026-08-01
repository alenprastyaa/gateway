const express = require("express");
const { TokenPackage } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");

const router = express.Router();
router.use(authenticateAdmin);

router.get("/", async (req, res, next) => {
  try {
    const packages = await TokenPackage.findAll({ order: [["sort_order", "ASC"]] });
    res.json({ data: packages });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, description, price, token_amount, sort_order } = req.body || {};
    if (!name) {
      return res.status(400).json({ message: "name wajib diisi." });
    }
    if (!Number(token_amount)) {
      return res.status(400).json({ message: "token_amount wajib diisi dan lebih dari 0." });
    }
    const created = await TokenPackage.create({
      name: String(name).trim(),
      description: description || null,
      price: Number(price) || 0,
      token_amount: Number(token_amount) || 0,
      sort_order: Number(sort_order) || 0,
    });
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const pkg = await TokenPackage.findByPk(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Paket token tidak ditemukan." });

    const fields = ["name", "description", "price", "token_amount", "is_active", "sort_order"];
    fields.forEach((field) => {
      if (req.body?.[field] !== undefined) pkg[field] = req.body[field];
    });
    await pkg.save();
    res.json({ data: pkg });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const pkg = await TokenPackage.findByPk(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Paket token tidak ditemukan." });
    await pkg.destroy();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
