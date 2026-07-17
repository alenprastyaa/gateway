const express = require("express");
const { PackagePlan, PackageMapping, TargetVps } = require("../../models");
const authenticateAdmin = require("../../middleware/authenticateAdmin");

const router = express.Router();
router.use(authenticateAdmin);

router.get("/", async (req, res, next) => {
  try {
    const plans = await PackagePlan.findAll({ order: [["sort_order", "ASC"]] });
    res.json({ data: plans });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, slug, description, initial_price, renewal_price, max_projects, features, sort_order } =
      req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ message: "name dan slug wajib diisi." });
    }
    const created = await PackagePlan.create({
      name: String(name).trim(),
      slug: String(slug).trim(),
      description: description || null,
      initial_price: Number(initial_price) || 0,
      renewal_price: Number(renewal_price) || 0,
      max_projects: Number(max_projects) || 3,
      features: Array.isArray(features) ? features : [],
      sort_order: Number(sort_order) || 0,
    });
    res.status(201).json({ data: created });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const plan = await PackagePlan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ message: "Paket tidak ditemukan." });

    const fields = [
      "name",
      "slug",
      "description",
      "initial_price",
      "renewal_price",
      "max_projects",
      "features",
      "is_active",
      "sort_order",
    ];
    fields.forEach((field) => {
      if (req.body?.[field] !== undefined) plan[field] = req.body[field];
    });
    await plan.save();
    res.json({ data: plan });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const plan = await PackagePlan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ message: "Paket tidak ditemukan." });
    await plan.destroy();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// --- Package <-> target VPS id mapping ---

router.get("/:id/mappings", async (req, res, next) => {
  try {
    const mappings = await PackageMapping.findAll({
      where: { package_plan_id: req.params.id },
      include: [{ model: TargetVps, as: "targetVps", attributes: ["id", "name"] }],
    });
    res.json({ data: mappings });
  } catch (e) {
    next(e);
  }
});

router.put("/:id/mappings/:targetVpsId", async (req, res, next) => {
  try {
    const remotePackageId = Number.parseInt(req.body?.remote_package_id, 10);
    if (!remotePackageId) {
      return res.status(400).json({ message: "remote_package_id wajib diisi." });
    }

    const [mapping] = await PackageMapping.upsert(
      {
        package_plan_id: Number(req.params.id),
        target_vps_id: Number(req.params.targetVpsId),
        remote_package_id: remotePackageId,
      },
      { returning: true }
    );

    res.json({ data: mapping });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
