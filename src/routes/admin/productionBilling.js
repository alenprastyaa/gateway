// Admin surface for per-project production billing (2026-09-05): the yearly
// price, and the orders that pay it.
//
// Price and orders share a router because they are one screen's worth of
// admin — there is exactly one price row, which does not justify a module of
// its own, and it is meaningless without the orders it produced.
const express = require("express");
const { ProductionPricing, ProductionOrder, TargetVps } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");
const { runProductionOrderCrediting } = require("../../lib/provisioning");

const router = express.Router();
router.use(authenticateAdmin);

// Sanity ceiling, not a business rule. It exists so a slipped keypress in the
// admin form cannot turn 150000 into 150000000 and charge a customer a
// thousand times over on their next renewal — this figure is multiplied by
// the number of apps and sent straight to a live payment gateway.
const MAX_YEARLY_PRICE = 100000000;

router.get("/pricing", async (req, res, next) => {
  try {
    const row = await ProductionPricing.findByPk(1);
    res.json({ data: { yearly_price: Number(row?.yearly_price) || 0 } });
  } catch (e) {
    next(e);
  }
});

router.put("/pricing", async (req, res, next) => {
  try {
    const price = Number.parseInt(req.body?.yearly_price, 10);
    if (!Number.isFinite(price) || price <= 0) {
      return res
        .status(400)
        .json({ message: "yearly_price wajib berupa angka lebih dari 0." });
    }
    if (price > MAX_YEARLY_PRICE) {
      return res
        .status(400)
        .json({ message: `yearly_price terlalu besar (maksimal ${MAX_YEARLY_PRICE}).` });
    }

    /* The row is seeded by migration, but upsert rather than assume: a
     * gateway restored from a dump taken before that migration, or one where
     * someone deleted the row, would otherwise 404 forever with no way back
     * through the UI. */
    let row = await ProductionPricing.findByPk(1);
    if (!row) {
      row = await ProductionPricing.create({ id: 1, yearly_price: price });
    } else {
      row.yearly_price = price;
      await row.save();
    }

    /* Existing orders are untouched on purpose: each one snapshots the price
     * it was created with (unit_price), so a customer is charged what they
     * were quoted even if the price changes while they are on the payment
     * page. */
    res.json({ data: { yearly_price: row.yearly_price } });
  } catch (e) {
    next(e);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.extend_status) where.extend_status = req.query.extend_status;

    const orders = await ProductionOrder.findAll({
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

// Manual re-drive for an order whose money arrived but whose extension call
// to the backend VPS failed (VPS down, network blip). runProductionOrderCrediting
// short-circuits on extend_status === "succeeded", so pressing this on an
// order that already went through is a no-op rather than a second free year.
router.post("/orders/:id/retry-extend", async (req, res, next) => {
  try {
    const order = await ProductionOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    if (order.status !== "paid") {
      return res.status(400).json({ message: "Order ini belum berstatus paid." });
    }

    const result = await runProductionOrderCrediting(order);
    res.json({ data: order, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
