const { sequelize, TargetVps } = require("../models");

// Lowest-priority row currently marked active. Exactly one row should have
// status='active' at a time — enforced here in app logic, not a DB constraint,
// since the transition itself needs business logic (see recordProvisionedUser).
async function pickActiveTarget() {
  return TargetVps.findOne({ where: { status: "active" }, order: [["priority", "ASC"]] });
}

// Atomically increments the target's current_count and, if quota is reached,
// flips it to 'full' and promotes the next 'disabled' row (by priority) to 'active'.
// Runs inside a transaction with row locks so concurrent checkouts can't double-advance.
async function recordProvisionedUser(targetVpsId) {
  return sequelize.transaction(async (t) => {
    const target = await TargetVps.findByPk(targetVpsId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!target) return null;

    target.current_count += 1;

    if (target.quota != null && target.current_count >= target.quota) {
      target.status = "full";
      await target.save({ transaction: t });

      const next = await TargetVps.findOne({
        where: { status: "disabled" },
        order: [["priority", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (next) {
        next.status = "active";
        await next.save({ transaction: t });
      }
    } else {
      await target.save({ transaction: t });
    }

    return target;
  });
}

module.exports = { pickActiveTarget, recordProvisionedUser };
