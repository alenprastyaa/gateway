const express = require("express");
const { PaymentOrder, PackagePlan, TargetVps } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");
const { runOrderProvisioning } = require("../../lib/provisioning");

const router = express.Router();
router.use(authenticateAdmin);

router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.provisioning_status) where.provisioning_status = req.query.provisioning_status;

    const orders = await PaymentOrder.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200,
      include: [
        { model: PackagePlan, as: "packagePlan", attributes: ["id", "name"] },
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
    const order = await PaymentOrder.findByPk(req.params.id, {
      include: [
        { model: PackagePlan, as: "packagePlan", attributes: ["id", "name"] },
        { model: TargetVps, as: "targetVps", attributes: ["id", "name"] },
      ],
    });
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    res.json({ data: order });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/retry-provisioning", async (req, res, next) => {
  try {
    const order = await PaymentOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });
    if (order.status !== "paid") {
      return res.status(400).json({ message: "Order ini belum berstatus paid." });
    }

    const result = await runOrderProvisioning(order);
    res.json({ data: order, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
