const express = require("express");
const { PackagePlan, TokenPackage } = require("../models");

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

module.exports = router;
