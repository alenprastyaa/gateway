// Admin surface for extra slots (2026-10-21): the two slot prices, and the orders
// that pay for them. Mirrors productionBilling.js.
const express = require("express");
const { SlotPricing, SlotOrder, TargetVps } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");
const { runSlotOrderGranting } = require("../../lib/provisioning");

const router = express.Router();
router.use(authenticateAdmin);

// Sanity ceiling per slot, so a slipped keypress cannot turn 25000 into
// 25000000 and charge a customer a thousand times over.
const MAX_SLOT_PRICE = 10000000;

const readPrices = (row) => ({
  project_slot_price: Number(row?.project_slot_price) || 0,
  production_slot_price: Number(row?.production_slot_price) || 0,
});

router.get("/pricing", async (req, res, next) => {
  try {
    res.json({ data: readPrices(await SlotPricing.findByPk(1)) });
  } catch (e) {
    next(e);
  }
});

// 0 switches a kind off; any other value must be a whole number inside the
// ceiling. A field that is left out keeps its current value.
router.put("/pricing", async (req, res, next) => {
  try {
    const changes = {};
    for (const field of ["project_slot_price", "production_slot_price"]) {
      if (req.body?.[field] === undefined) continue;
      const value = Number(req.body[field]);
      if (!Number.isInteger(value) || value < 0 || value > MAX_SLOT_PRICE) {
        return res.status(400).json({
          message: `${field} harus bilangan bulat 0 sampai ${MAX_SLOT_PRICE} (0 = tidak dijual).`,
        });
      }
      changes[field] = value;
    }
    if (!Object.keys(changes).length) {
      return res.status(400).json({ message: "Tidak ada harga yang dikirim." });
    }

    let row = await SlotPricing.findByPk(1);
    if (!row) row = await SlotPricing.create({ id: 1, ...changes });
    else await row.update(changes);

    // Existing orders keep the price they were created with (unit_price columns).
    res.json({ data: readPrices(row) });
  } catch (e) {
    next(e);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.grant_status) where.grant_status = req.query.grant_status;
    const orders = await SlotOrder.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200,
      include: [{ model: TargetVps, as: "targetVps", attributes: ["id", "name"] }],
    });
    res.json({ data: orders });
  } catch (e) {
    next(e);
  }
});

// Manual re-drive for an order whose money arrived but whose grant call to the
// backend VPS failed. runSlotOrderGranting short-circuits on
// grant_status === "succeeded", and the backend records reference_id, so
// pressing this twice never grants twice.
router.post("/orders/:id/retry-grant", async (req, res, next) => {
  try {
    const order = await SlotOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    if (order.status !== "paid") {
      return res.status(400).json({ message: "Order ini belum berstatus paid." });
    }
    const result = await runSlotOrderGranting(order);
    res.json({ data: order, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
