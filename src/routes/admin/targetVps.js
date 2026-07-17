const express = require("express");
const { TargetVps, PackagePlan, PackageMapping } = require("../../models");
const { encryptSecret } = require("../../lib/crypto");
const authenticateAdmin = require("../../middleware/authenticateAdmin");

const router = express.Router();
router.use(authenticateAdmin);

// Never include internal_secret_encrypted (or a decrypted secret) in any response.
function serialize(target) {
  return {
    id: target.id,
    name: target.name,
    base_url: target.base_url,
    priority: target.priority,
    quota: target.quota,
    current_count: target.current_count,
    status: target.status,
    last_synced_count: target.last_synced_count,
    last_synced_at: target.last_synced_at,
    last_error: target.last_error,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

router.get("/", async (req, res, next) => {
  try {
    const targets = await TargetVps.findAll({ order: [["priority", "ASC"]] });
    res.json({ data: targets.map(serialize) });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, base_url, internal_secret, priority = 0, quota = null } = req.body || {};
    if (!name || !base_url || !internal_secret) {
      return res.status(400).json({ message: "name, base_url, dan internal_secret wajib diisi." });
    }

    const created = await TargetVps.create({
      name: String(name).trim(),
      base_url: String(base_url).trim().replace(/\/+$/, ""),
      internal_secret_encrypted: encryptSecret(internal_secret),
      priority: Number(priority) || 0,
      quota: quota === null || quota === "" ? null : Number(quota),
      status: "disabled",
    });

    res.status(201).json({ data: serialize(created) });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const target = await TargetVps.findByPk(req.params.id);
    if (!target) return res.status(404).json({ message: "Target VPS tidak ditemukan." });

    const { name, base_url, internal_secret, priority, quota } = req.body || {};
    if (name !== undefined) target.name = String(name).trim();
    if (base_url !== undefined) target.base_url = String(base_url).trim().replace(/\/+$/, "");
    if (internal_secret) target.internal_secret_encrypted = encryptSecret(internal_secret);
    if (priority !== undefined) target.priority = Number(priority) || 0;
    if (quota !== undefined) target.quota = quota === null || quota === "" ? null : Number(quota);

    await target.save();
    res.json({ data: serialize(target) });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const target = await TargetVps.findByPk(req.params.id);
    if (!target) return res.status(404).json({ message: "Target VPS tidak ditemukan." });
    await target.destroy();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/activate", async (req, res, next) => {
  try {
    const target = await TargetVps.findByPk(req.params.id);
    if (!target) return res.status(404).json({ message: "Target VPS tidak ditemukan." });

    const activePlans = await PackagePlan.findAll({ where: { is_active: true } });
    const mappings = await PackageMapping.findAll({ where: { target_vps_id: target.id } });
    const mappedPlanIds = new Set(mappings.map((m) => m.package_plan_id));
    const missing = activePlans.filter((plan) => !mappedPlanIds.has(plan.id));
    if (missing.length) {
      return res.status(400).json({
        message: `Tidak bisa mengaktifkan VPS ini: paket berikut belum di-mapping: ${missing
          .map((p) => p.name)
          .join(", ")}.`,
      });
    }

    const currentActive = await TargetVps.findOne({ where: { status: "active" } });
    if (currentActive && currentActive.id !== target.id) {
      currentActive.status = "disabled";
      await currentActive.save();
    }
    target.status = "active";
    await target.save();

    res.json({ data: serialize(target) });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/reorder", async (req, res, next) => {
  try {
    const target = await TargetVps.findByPk(req.params.id);
    if (!target) return res.status(404).json({ message: "Target VPS tidak ditemukan." });
    target.priority = Number(req.body?.priority) || 0;
    await target.save();
    res.json({ data: serialize(target) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
