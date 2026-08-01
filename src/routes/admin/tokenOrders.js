const express = require("express");
const { TokenOrder, TokenPackage, TargetVps } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");
const { runTokenOrderCrediting } = require("../../lib/provisioning");

const router = express.Router();
router.use(authenticateAdmin);

router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.credit_status) where.credit_status = req.query.credit_status;

    const orders = await TokenOrder.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200,
      include: [
        { model: TokenPackage, as: "tokenPackage", attributes: ["id", "name"] },
        { model: TargetVps, as: "targetVps", attributes: ["id", "name"] },
      ],
    });
    res.json({ data: orders });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const order = await TokenOrder.findByPk(req.params.id, {
      include: [
        { model: TokenPackage, as: "tokenPackage", attributes: ["id", "name"] },
        { model: TargetVps, as: "targetVps", attributes: ["id", "name"] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    res.json({ data: order });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/retry-credit", async (req, res, next) => {
  try {
    const order = await TokenOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    if (order.status !== "paid") {
      return res.status(400).json({ message: "Order ini belum berstatus paid." });
    }

    const result = await runTokenOrderCrediting(order);
    res.json({ data: order, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
