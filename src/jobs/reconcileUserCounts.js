const { TargetVps } = require("../models");
const { fetchRemoteUserCount } = require("../lib/provisioning");

const DRIFT_TOLERANCE = 2;

// Periodic, low-priority drift check. Never auto-corrects current_count (that's
// the value the quota decision depends on) — just surfaces a warning via
// last_error so the admin can investigate (e.g. users created manually on the
// backend VPS's own admin panel, or a provisioning call that partially failed).
async function reconcileUserCounts() {
  const targets = await TargetVps.findAll();

  for (const target of targets) {
    try {
      const remoteCount = await fetchRemoteUserCount(target);
      target.last_synced_count = remoteCount;
      target.last_synced_at = new Date();

      const drift = Math.abs(remoteCount - target.current_count);
      if (drift > DRIFT_TOLERANCE) {
        target.last_error = `Selisih terdeteksi: current_count=${target.current_count}, remote user-count=${remoteCount}.`;
      }
      await target.save();
    } catch (e) {
      target.last_error = `Reconcile gagal: ${e.message}`;
      await target.save();
    }
  }
}

module.exports = { reconcileUserCounts };
