const express = require("express");
const { PackagePlan } = require("../models");

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

module.exports = router;
