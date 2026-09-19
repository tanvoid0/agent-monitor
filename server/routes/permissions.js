/**
 * @file Dashboard-side half of the permission relay: list the Claude Code
 * permission prompts currently parked by `POST /api/hooks/permission-request`
 * and answer one of them. Same-origin guarded like /api/run — a decision here
 * grants a tool call in a real Claude Code session, so a stray web page must
 * never be able to fire it.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { Router } = require("express");
const relay = require("../lib/permission-relay");
const { __sameOriginGuard: sameOriginGuard } = require("./run");

const router = Router();
router.use(sameOriginGuard);

const BEHAVIORS = new Set(["allow", "deny", "defer"]);

router.get("/", (_req, res) => {
  res.json({ pending: relay.list(), hold_ms: relay.HOLD_MS });
});

router.post("/:id/decision", (req, res) => {
  const body = req.body || {};
  if (!BEHAVIORS.has(body.behavior)) {
    return res.status(400).json({
      error: { code: "EBADINPUT", message: "behavior must be allow, deny or defer" },
    });
  }
  if (!relay.decide(req.params.id, body)) {
    return res.status(404).json({
      error: { code: "ENOTFOUND", message: "no pending permission request with that id" },
    });
  }
  res.json({ ok: true });
});

module.exports = router;
