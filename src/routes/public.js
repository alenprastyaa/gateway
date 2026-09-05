const express = require("express");
const { PackagePlan, TokenPackage, ProductionPricing } = require("../models");

const router = express.Router();

router.get("/packages", async (req, res, next) => {
  try {
    const plans = await PackagePlan.findAll({
      where: { is_active: true },
      order: [["sort_order", "ASC"]],
    });
    res.json({ data: plans });
  } catch (e) {
    next(e);
  }
});

router.get("/token-packages", async (req, res, next) => {
  try {
    const packages = await TokenPackage.findAll({
      where: { is_active: true },
      order: [["sort_order", "ASC"]],
    });
    res.json({ data: packages });
  } catch (e) {
    next(e);
  }
});

// What a backend VPS quotes its customers for a production year (2026-09-05).
// Read-only and public for the same reason /token-packages is: it is a price
// list, and the figure a customer is about to be charged should be the figure
// they were shown. The amount actually charged is still computed on this side
// at checkout, never taken from a request.
router.get("/production-pricing", async (req, res, next) => {
  try {
    const row = await ProductionPricing.findByPk(1);
    res.json({ yearly_price: Number(row?.yearly_price) || 0 });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
